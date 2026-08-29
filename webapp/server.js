// server.js
// -----------------------------------------------------------------
// Entry point ของ backend (Express + MySQL/MariaDB ผ่าน config/db.js)
//
// สถาปัตยกรรมใหม่ (ดู README.md ประกอบ):
//   - ตัดนักเรียนออกทั้งหมด, ตัด "ของ" (room_items) ออก — เหลือแค่
//     ครู กับ กุญแจ
//   - ตัด flow pending/approve ออกทั้งหมด — แตะแท็ก = จบทันที
//   - ตัด teacher_room_assignments ออก — ครูคนไหนมีแท็กก็ยืมห้องไหนก็ได้
//   - /api/tap เป็น endpoint สาธารณะสำหรับเครื่องอ่านแท็กที่ห้องทะเบียน
//     (ไม่ผ่าน requireAuth เพราะตัวเครื่องเองคือจุดที่ต้องเชื่อถือได้
//     อยู่แล้วทางกายภาพ ไม่ใช่ "ผู้ใช้ที่ login")
//
// ไฟล์นี้ (และทุก route ที่ require เข้ามา) ไม่ผูกกับ "ที่รัน" เลย —
// การเชื่อมต่อฐานข้อมูลทั้งหมดอ่านจาก environment variables ผ่าน
// config/db.js (DB_HOST/DB_USER/DB_PASSWORD/DB_NAME) เท่านั้น ไม่มี
// localhost หรือค่าคงที่ฝังในโค้ดที่ไหนเลย จึงรันได้ด้วยโค้ดชุดเดียวกัน
// ทั้งสองที่:
//   - เครื่อง local (npm start + XAMPP): .env ตั้ง DB_HOST=localhost
//   - Render (ออนไลน์): Environment Variable ตั้ง DB_HOST เป็น
//     Cloudflare Tunnel ที่ชี้กลับมาที่ MySQL บนเครื่อง local เครื่อง
//     เดียวกัน (ดู README.md section 7 และ FOR_ME.md section 7)
// -----------------------------------------------------------------

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const { requireAuth, requireRole } = require("./routes/middleware_auth");
const { query } = require("./config/db");

const authRoutes = require("./routes/auth");
const tapRoutes = require("./routes/tap");
const keysRoutes = require("./routes/keys");
const adminRoomsRoutes = require("./routes/admin_rooms");
const adminTeachersRoutes = require("./routes/admin_teachers");
const adminKeysRoutes = require("./routes/admin_keys");
const exportRoutes = require("./routes/export");
const lineWebhookRoutes = require("./routes/line_webhook");
const adminLineRoutes = require("./routes/admin_line");
const { runOverdueCheck } = require("./services/overdue_checker");
const { sendGroupMessage, buildServerReadyMessage } = require("./services/line_notify");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// -------------------------------------------------------------
// [LINE webhook] ต้อง mount ก่อน express.json() เสมอ เพราะการ verify
// signature ของ LINE (x-line-signature header) ต้องคำนวณจาก raw body
// ดิบๆ ก่อนถูก parse เป็น JSON object — ถ้า mount หลัง express.json()
// จะไม่มี raw body ให้ใช้ตรวจสอบแล้ว (req.body จะถูกแปลงเป็น object
// ไปแล้ว) จึงต้องใช้ express.raw() เฉพาะ path นี้ แล้วค่อย parse JSON
// เองในไฟล์ route (ดู routes/line_webhook.js ที่ใช้ req.rawBody)
// -------------------------------------------------------------
app.use(
  "/api/line/webhook",
  express.raw({ type: "*/*" }),
  (req, res, next) => {
    req.rawBody = req.body; // เก็บ Buffer ดิบไว้ verify signature
    try {
      req.body = req.body.length ? JSON.parse(req.body.toString("utf8")) : {};
    } catch (err) {
      console.error("LINE webhook: parse JSON body ไม่สำเร็จ:", err.message);
      req.body = {};
    }
    next();
  }
);

app.use(express.json());

// -------------------------------------------------------------
// Static frontend (public/)
// -------------------------------------------------------------
app.use(express.static(path.join(__dirname, "public")));

// -------------------------------------------------------------
// Auth routes (สมัครครูด้วยการแตะบัตร, ล็อกอินแอดมิน, /api/me)
//   mount ที่ /api ตรงๆ เพราะแต่ละ route ในไฟล์กำหนด path เต็มไว้แล้ว
//   เช่น /register/teacher/start, /register/teacher/session,
//   /register/teacher/cancel, /login/admin, /me
//   (ครูไม่ login ผ่านเว็บอีกต่อไป — ตัด /register/teacher,
//   /login/teacher แบบกรอกรหัสเองออกไปแล้วตามสถาปัตยกรรมใหม่)
// -------------------------------------------------------------
app.use("/api", authRoutes);

// -------------------------------------------------------------
// Tap routes (เครื่องอ่านแท็ก RFID ที่ห้องทะเบียน) — สาธารณะ ไม่มี JWT
//   /api/tap, /api/tap/session, /api/tap/session/clear
// -------------------------------------------------------------
app.use("/api", tapRoutes);

// -------------------------------------------------------------
// [LINE webhook] รับ event จาก LINE (join กลุ่ม, leave กลุ่ม ฯลฯ)
// public เช่นกัน เพราะ LINE server เป็นผู้ยิงมาตรง ไม่ใช่ user ที่ login
// ผ่านเว็บ ความปลอดภัยอยู่ที่การ verify signature ข้างในไฟล์ route แทน
// -------------------------------------------------------------
app.use("/api", lineWebhookRoutes);

// -------------------------------------------------------------
// [BLOB migration] รูปภาพห้อง — public, ไม่ต้อง login เพราะหน้า
// keys.html (สถานะกุญแจ) เป็นหน้าสาธารณะที่ต้องโชว์รูปห้องด้วย
// เดิมรูปเป็นไฟล์บนดิสก์เสิร์ฟผ่าน express.static(public/) ตรงๆ —
// ตอนนี้เก็บเป็น LONGBLOB ใน MySQL แทน (ดู README/admin_rooms.js) จึง
// ต้องมี route ดึงกลับมาเป็นไฟล์รูปให้ <img src="..."> ใช้ได้ตรงๆ
// path คงรูปแบบเดิม /uploads/room-images/... ไว้ กัน frontend เดิม
// ที่ผูก URL แบบนี้อยู่แล้วพัง (ดู public/*.html ถ้ามีจุดอ้างอิงตรงๆ
// ต้องเปลี่ยนเป็น /uploads/room-images/room/:id หรือ
// /uploads/room-images/multi/:imageId แทน path ไฟล์เดิม)
// -------------------------------------------------------------
app.get("/uploads/room-images/room/:id", async (req, res) => {
  try {
    const [rows] = await query(
      `SELECT image_data, image_mime FROM room_tags WHERE id = ? LIMIT 1`,
      [req.params.id]
    );
    if (rows.length === 0 || !rows[0].image_data) {
      return res.status(404).json({ ok: false, message: "ไม่พบรูปภาพนี้" });
    }
    res.set("Content-Type", rows[0].image_mime || "image/jpeg");
    return res.send(rows[0].image_data);
  } catch (err) {
    console.error("Public get room image error:", err.message);
    return res.status(500).json({ ok: false, message: "ดึงรูปภาพไม่สำเร็จ" });
  }
});

app.get("/uploads/room-images/multi/:imageId", async (req, res) => {
  try {
    const [rows] = await query(
      `SELECT image_data, image_mime FROM room_images WHERE id = ? LIMIT 1`,
      [req.params.imageId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, message: "ไม่พบรูปภาพนี้" });
    }
    res.set("Content-Type", rows[0].image_mime || "image/jpeg");
    return res.send(rows[0].image_data);
  } catch (err) {
    console.error("Public get room images (multi) error:", err.message);
    return res.status(500).json({ ok: false, message: "ดึงรูปภาพไม่สำเร็จ" });
  }
});

// -------------------------------------------------------------
// Keys routes — สาธารณะ ไม่ผ่าน requireAuth
//   ครูไม่ login ผ่านเว็บอีกต่อไป (สถาปัตยกรรมใหม่) หน้าดูสถานะกุญแจ
//   จึงต้องเป็นหน้าสาธารณะ ใครก็เข้าดูได้โดยไม่ต้องมี token
//   /api/keys/status  (ดูได้)
//   หมายเหตุ: /api/keys/history/mine ถูกตัดออกจาก keys.js แล้ว เพราะ
//   ไม่มี "ผู้ใช้ที่ login" ให้อ้างอิงว่า "ตัวเอง" คือใครอีกต่อไป
// -------------------------------------------------------------
app.use("/api", keysRoutes);

// -------------------------------------------------------------
// Admin routes — ทุก /api/admin/* ต้อง login เป็นแอดมินก่อนเสมอ
// ป้องกันที่จุดเดียวตรงนี้ ไม่ต้องใส่ middleware ซ้ำในแต่ละไฟล์ route
// -------------------------------------------------------------
app.use(
  "/api/admin",
  requireAuth,
  requireRole("admin"),
  adminRoomsRoutes
);
app.use(
  "/api/admin",
  requireAuth,
  requireRole("admin"),
  adminTeachersRoutes
);
app.use(
  "/api/admin",
  requireAuth,
  requireRole("admin"),
  adminKeysRoutes
);
// export.js เอง (ดูคอมเมนต์หัวไฟล์) ไม่เช็ค auth ซ้ำในตัวเอง — คาดหวังว่า
// จะถูก mount ผ่านกลุ่ม requireAuth + requireRole("admin") เดียวกับไฟล์
// route แอดมินอื่นๆ ทั้งหมดข้างบนนี้ (admin_rooms.js/admin_teachers.js/
// admin_keys.js) จึงต่อไว้ตรงนี้เป็นตัวสุดท้ายในกลุ่มเดียวกัน
app.use(
  "/api/admin",
  requireAuth,
  requireRole("admin"),
  exportRoutes
);
// admin_line.js ก็เข้ากลุ่ม requireAuth + requireRole("admin") เดียวกัน
// นี้ด้วย — เช็คโควต้า LINE / ดูรายการกลุ่มเป็นข้อมูลที่แอดมินเท่านั้น
// ควรเห็น
app.use(
  "/api/admin",
  requireAuth,
  requireRole("admin"),
  adminLineRoutes
);

// -------------------------------------------------------------
// Fallback: ให้ทุกเส้นทางที่ไม่ตรง static file ตกไปที่ login.html
// (SPA-ish fallback ง่ายๆ เผื่อคน refresh หน้าใน route ที่ไม่มีไฟล์ตรงๆ)
// -------------------------------------------------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.use((req, res) => {
  res.status(404).json({ ok: false, message: "ไม่พบเส้นทางนี้" });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);

  // -----------------------------------------------------------
  // [LINE notify] แจ้งเข้ากลุ่มทันทีที่ server เริ่มทำงานสำเร็จ — เรียก
  // แบบ fire-and-forget เหมือนจุดอื่นๆ (ไม่ await, .catch กันเงียบๆ)
  // เพื่อไม่ให้ error จาก LINE (เช่น ยังไม่ได้ตั้งค่ากลุ่ม, โควต้าหมด)
  // ไปหยุดหรือทำให้ server ค้างตอน start — ธุรกิจหลัก (ยืม/คืนกุญแจ)
  // ทำงานได้ปกติไม่ว่าข้อความนี้จะส่งสำเร็จหรือไม่
  //
  // หมายเหตุ: Render จะ restart process นี้ทุกครั้งที่ deploy ใหม่หรือ
  // service sleep แล้วตื่นขึ้นมา (ถ้าใช้ free plan) ดังนั้นข้อความนี้จะ
  // เด้งเข้ากลุ่มค่อนข้างบ่อยตามจังหวะ deploy/restart ไม่ใช่วันละครั้ง
  // -----------------------------------------------------------
  sendGroupMessage(buildServerReadyMessage()).catch((err) =>
    console.error("server.js: sendGroupMessage (server ready) ล้มเหลว:", err.message)
  );
});

// -------------------------------------------------------------
// [LINE notify] Cron เช็คกุญแจเกินเวลาคืน — ค่า default ทุก 15 นาที
// ปรับได้ผ่าน env OVERDUE_CHECK_CRON (รูปแบบ cron expression มาตรฐาน
// 5 ช่อง เช่น "*/30 * * * *" = ทุก 30 นาที) — รันบน process เดียวกับ
// เว็บ (Render Web Service เดียวกัน) ไม่ต้องแยก worker
//
// หมายเหตุ: cron นี้ทำงานได้ก็ต่อเมื่อ process นี้ (Render) ยังต่อ
// ฐานข้อมูลผ่าน bridge ได้อยู่ (เครื่อง local + bridge-server.js ต้อง
// เปิดค้างไว้ตาม README section 11) ถ้า bridge ล่ม cron จะ log error
// ทุกรอบแต่ไม่ทำให้ตัวเว็บล่มตาม (query() จะ throw แล้วถูก catch ใน
// runOverdueCheck เอง)
// -------------------------------------------------------------
const cron = require("node-cron");
const OVERDUE_CHECK_CRON = process.env.OVERDUE_CHECK_CRON || "*/15 * * * *";

if (cron.validate(OVERDUE_CHECK_CRON)) {
  cron.schedule(OVERDUE_CHECK_CRON, () => {
    runOverdueCheck().catch((err) =>
      console.error("Cron runOverdueCheck ล้มเหลว:", err.message)
    );
  });
  console.log(`[cron] ตั้งเวลาตรวจกุญแจเกินเวลาคืนแล้ว: "${OVERDUE_CHECK_CRON}"`);
} else {
  console.error(
    `[cron] OVERDUE_CHECK_CRON ไม่ใช่ cron expression ที่ถูกต้อง: "${OVERDUE_CHECK_CRON}" — ปิดการเช็คเกินเวลาไว้ก่อน`
  );
}