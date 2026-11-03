// routes/auth.js
// -----------------------------------------------------------------
// เหลือแค่ ครู + แอดมิน (ตัดนักเรียนออกทั้งหมดตามสถาปัตยกรรมใหม่ —
// ระบบนี้ไม่มีนักเรียนเข้าใช้งานเว็บแล้ว มีแค่ครูที่ยืม-คืนกุญแจผ่าน
// การแตะแท็กจริงที่เครื่องอ่าน ไม่ใช่ผ่านฟอร์มเว็บ)
//
// [พ.ย. 2026] ตัด flow สมัครครูแบบ "กรอกชื่อ-แผนก แล้วไปแตะบัตรที่
// เครื่องอ่าน" (poll รอจนกว่าจะมีคนแตะบัตร) ออกทั้งหมด — โรงเรียนเลิก
// ใช้บัตร RFID ประจำตัวครูแล้ว ไม่มี routes/register_session.js อีก
// ต่อไป (ลบไฟล์ทิ้งทั้งไฟล์) สมัครครูเปลี่ยนเป็น endpoint เดียวจบ:
// กรอกชื่อ-แผนก-รหัสประจำตัว (teacherCode) แล้วเสร็จทันที ไม่ต้อง poll
// รอแตะบัตรอีกต่อไป — การเปิด session ยืม-คืนกุญแจย้ายไปที่
// routes/tap.js (POST /api/tap/teacher-code) ซึ่งครูพิมพ์รหัสประจำตัว
// เดียวกันนี้ที่หน้าจอห้องทะเบียนตอนจะยืม/คืนจริง — กุญแจห้อง
// (room_tags) ยังใช้แตะแท็ก RFID เหมือนเดิมทุกอย่าง ไม่กระทบ
// -----------------------------------------------------------------
const express = require("express");
const router = express.Router();
const { query } = require("../config/db");
const { signToken, requireAuth } = require("./middleware_auth");

// =================================================================
// ครู — สมัครด้วยการกรอกรหัสประจำตัว (ไม่มี login ผ่านเว็บ)
// =================================================================

// -------------------------------------------------------------
// POST /api/register/teacher
// body: { name, department, teacherCode }
// สมัครครูใหม่ — endpoint เดียวจบ รู้ผลทันที ไม่ต้อง poll รอแตะบัตร
// เหมือน flow เดิม (ดู comment หัวไฟล์)
//
// กติกา:
//   - name: บังคับกรอก ห้ามเป็นค่าว่าง/เว้นวรรคล้วน
//   - department: ไม่บังคับ
//   - teacherCode: บังคับกรอก ต้องเป็นตัวเลขล้วนเท่านั้น (คีย์แพดตัวเลข
//     หน้า display.html) และห้ามซ้ำกับครูที่มีอยู่แล้ว (unique key
//     uq_teachers_teacher_code ใน schema.sql เป็น safety net อีกชั้น
//     เผื่อ race condition ระหว่าง pre-check กับ insert จริง)
// -------------------------------------------------------------
router.post("/register/teacher", async (req, res) => {
  const { name, department, teacherCode } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ ok: false, message: "กรุณากรอกชื่อ-นามสกุล" });
  }

  if (!teacherCode || !teacherCode.toString().trim()) {
    return res.status(400).json({ ok: false, message: "กรุณากรอกรหัสประจำตัวครู" });
  }

  const cleanTeacherCode = teacherCode.toString().trim();

  if (!/^[0-9]+$/.test(cleanTeacherCode)) {
    return res.status(400).json({ ok: false, message: "รหัสประจำตัวครูต้องเป็นตัวเลขเท่านั้น" });
  }

  const cleanName = name.trim();
  const cleanDepartment = department && department.trim() ? department.trim() : null;

  try {
    const [existingRows] = await query(
      "SELECT id FROM teachers WHERE teacher_code = ?",
      [cleanTeacherCode]
    );

    if (existingRows.length > 0) {
      return res.status(409).json({
        ok: false,
        message: "รหัสประจำตัวนี้ถูกใช้ไปแล้ว กรุณาตั้งรหัสอื่น",
      });
    }

    const [insertResult] = await query(
      "INSERT INTO teachers (name, department, teacher_code) VALUES (?, ?, ?)",
      [cleanName, cleanDepartment, cleanTeacherCode]
    );

    const [createdRows] = await query("SELECT * FROM teachers WHERE id = ?", [
      insertResult.insertId,
    ]);

    return res.json({
      ok: true,
      message: `สมัครสำเร็จ — คุณครู ${cleanName}`,
      teacher: createdRows[0],
    });
  } catch (err) {
    if (err && (err.code === "ER_DUP_ENTRY" || err.errno === 1062)) {
      return res.status(409).json({
        ok: false,
        message: "รหัสประจำตัวนี้ถูกใช้ไปแล้ว กรุณาตั้งรหัสอื่น",
      });
    }
    console.error("Teacher register error:", err.message);
    return res.status(500).json({ ok: false, message: "สมัครครูไม่สำเร็จ" });
  }
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