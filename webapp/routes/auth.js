// routes/auth.js
const express = require("express");
const router = express.Router();
const supabase = require("../config/supabaseClient");

// รหัสนักเรียนต้องขึ้นต้นด้วย 693190 และมีความยาวรวม 11 หลัก
// (ตัวอย่างจากสเปก: 69319011766)
const STUDENT_CODE_PREFIX = "693190";
const STUDENT_CODE_LENGTH = 11;

// รหัสครู: ไม่บังคับ prefix เฉพาะ แต่ต้องเป็นตัวเลข 6-12 หลัก
// (ปรับได้ภายหลังตามรูปแบบรหัสครูจริงของโรงเรียน)
const TEACHER_CODE_MIN_LENGTH = 6;
const TEACHER_CODE_MAX_LENGTH = 12;

function isValidStudentCode(code) {
  if (typeof code !== "string") return false;
  if (code.length !== STUDENT_CODE_LENGTH) return false;
  if (!code.startsWith(STUDENT_CODE_PREFIX)) return false;
  if (!/^\d+$/.test(code)) return false; // ต้องเป็นตัวเลขล้วน
  return true;
}

function isValidTeacherCode(code) {
  if (typeof code !== "string") return false;
  if (code.length < TEACHER_CODE_MIN_LENGTH || code.length > TEACHER_CODE_MAX_LENGTH) return false;
  if (!/^\d+$/.test(code)) return false; // ต้องเป็นตัวเลขล้วน
  return true;
}

// =================================================================
// นักเรียน
// =================================================================

// -------------------------------------------------------------
// POST /api/register/student
// body: { name, room, seatNo, studentCode }
// - สร้างบัญชีใหม่เท่านั้น ถ้ามี student_code นี้อยู่แล้วจะ error
//   แจ้งให้ไปหน้าเข้าสู่ระบบแทน (ไม่ auto-login ทับ)
// -------------------------------------------------------------
router.post("/register/student", async (req, res) => {
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
    const { data: existing, error: findError } = await supabase
      .from("students")
      .select("id")
      .eq("student_code", studentCode)
      .maybeSingle();

    if (findError) throw findError;

    if (existing) {
      return res.status(409).json({
        ok: false,
        message: "รหัสประจำตัวนักเรียนนี้เคยสมัครไว้แล้ว กรุณาไปที่แท็บเข้าสู่ระบบแทน",
      });
    }

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

    return res.json({ ok: true, student: created });
  } catch (err) {
    console.error("Student register error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "เชื่อมต่อฐานข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง หรือเช็คว่าตั้งค่าคีย์ Supabase ถูกต้องหรือยัง",
    });
  }
});

// -------------------------------------------------------------
// POST /api/login/student
// body: { studentCode }
// - เข้าสู่ระบบด้วยรหัสประจำตัวนักเรียนอย่างเดียว ไม่สร้างบัญชีใหม่
// -------------------------------------------------------------
router.post("/login/student", async (req, res) => {
  const { studentCode } = req.body;

  if (!studentCode) {
    return res.status(400).json({ ok: false, message: "กรุณากรอกรหัสประจำตัวนักเรียน" });
  }

  if (!isValidStudentCode(studentCode)) {
    return res.status(400).json({
      ok: false,
      message: `รหัสประจำตัวนักเรียนไม่ถูกต้อง ต้องขึ้นต้นด้วย ${STUDENT_CODE_PREFIX} และมีทั้งหมด ${STUDENT_CODE_LENGTH} หลัก`,
    });
  }

  try {
    const { data: existing, error: findError } = await supabase
      .from("students")
      .select("*")
      .eq("student_code", studentCode)
      .maybeSingle();

    if (findError) throw findError;

    if (!existing) {
      return res.status(404).json({
        ok: false,
        message: "ไม่พบบัญชีนี้ในระบบ กรุณาสมัครสมาชิกก่อนที่แท็บสร้างบัญชี",
      });
    }

    const { data: updated, error: updateError } = await supabase
      .from("students")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select()
      .single();

    if (updateError) throw updateError;

    return res.json({ ok: true, student: updated });
  } catch (err) {
    console.error("Student login error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "เชื่อมต่อฐานข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง หรือเช็คว่าตั้งค่าคีย์ Supabase ถูกต้องหรือยัง",
    });
  }
});

// =================================================================
// ครู
// =================================================================

// -------------------------------------------------------------
// POST /api/register/teacher
// body: { name, department, teacherCode }
// - สร้างบัญชีครูใหม่เท่านั้น ถ้ามี teacher_code นี้อยู่แล้วจะ error
// -------------------------------------------------------------
router.post("/register/teacher", async (req, res) => {
  const { name, department, teacherCode } = req.body;

  if (!name || !teacherCode) {
    return res.status(400).json({ ok: false, message: "กรุณากรอกชื่อและรหัสครูให้ครบ" });
  }

  if (!isValidTeacherCode(teacherCode)) {
    return res.status(400).json({
      ok: false,
      message: `รหัสครูไม่ถูกต้อง ต้องเป็นตัวเลข ${TEACHER_CODE_MIN_LENGTH}-${TEACHER_CODE_MAX_LENGTH} หลัก`,
    });
  }

  try {
    const { data: existing, error: findError } = await supabase
      .from("teachers")
      .select("id")
      .eq("teacher_code", teacherCode)
      .maybeSingle();

    if (findError) throw findError;

    if (existing) {
      return res.status(409).json({
        ok: false,
        message: "รหัสครูนี้เคยสมัครไว้แล้ว กรุณาไปที่แท็บเข้าสู่ระบบแทน",
      });
    }

    const { data: created, error: insertError } = await supabase
      .from("teachers")
      .insert({
        name,
        department: department || null,
        teacher_code: teacherCode,
        last_login_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return res.json({ ok: true, teacher: created });
  } catch (err) {
    console.error("Teacher register error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "เชื่อมต่อฐานข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง หรือเช็คว่าตั้งค่าคีย์ Supabase ถูกต้องหรือยัง",
    });
  }
});

// -------------------------------------------------------------
// POST /api/login/teacher
// body: { teacherCode }
// - เข้าสู่ระบบด้วยรหัสครูอย่างเดียว ไม่สร้างบัญชีใหม่
//   (ในอนาคตจะรองรับการแตะแท็ก RFID แทนได้ด้วย โดยไม่กระทบ endpoint นี้)
// -------------------------------------------------------------
router.post("/login/teacher", async (req, res) => {
  const { teacherCode } = req.body;

  if (!teacherCode) {
    return res.status(400).json({ ok: false, message: "กรุณากรอกรหัสครู" });
  }

  if (!isValidTeacherCode(teacherCode)) {
    return res.status(400).json({
      ok: false,
      message: `รหัสครูไม่ถูกต้อง ต้องเป็นตัวเลข ${TEACHER_CODE_MIN_LENGTH}-${TEACHER_CODE_MAX_LENGTH} หลัก`,
    });
  }

  try {
    const { data: existing, error: findError } = await supabase
      .from("teachers")
      .select("*")
      .eq("teacher_code", teacherCode)
      .maybeSingle();

    if (findError) throw findError;

    if (!existing) {
      return res.status(404).json({
        ok: false,
        message: "ไม่พบบัญชีครูนี้ในระบบ กรุณาสมัครสมาชิกก่อนที่แท็บสร้างบัญชี",
      });
    }

    const { data: updated, error: updateError } = await supabase
      .from("teachers")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select()
      .single();

    if (updateError) throw updateError;

    return res.json({ ok: true, teacher: updated });
  } catch (err) {
    console.error("Teacher login error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "เชื่อมต่อฐานข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง หรือเช็คว่าตั้งค่าคีย์ Supabase ถูกต้องหรือยัง",
    });
  }
});

// =================================================================
// แอดมิน
// =================================================================

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
