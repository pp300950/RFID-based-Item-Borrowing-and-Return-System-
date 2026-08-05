// routes/auth.js
// -----------------------------------------------------------------
// เหลือแค่ ครู + แอดมิน (ตัดนักเรียนออกทั้งหมดตามสถาปัตยกรรมใหม่ —
// ระบบนี้ไม่มีนักเรียนเข้าใช้งานเว็บแล้ว มีแค่ครูที่ยืม-คืนกุญแจผ่าน
// การแตะแท็กจริงที่เครื่องอ่าน ไม่ใช่ผ่านฟอร์มเว็บ)
// -----------------------------------------------------------------
const express = require("express");
const router = express.Router();
const supabase = require("../config/supabaseClient");
const { signToken, requireAuth } = require("./middleware_auth");

// รหัสครู: ไม่บังคับ prefix เฉพาะ แต่ต้องเป็นตัวเลข 6-12 หลัก
const TEACHER_CODE_MIN_LENGTH = 6;
const TEACHER_CODE_MAX_LENGTH = 12;

function isValidTeacherCode(code) {
  if (typeof code !== "string") return false;
  if (code.length < TEACHER_CODE_MIN_LENGTH || code.length > TEACHER_CODE_MAX_LENGTH) return false;
  if (!/^\d+$/.test(code)) return false; // ต้องเป็นตัวเลขล้วน
  return true;
}

// =================================================================
// ครู
// =================================================================

// -------------------------------------------------------------
// POST /api/register/teacher
// body: { name, department, teacherCode }
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

    const token = signToken({ role: "teacher", id: created.id, name: created.name });

    return res.json({ ok: true, teacher: created, token });
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

    const token = signToken({ role: "teacher", id: updated.id, name: updated.name });

    return res.json({ ok: true, teacher: updated, token });
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