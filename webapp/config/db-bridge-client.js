// config/db-bridge-client.js
// -----------------------------------------------------------------
// ใช้เมื่อ DB_MODE=bridge (รันบน Render) — ยิง HTTP ไปหา bridge-server.js
// (รันอยู่บนเครื่อง local คู่กับ XAMPP ผ่าน Cloudflare Tunnel) แทนการต่อ
// MySQL ตรงๆ
//
// export query()/withTransaction() ที่ "หน้าตาเหมือนเดิมทุกจุด" กับ
// config/mysql-pool.js (โหมด local) — route files ไม่ต้องรู้ว่าเบื้อง
// หลังเป็น TCP ตรงหรือ HTTP bridge เลย ดู README section 11.2
//
// ตัวแปร env ที่ต้องตั้ง (บน Render):
//   DB_BRIDGE_URL   URL ของ bridge (เช่น https://xxxxx.trycloudflare.com)
//   DB_BRIDGE_KEY   ต้องตรงกับ BRIDGE_AUTH_KEY ที่ตั้งไว้บนเครื่อง local
// -----------------------------------------------------------------

require("dotenv").config();

const BRIDGE_URL = process.env.DB_BRIDGE_URL;
const BRIDGE_KEY = process.env.DB_BRIDGE_KEY;

if (!BRIDGE_URL || !BRIDGE_KEY) {
  console.warn(
    "⚠️  DB_MODE=bridge แต่ยังไม่ได้ตั้ง DB_BRIDGE_URL หรือ DB_BRIDGE_KEY\n" +
    "   ทุก request ที่ต้องใช้ฐานข้อมูลจะ error ทันที — ตั้งค่าทั้งสองตัว" +
    " ให้ตรงกับที่เครื่อง local ใช้ (BRIDGE_AUTH_KEY) และ URL ของ tunnel"
  );
}

// timeout ของแต่ละ HTTP call ไปหา bridge — ต้องเผื่อ latency ของ
// Cloudflare Tunnel ที่มากกว่าเชื่อม localhost ตรงๆ (เหมือนที่คอมเมนต์
// เดิมใน connectTimeout ของ mysql-pool.js เตือนไว้เรื่อง tunnel latency)
const FETCH_TIMEOUT_MS = 20000;

async function bridgeFetch(path, body) {
  if (!BRIDGE_URL || !BRIDGE_KEY) {
    throw new Error("DB_BRIDGE_URL / DB_BRIDGE_KEY ยังไม่ได้ตั้งค่า");
  }
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${BRIDGE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bridge-Key": BRIDGE_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`bridge request timeout หลังจาก ${FETCH_TIMEOUT_MS}ms (${path}) — เช็คว่าเครื่อง local + bridge-server.js + tunnel ยังรันอยู่ไหม`);
    }
    throw new Error(`ต่อ bridge ไม่ได้ (${path}): ${err.message} — เช็คว่าเครื่อง local + bridge-server.js + tunnel ยังรันอยู่ไหม`);
  } finally {
    clearTimeout(timeoutHandle);
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error(`bridge ตอบกลับไม่ใช่ JSON ที่ถูกต้อง (${path}): ${err.message}`);
  }

  if (!response.ok || !data.ok) {
    // จำลอง error shape ให้เหมือน mysql2 error จริงๆ เท่าที่ทำได้ — route
    // files บางจุดอาจเช็ค err.code (เช่น "ER_DUP_ENTRY") ตอน catch ต้อง
    // ให้ property พวกนี้ยังอยู่แม้จะมาจาก bridge ไม่ใช่ mysql2 ตรงๆ
    const err = new Error(data.message || `bridge request failed (${path})`);
    err.code = data.code || null;
    err.sqlMessage = data.sqlMessage || null;
    err.isBridgeError = true;
    throw err;
  }

  return data;
}

/**
 * query() แบบเดียวกับ mysql-pool.js — คืนค่าเป็น [rows, fields] tuple
 * เพื่อให้ route files ที่เขียน `const [rows] = await query(...)` ใช้
 * ได้แบบเดียวกันทุกจุด ไม่ว่าจะโหมดไหน
 */
async function query(sql, params) {
  const data = await bridgeFetch("/query", { sql, params });
  return [data.rows, data.fields];
}

/**
 * withTransaction(callback) — หน้าตาเหมือน mysql-pool.js เป๊ะ แต่เบื้อง
 * หลังคนละกลไก: เปิด transaction ค้างไว้ที่ bridge (ผ่าน /transaction/
 * begin) แล้วสร้าง "fake connection" ส่งเข้า callback แทน connection
 * ของ mysql2 จริง — ทุกครั้งที่ callback เรียก conn.query(...) จะยิง
 * HTTP ไปหา /transaction/query ทันที (ไม่ batch ล่วงหน้า) เพื่อให้
 * callback ที่มี branching logic ตามผลลัพธ์ query ก่อนหน้าทำงานได้ถูก
 * ต้องเหมือนโหมด local ทุกประการ — ดูเหตุผลเต็มๆ ใน bridge-server.js
 * ส่วน "Transaction แบบ interactive"
 *
 * ถ้า callback throw เอง (ไม่ใช่ query ล้มเหลว) จะเรียก
 * /transaction/rollback ให้ก่อน throw error เดิมต่อ — พฤติกรรมเหมือน
 * mysql-pool.js เป๊ะ (route ข้างนอกจับ error แล้วตอบ { ok: false } ตาม
 * pattern เดิมได้เลย)
 */
async function withTransaction(callback) {
  const { txId } = await bridgeFetch("/transaction/begin", {});

  const fakeConnection = {
    async query(sql, params) {
      // ไม่ครอบ try/catch ตรงนี้ — ปล่อยให้ error จาก bridgeFetch (ซึ่งฝั่ง
      // bridge-server.js rollback ให้แล้วตั้งแต่จุดนั้นถ้า query ล้มเหลว
      // กลางทาง transaction) โยนขึ้นไปให้ withTransaction() ข้างล่างจับ
      const data = await bridgeFetch("/transaction/query", { txId, sql, params });
      return [data.rows, data.fields];
    },
  };

  let result;
  try {
    result = await callback(fakeConnection);
  } catch (err) {
    // callback throw เอง (เช่น business logic เช็คแล้วไม่ผ่าน ไม่ใช่
    // query ล้มเหลว) — ต้องสั่ง rollback เอง เพราะ bridge-server.js จะ
    // auto-rollback เฉพาะตอน query ล้มเหลวหรือ timeout เท่านั้น ไม่รู้ว่า
    // callback ฝั่งนี้ throw ด้วยเหตุผลอื่น
    try {
      await bridgeFetch("/transaction/rollback", { txId });
    } catch (rollbackErr) {
      console.error("rollback ผ่าน bridge ล้มเหลว:", rollbackErr.message);
    }
    throw err;
  }

  // callback จบแบบไม่ throw — commit จริง
  await bridgeFetch("/transaction/commit", { txId });
  return result;
}

// bridge mode ไม่มี pool หรือ raw connection ให้ route files ใช้ตรงๆ —
// ถ้ามีโค้ดที่อยากได้ pool.query() ตรงๆ (ข้าม db.js) หรือ getConnection()
// แบบ manual จะพังตอนรันโหมด bridge โดยตั้งใจ ให้ error ชัดเจนแทนที่จะ
// undefined เงียบๆ เพราะรูปแบบนี้ยิง SQL หลาย statement บน connection
// เดียวข้ามเวลาแบบที่ HTTP bridge (per-request) รองรับยาก
function getConnection() {
  throw new Error(
    "getConnection() ใช้ไม่ได้ในโหมด DB_MODE=bridge — ถ้าต้องการรันหลาย" +
    " query ในธุรกรรมเดียว ให้ใช้ withTransaction(callback) แทน (route" +
    " files ไม่ควรเรียก getConnection() ตรงๆ อยู่แล้วตาม pattern ที่ตกลง" +
    " กันไว้ ดู README section 13.2 ข้อ 9)"
  );
}

module.exports = {
  query,
  withTransaction,
  getConnection,
  pool: null,
};
