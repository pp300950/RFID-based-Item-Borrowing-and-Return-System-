// routes/auth.js
const express = require("express");
const router = express.Router();
const supabase = require("../config/supabaseClient");

// รหัสนักเรียนต้องขึ้นต้นด้วย 693190 และมีความยาวรวม 11 หลัก
// (ตัวอย่างจากสเปก: 69319011766)
const STUDENT_CODE_PREFIX = "693190";
const STUDENT_CODE_LENGTH = 11;

function isValidStudentCode(code) {
  if (typeof code !== "string") return false;
  if (code.length !== STUDENT_CODE_LENGTH) return false;
  if (!code.startsWith(STUDENT_CODE_PREFIX)) return false;
  if (!/^\d+$/.test(code)) return false; // ต้องเป็นตัวเลขล้วน
  return true;
}

// -------------------------------------------------------------
// POST /api/login/student
// body: { name, room, seatNo, studentCode }
// - ไม่ตรวจสอบกับฐานข้อมูลภายนอกใดๆ เช็คแค่ format
// - ถ้ายังไม่เคยมี record นี้ -> สร้างใหม่ (auto-register)
// - ถ้ามีแล้ว -> อัปเดต last_login_at
// -------------------------------------------------------------
router.post("/login/student", async (req, res) => {
  const { name, room, seatNo, studentCode } = req.body;

  if (!name || !room || !seatNo || !studentCode) {
    return res.status(400).json({ ok: false, message: "กรุณากรอกข้อมูลให้ครบทุกช่อง" });
  }

  if (!isValidStudentCode(studentCode)) {
    return res.status(400).json({
      ok: false,
      message: `รหัสประจำตัวนักเรียนไม่ถูกต้อง ต้องขึ้นต้นด้วย ${STUDENT_CODE_PREFIX} และมีทั้งหมด ${STUDENT_CODE_LENGTH} หลัก`,
    });
  }

  try {
    // เช็คว่ามี record นี้อยู่แล้วหรือยัง (ผูกด้วย student_code)
    const { data: existing, error: findError } = await supabase
      .from("students")
      .select("*")
      .eq("student_code", studentCode)
      .maybeSingle();

    if (findError) throw findError;

    if (existing) {
      // เคยสมัครแล้ว -> อัปเดตเวลาล็อกอินล่าสุด
      const { data: updated, error: updateError } = await supabase
        .from("students")
        .update({ last_login_at: new Date().toISOString() })
        .eq("id", existing.id)
        .select()
        .single();

      if (updateError) throw updateError;

      return res.json({ ok: true, mode: "login", student: updated });
    }

    // ยังไม่เคยมี -> สร้างบัญชีใหม่อัตโนมัติ
    const { data: created, error: insertError } = await supabase
      .from("students")
      .insert({
        name,
        room,
        seat_no: seatNo,
        student_code: studentCode,
        last_login_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return res.json({ ok: true, mode: "register", student: created });
  } catch (err) {
    console.error("Student login error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "เชื่อมต่อฐานข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง หรือเช็คว่าตั้งค่าคีย์ Supabase ถูกต้องหรือยัง",
    });
  }
});

// -------------------------------------------------------------
// POST /api/login/admin
// body: { username, password }
// - เทียบกับค่าที่ตั้งไว้ใน environment variable เท่านั้น (ไม่มีในฐานข้อมูล)
// -------------------------------------------------------------
router.post("/login/admin", (req, res) => {
  const { username, password } = req.body;
  const validUsername = process.env.ADMIN_USERNAME;
  const validPassword = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    return res.status(400).json({ ok: false, message: "กรุณากรอก username และ password" });
  }

  if (username === validUsername && password === validPassword) {
    // เวอร์ชันทดสอบ: ยังไม่ทำ session/JWT จริงจัง แค่ตอบกลับว่าเข้าได้
    return res.json({ ok: true, role: "admin" });
  }

  return res.status(401).json({ ok: false, message: "username หรือ password ไม่ถูกต้อง" });
});

module.exports = router;
