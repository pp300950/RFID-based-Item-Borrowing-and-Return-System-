// server.js
// -----------------------------------------------------------------
// Entry point ของ backend (Express + Supabase)
//
// สถาปัตยกรรมใหม่ (ดู README.md ประกอบ):
//   - ตัดนักเรียนออกทั้งหมด, ตัด "ของ" (room_items) ออก — เหลือแค่
//     ครู กับ กุญแจ
//   - ตัด flow pending/approve ออกทั้งหมด — แตะแท็ก = จบทันที
//   - ตัด teacher_room_assignments ออก — ครูคนไหนมีแท็กก็ยืมห้องไหนก็ได้
//   - /api/tap เป็น endpoint สาธารณะสำหรับเครื่องอ่านแท็กที่ห้องทะเบียน
//     (ไม่ผ่าน requireAuth เพราะตัวเครื่องเองคือจุดที่ต้องเชื่อถือได้
//     อยู่แล้วทางกายภาพ ไม่ใช่ "ผู้ใช้ที่ login")
// -----------------------------------------------------------------

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const { requireAuth, requireRole } = require("./routes/middleware_auth");

const authRoutes = require("./routes/auth");
const tapRoutes = require("./routes/tap");
const keysRoutes = require("./routes/keys");
const adminRoomsRoutes = require("./routes/admin_rooms");
// NOTE: keysRoutes ถูก require ไว้แล้วแต่ไม่เคย app.use() จริง — เป็นสาเหตุที่
// หน้าเว็บ (login.html/teacher.html เดิม) เรียก /api/keys/* แล้ว 404 เพราะ
// route ไม่เคยถูกต่อเข้าระบบเลย เพิ่ม mount ไว้ด้านล่างแล้ว
const adminTeachersRoutes = require("./routes/admin_teachers");
const adminKeysRoutes = require("./routes/admin_keys");
const exportRoutes = require("./routes/export");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// -------------------------------------------------------------
// Static frontend (public/)
// -------------------------------------------------------------
app.use(express.static(path.join(__dirname, "public")));

// -------------------------------------------------------------
// Auth routes (สมัคร/ล็อกอินครู, ล็อกอินแอดมิน, /api/me)
//   mount ที่ /api ตรงๆ เพราะแต่ละ route ในไฟล์กำหนด path เต็มไว้แล้ว
//   เช่น /register/teacher, /login/teacher, /login/admin, /me
// -------------------------------------------------------------
app.use("/api", authRoutes);

// -------------------------------------------------------------
// Tap routes (เครื่องอ่านแท็ก RFID ที่ห้องทะเบียน) — สาธารณะ ไม่มี JWT
//   /api/tap, /api/tap/session, /api/tap/session/clear
// -------------------------------------------------------------
app.use("/api", tapRoutes);

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
});