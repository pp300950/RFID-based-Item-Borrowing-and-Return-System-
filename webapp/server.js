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
const adminTeachersRoutes = require("./routes/admin_teachers");
const adminKeysRoutes = require("./routes/admin_keys");

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
