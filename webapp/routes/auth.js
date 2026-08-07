// routes/auth.js
// -----------------------------------------------------------------
// เหลือแค่ ครู + แอดมิน (ตัดนักเรียนออกทั้งหมดตามสถาปัตยกรรมใหม่ —
// ระบบนี้ไม่มีนักเรียนเข้าใช้งานเว็บแล้ว มีแค่ครูที่ยืม-คืนกุญแจผ่าน
// การแตะแท็กจริงที่เครื่องอ่าน ไม่ใช่ผ่านฟอร์มเว็บ)
//
// *** เปลี่ยนใหญ่: ตัด teacher login/register แบบกรอกรหัสครูเองออก
// ทั้งหมด *** ครูไม่ login ผ่านเว็บอีกต่อไป — การสมัครเปลี่ยนเป็น
// "กรอกชื่อ-แผนก แล้วไปแตะบัตรประจำตัวที่เครื่องอ่านที่ห้องทะเบียน"
// โดย tag_uid จะถูกผูกให้อัตโนมัติทันทีที่แตะ (ดู routes/tap.js +
// routes/register_session.js ประกอบ) ไม่มีขั้นตอน "แอดมินผูกแท็ก
// ทีหลัง" อีกต่อไปสำหรับ flow ปกติ
// -----------------------------------------------------------------
const express = require("express");
const router = express.Router();
const supabase = require("../config/supabaseClient");
const { signToken, requireAuth } = require("./middleware_auth");
const {
  startRegistration,
  pollRegistration,
  clearRegistration,
} = require("./register_session");

// =================================================================
// ครู — สมัครด้วยการแตะบัตร (ไม่มี login ผ่านเว็บอีกต่อไป)
// =================================================================

// -------------------------------------------------------------
// POST /api/register/teacher/start
// body: { name, department, readerId? }
// เปิด "pending registration session" รอให้มีคนไปแตะบัตรที่เครื่องอ่าน
// ที่ห้องทะเบียน (readerId เดียวกับที่ tap.js ใช้ — ไม่ส่งมาก็ default
// เป็น "default" เพราะตอนนี้มีเครื่องอ่านเครื่องเดียว)
//
// หน้าเว็บต้องเรียก POST นี้ก่อน แล้วค่อยเริ่ม poll
// GET /api/register/teacher/session ต่อเนื่องจนกว่าจะสำเร็จ/timeout
// -------------------------------------------------------------
router.post("/register/teacher/start", (req, res) => {
  const { name, department, readerId } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ ok: false, message: "กรุณากรอกชื่อ-นามสกุล" });
  }

  const reader = startRegistration(readerId, name.trim(), department ? department.trim() : null);

  return res.json({
    ok: true,
    readerId: reader,
    message: "กรุณาไปแตะบัตรประจำตัวครูที่เครื่องอ่านที่ห้องทะเบียนภายใน 60 วินาที",
  });
});

// -------------------------------------------------------------
// GET /api/register/teacher/session?readerId=xxx
// ให้หน้าเว็บ poll เช็คว่ามีคนแตะบัตรเข้ามาจับคู่กับ session สมัครนี้
// หรือยัง — response 3 แบบ:
//   { active: true, ... }                     ยังรออยู่ ยังไม่หมดเวลา
//   { active: false, result: { ok: true, ... } }   แตะสำเร็จ ผูกแท็กแล้ว
//   { active: false, result: { ok: false, ... } }  แตะแล้วแต่ error (เช่นบัตรซ้ำ)
//   { active: false }                          หมดเวลา / ไม่มี session
// -------------------------------------------------------------
router.get("/register/teacher/session", (req, res) => {
  const reader = (req.query.readerId || "default").toString();
  const status = pollRegistration(reader);
  return res.json({ ok: true, ...status });
});

// -------------------------------------------------------------
// POST /api/register/teacher/cancel
// body: { readerId } — ยกเลิกการสมัครก่อนหมดเวลาเอง (เช่น ครูกดยกเลิก
// หรือหน้าเว็บถูกปิดไประหว่างรอ)
// -------------------------------------------------------------
router.post("/register/teacher/cancel", (req, res) => {
  const reader = (req.body.readerId || "default").toString();
  clearRegistration(reader);
  return res.json({ ok: true });
});

// =================================================================
// แอดมิน — ไม่เปลี่ยนแปลงจากเดิม ยังคง login ด้วย username/password
// เทียบกับ environment variable เท่านั้น
// =================================================================

// -------------------------------------------------------------
// POST /api/login/admin
// body: { username, password }
// เทียบกับค่าที่ตั้งไว้ใน environment variable เท่านั้น (ไม่มีในฐานข้อมูล)
// -------------------------------------------------------------
router.post("/login/admin", (req, res) => {
  const { username, password } = req.body;
  const validUsername = process.env.ADMIN_USERNAME;
  const validPassword = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    return res.status(400).json({ ok: false, message: "กรุณากรอก username และ password" });
  }

  if (username === validUsername && password === validPassword) {
    const token = signToken({ role: "admin", id: null, name: "admin" });
    return res.json({ ok: true, role: "admin", token });
  }

  return res.status(401).json({ ok: false, message: "username หรือ password ไม่ถูกต้อง" });
});

// -------------------------------------------------------------
// GET /api/me
// -------------------------------------------------------------
router.get("/me", requireAuth, (req, res) => {
  return res.json({ ok: true, user: req.user });
});

module.exports = router;