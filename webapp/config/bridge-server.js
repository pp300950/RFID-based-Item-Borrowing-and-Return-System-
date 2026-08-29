// bridge-server.js
// -----------------------------------------------------------------
// รันบนเครื่อง local คู่กับ XAMPP (คนละ process จาก server.js หลัก)
// หน้าที่เดียว: รับคำสั่ง SQL จาก Render ผ่าน HTTP (มาจาก config/db.js
// ฝั่ง Render ที่รันในโหมด bridge) แล้วส่งต่อไปที่ MySQL/MariaDB local
// ผ่าน localhost เท่านั้น — ไม่เปิดพอร์ต MySQL (3306) ออกอินเทอร์เน็ต
// เลยแม้แต่จุดเดียว ดู README section 11
//
// วิธีรัน:
//   node bridge-server.js
// แล้วเปิด Cloudflare Quick Tunnel ชี้มาที่พอร์ตนี้แยกต่างหาก:
//   cloudflared tunnel --url http://localhost:4001
// (พอร์ต bridge ต่างจากพอร์ตเว็บหลัก server.js เสมอ กันชนกัน)
//
// ตัวแปร env ที่ต้องตั้ง (ดู .env.example):
//   BRIDGE_PORT      พอร์ตที่ bridge เปิดรับ (default 4001)
//   BRIDGE_AUTH_KEY   คีย์ลับกันคนแปลกหน้ายิง SQL เข้ามา (ต้องตั้งเสมอ
//                      ไม่มีค่า default — ถ้าไม่ตั้งจะไม่ยอมสตาร์ท)
//   DB_HOST / DB_USER / DB_PASSWORD / DB_NAME / DB_PORT
//     เหมือนกับที่ server.js ใช้ทุกประการ — bridge คุย MySQL ผ่าน
//     localhost เท่านั้น ไม่ต่างจาก db.js โหมด local
// -----------------------------------------------------------------

require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const { query, pool } = require("./mysql-pool");

const PORT = process.env.BRIDGE_PORT ? Number(process.env.BRIDGE_PORT) : 4001;
const AUTH_KEY = process.env.BRIDGE_AUTH_KEY;

// [BLOB migration] เอา multer/fs/path + ROOM_IMAGES_DIR + uploadImage +
// SAFE_IMAGE_FILENAME ออกแล้ว — รูปภาพเก็บเป็น LONGBLOB ผ่าน /query
// ปกติแทนการเขียนไฟล์ลงดิสก์ ดูคอมเมนต์ท้ายไฟล์ที่จุดเดิมของ
// /upload-image และ DELETE /image

if (!AUTH_KEY) {
  console.error(
    "✗ BRIDGE_AUTH_KEY ยังไม่ได้ตั้งค่าใน .env — bridge-server.js จะไม่ยอม" +
    " สตาร์ท เพราะ endpoint นี้เปิดสู่อินเทอร์เน็ตจริงผ่าน tunnel ถ้าไม่มี" +
    " auth key ใครก็สามารถยิงคำสั่ง SQL อะไรก็ได้เข้ามาที่ฐานข้อมูลได้ทันที\n" +
    "ตั้งค่าด้วย: BRIDGE_AUTH_KEY=<สุ่มมายาวๆ> ใน .env (เช่น openssl rand -hex 32)"
  );
  process.exit(1);
}

const app = express();
// [BLOB migration] limit เดิม 2mb ไม่พอสำหรับรูปภาพ — ตอนนี้รูปถูกส่ง
// มาเป็นส่วนหนึ่งของ JSON body (Buffer ถูก JSON.stringify เป็น
// { type: "Buffer", data: [...] } ซึ่งขยายขนาดจริงของไฟล์ขึ้นราว 3-4
// เท่า) multer จำกัดไฟล์ไว้ที่ 5MB (ดู admin_rooms.js) ดังนั้น JSON
// payload ที่ห่อ buffer 5MB อาจใหญ่ถึง ~20MB — ตั้ง limit ไว้ที่ 30mb
// เผื่อ overhead เต็มที่ กัน request รูปภาพถูก reject แล้วไป timeout
// อย่างที่เจอ (ดู README/comment ประกอบตอนแก้บั๊กนี้)
app.use(express.json({ limit: "30mb" }));

// -------------------------------------------------------------
// Auth middleware — เช็คทุก request ก่อนแตะ MySQL เสมอ
// เทียบ header X-Bridge-Key กับ BRIDGE_AUTH_KEY แบบ constant-time
// เพื่อกัน timing attack (ถึงจะเป็นความเสี่ยงเล็กน้อยมากสำหรับ use
// case นี้ แต่ทำให้ถูกไว้เลยเพราะไม่มีต้นทุนเพิ่ม)
// -------------------------------------------------------------
function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireBridgeAuth(req, res, next) {
  const provided = req.get("X-Bridge-Key");
  if (!provided || !timingSafeEqual(provided, AUTH_KEY)) {
    return res.status(401).json({ ok: false, message: "unauthorized" });
  }
  next();
}

// -------------------------------------------------------------
// GET /health — ไม่ต้อง auth เพราะไม่แตะ MySQL และไม่คืนข้อมูลอะไรที่
// เป็นความลับ ใช้เช็คว่า tunnel + bridge process ยังรันอยู่ไหมจากฝั่ง
// Render หรือจากเบราว์เซอร์ตรงๆ ก็ได้ตอน debug
// -------------------------------------------------------------
app.get("/health", (req, res) => {
  res.json({ ok: true, message: "bridge-server is running" });
});

// -------------------------------------------------------------
// POST /query — เทียบเท่า pool.query(sql, params) ฝั่ง db.js เดิม
// body: { sql: string, params?: array | object }
// response: { ok: true, rows, fields } | { ok: false, message }
// -------------------------------------------------------------
app.post("/query", requireBridgeAuth, async (req, res) => {
  const { sql, params } = req.body || {};
  if (!sql || typeof sql !== "string") {
    return res.status(400).json({ ok: false, message: "missing or invalid 'sql'" });
  }
  try {
    const [rows, fields] = await query(sql, params);
    res.json({ ok: true, rows, fields });
  } catch (err) {
    console.error("bridge /query error:", err.message);
    // ส่ง code/sqlMessage กลับไปด้วย เพราะฝั่ง route files (ผ่าน db.js
    // bridge mode) อาจต้องเช็ค err.code (เช่น ER_DUP_ENTRY) เหมือนตอน
    // คุย mysql2 ตรงๆ — ถ้าไม่ส่งกลับไป route files จะแยกเคส error ไม่ได้
    res.status(500).json({
      ok: false,
      message: err.message,
      code: err.code || null,
      sqlMessage: err.sqlMessage || null,
    });
  }
});

// -------------------------------------------------------------
// Transaction แบบ "interactive" ที่ค้างข้าม HTTP request หลายครั้ง
// -------------------------------------------------------------
// เหตุผลที่ต้องทำแบบนี้แทนการส่ง steps เป็นก้อนเดียว: withTransaction()
// ฝั่ง db.js เดิมรับ "callback function" ที่อาจมี branching logic ข้างใน
// (เช่น query แรกเสร็จแล้วค่อยตัดสินใจว่า query ถัดไปจะเป็นอะไรจาก
// ผลลัพธ์ query แรก — ดูตัวอย่างจริงใน mysql-pool.js เช่น
// r1.insertId ถูกใช้เป็น param ของ query ถัดไป) จะ "รวบ steps ไว้ก่อน
// ทั้งหมดแล้วส่งเป็นก้อนเดียว" แบบนั้นทำไม่ได้ เพราะ route files
// (ฝั่ง Render) ยังไม่รู้ query ถัดไปจนกว่าจะเห็นผลลัพธ์ query ก่อนหน้า
//
// วิธีแก้: เปิด transaction ค้างไว้ที่ bridge (เก็บ connection ไว้ใน
// Map ตาม transaction id) แล้วให้ db-bridge-client.js (ฝั่ง Render)
// ยิง HTTP ทีละ query จริง ไม่ใช่ batch — จบด้วย /transaction/commit
// หรือ /transaction/rollback
//
// ความเสี่ยง: ถ้าฝั่ง Render หลุดกลางทาง (ไม่ได้เรียก commit/rollback)
// connection จะค้างไปเรื่อยๆ — กันด้วย TRANSACTION_TIMEOUT_MS ด้านล่าง
// auto-rollback ทิ้งเองถ้าไม่มีการใช้งานเกินเวลาที่กำหนด
// -------------------------------------------------------------

const TRANSACTION_TIMEOUT_MS = 30000; // 30 วินาที — เผื่อ latency ของ tunnel มากกว่า SESSION_TTL_MS ปกติของแอป (20s) พอสมควร
const activeTransactions = new Map(); // txId -> { connection, timeoutHandle }

function clearTxTimeout(txId) {
  const tx = activeTransactions.get(txId);
  if (tx && tx.timeoutHandle) clearTimeout(tx.timeoutHandle);
}

function scheduleTxTimeout(txId) {
  clearTxTimeout(txId);
  const tx = activeTransactions.get(txId);
  if (!tx) return;
  tx.timeoutHandle = setTimeout(async () => {
    console.warn(`bridge: transaction ${txId} timed out ไม่มีการใช้งานเกิน ${TRANSACTION_TIMEOUT_MS}ms — auto-rollback`);
    const entry = activeTransactions.get(txId);
    if (!entry) return;
    activeTransactions.delete(txId);
    try {
      await entry.connection.rollback();
    } catch (err) {
      console.error(`auto-rollback ของ transaction ${txId} ล้มเหลว:`, err.message);
    } finally {
      entry.connection.release();
    }
  }, TRANSACTION_TIMEOUT_MS);
}

// POST /transaction/begin — เปิด transaction ใหม่ คืน txId
app.post("/transaction/begin", requireBridgeAuth, async (req, res) => {
  try {
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    const txId = crypto.randomUUID();
    activeTransactions.set(txId, { connection, timeoutHandle: null });
    scheduleTxTimeout(txId);
    res.json({ ok: true, txId });
  } catch (err) {
    console.error("bridge /transaction/begin error:", err.message);
    res.status(500).json({ ok: false, message: err.message });
  }
});

// POST /transaction/query — รัน query เดี่ยวภายใน transaction ที่เปิดค้างไว้
// body: { txId, sql, params }
app.post("/transaction/query", requireBridgeAuth, async (req, res) => {
  const { txId, sql, params } = req.body || {};
  const tx = txId && activeTransactions.get(txId);
  if (!tx) {
    return res.status(404).json({ ok: false, message: "transaction not found or already ended" });
  }
  if (!sql || typeof sql !== "string") {
    return res.status(400).json({ ok: false, message: "missing or invalid 'sql'" });
  }
  scheduleTxTimeout(txId); // reset timeout ทุกครั้งที่มีการใช้งานจริง
  try {
    const [rows, fields] = await tx.connection.query(sql, params);
    res.json({ ok: true, rows, fields });
  } catch (err) {
    // query ล้มเหลวกลางทาง transaction — rollback + เคลียร์ทันที ไม่รอ
    // ให้ client เรียก /rollback เอง เพราะ withTransaction() ฝั่ง db.js
    // เดิมก็ throw แล้ว rollback ทันทีเหมือนกัน (ดู mysql-pool.js)
    activeTransactions.delete(txId);
    clearTxTimeout(txId);
    try {
      await tx.connection.rollback();
    } catch (rollbackErr) {
      console.error(`rollback ของ transaction ${txId} ล้มเหลว:`, rollbackErr.message);
    } finally {
      tx.connection.release();
    }
    console.error(`bridge /transaction/query error (tx ${txId}):`, err.message);
    res.status(500).json({
      ok: false,
      message: err.message,
      code: err.code || null,
      sqlMessage: err.sqlMessage || null,
      rolledBack: true,
    });
  }
});

// POST /transaction/commit — commit + ปิด transaction
// body: { txId }
app.post("/transaction/commit", requireBridgeAuth, async (req, res) => {
  const { txId } = req.body || {};
  const tx = txId && activeTransactions.get(txId);
  if (!tx) {
    return res.status(404).json({ ok: false, message: "transaction not found or already ended" });
  }
  activeTransactions.delete(txId);
  clearTxTimeout(txId);
  try {
    await tx.connection.commit();
    res.json({ ok: true });
  } catch (err) {
    console.error(`bridge /transaction/commit error (tx ${txId}):`, err.message);
    try {
      await tx.connection.rollback();
    } catch (rollbackErr) {
      console.error(`rollback หลัง commit ล้มเหลวของ transaction ${txId} ก็ล้มเหลวด้วย:`, rollbackErr.message);
    }
    res.status(500).json({ ok: false, message: err.message });
  } finally {
    tx.connection.release();
  }
});

// POST /transaction/rollback — rollback + ปิด transaction (route files
// ฝั่ง Render เรียกจุดนี้เมื่อ callback ของ withTransaction() throw เอง
// โดยไม่เกี่ยวกับ query ล้มเหลว เช่น business logic เช็คแล้วไม่ผ่าน)
// body: { txId }
app.post("/transaction/rollback", requireBridgeAuth, async (req, res) => {
  const { txId } = req.body || {};
  const tx = txId && activeTransactions.get(txId);
  if (!tx) {
    // อาจถูก auto-rollback ไปแล้วจาก timeout — ไม่ถือเป็น error ร้ายแรง
    return res.json({ ok: true, message: "transaction already ended (possibly auto-rolled-back)" });
  }
  activeTransactions.delete(txId);
  clearTxTimeout(txId);
  try {
    await tx.connection.rollback();
    res.json({ ok: true });
  } catch (err) {
    console.error(`bridge /transaction/rollback error (tx ${txId}):`, err.message);
    res.status(500).json({ ok: false, message: err.message });
  } finally {
    tx.connection.release();
  }
});

// -------------------------------------------------------------
// [BLOB migration] เอา POST /upload-image และ DELETE /image ออกแล้ว —
// รูปภาพตอนนี้เก็บเป็น LONGBLOB ตรงในตาราง room_tags/room_images ผ่าน
// endpoint /query, /transaction/* เดิมที่มีอยู่แล้วด้านบน (เหมือนข้อมูล
// อื่นทุกจุด) ไม่ต้องมี endpoint แยกสำหรับไฟล์รูปอีกต่อไป — ดู
// admin_rooms.js ฝั่ง Render สำหรับ query INSERT/SELECT ที่เกี่ยวข้อง
// -------------------------------------------------------------

// -------------------------------------------------------------
// 404 fallback — ไม่ต้อง auth เพราะไม่มี route ให้ตรงอยู่แล้ว ไม่แตะ DB
// -------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({ ok: false, message: "not found" });
});

const server = app.listen(PORT, () => {
  console.log(`✓ bridge-server.js กำลังรันที่ http://localhost:${PORT}`);
  console.log(`  เปิด Cloudflare Tunnel ชี้มาที่พอร์ตนี้แยกต่างหาก:`);
  console.log(`  cloudflared tunnel --url http://localhost:${PORT}`);
});

// -------------------------------------------------------------
// ปิด pool ให้เรียบร้อยตอน process ถูกสั่งหยุด (Ctrl+C หรือ systemd
// stop) กัน connection ค้างใน MySQL
// -------------------------------------------------------------
async function shutdown() {
  console.log("\nกำลังปิด bridge-server.js ...");
  // rollback + release transaction ที่ยังค้างอยู่ทั้งหมดก่อนปิด pool กัน
  // connection ค้างใน MySQL หลัง process ตาย
  for (const [txId, tx] of activeTransactions.entries()) {
    clearTxTimeout(txId);
    try {
      await tx.connection.rollback();
    } catch (err) {
      console.error(`rollback transaction ${txId} ตอนปิดเครื่อง ล้มเหลว:`, err.message);
    } finally {
      tx.connection.release();
    }
  }
  activeTransactions.clear();

  server.close(async () => {
    try {
      await pool.end();
    } catch (err) {
      console.error("ปิด pool ไม่สำเร็จ:", err.message);
    }
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);