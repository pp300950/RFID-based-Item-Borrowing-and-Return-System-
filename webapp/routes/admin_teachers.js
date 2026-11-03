// routes/admin_teachers.js
// -----------------------------------------------------------------
// แก้ไขข้อมูลครูฝั่งแอดมิน (PATCH /teachers/:id — ชื่อ/แผนก/รหัสประจำตัว)
//
// [พ.ย. 2026] ตัดระบบ "แท็กครู" (teacher_tags) ออกทั้งหมด — โรงเรียน
// เลิกใช้บัตร RFID ประจำตัวครูแล้ว เปลี่ยนไปใช้ teachers.teacher_code
// (พิมพ์รหัส) แทนการแตะบัตรเพื่อเปิด session ยืม-คืนกุญแจ (ดู
// routes/tap.js: POST /api/tap/teacher-code) จึงตัด endpoint
// /teacher-tags* ทั้งหมดออกจากไฟล์นี้ (GET/POST/PATCH/DELETE) และย้าย
// การแก้ teacher_code มารวมไว้ใน PATCH /teachers/:id แทน — กุญแจห้อง
// (room_tags) ยังใช้แตะแท็ก RFID เหมือนเดิมทุกอย่าง ไม่กระทบ
//
// *** ย้ายจาก Supabase -> MySQL (XAMPP) ***
// แก้เฉพาะชั้นที่คุยกับฐานข้อมูล — endpoint path, response shape
// ({ ok, ... }), และเงื่อนไข business logic เหมือนเดิมทุกจุด
// -----------------------------------------------------------------

const express = require("express");
const router = express.Router();
const { query } = require("../config/db");

// mysql2 คืน duplicate-key error เป็น errno 1062 / code ER_DUP_ENTRY —
// ใช้เป็น safety net เผื่อ race condition แทรกระหว่าง pre-check กับ
// insert จริง (ของเดิมบน Supabase ก็มีช่องโหว่นี้เหมือนกัน แต่ MySQL
// unique key ช่วยจับได้ชัดเจนกว่าด้วย error code ตรงๆ)
function isDuplicateKeyError(err) {
  return err && (err.code === "ER_DUP_ENTRY" || err.errno === 1062);
}

// -------------------------------------------------------------
// PATCH /api/admin/teachers/:id
// body: { name, department, teacherCode }
// แก้ไขข้อมูลครู — ชื่อ-นามสกุล / แผนก / รหัสประจำตัว (teacher_code)
//
// กติกา:
//   - name: ถ้าส่งมา (ไม่ใช่ undefined) ต้องไม่ใช่ค่าว่าง/เว้นวรรคล้วน
//     (เหมือนตอนสมัคร)
//   - department: ไม่บังคับ — ส่ง null หรือสตริงว่างเพื่อเคลียร์ค่าเดิม
//     ได้ ไม่ส่งมาเลย (undefined) = ไม่แตะฟิลด์นี้
//   - teacherCode: ถ้าส่งมา ต้องไม่ใช่ค่าว่าง และต้องเป็นตัวเลขล้วน
//     เท่านั้น (คีย์แพดตัวเลขหน้า display.html) — ซ้ำกับครูคนอื่นไม่ได้
//     (unique key uq_teachers_teacher_code ใน schema.sql เป็น safety
//     net อีกชั้น เผื่อ race condition ระหว่าง pre-check กับ update จริง)
//   - ฟิลด์ไหนไม่ส่งมา (undefined) = ไม่แตะฟิลด์นั้น เหมือนเดิม
// -------------------------------------------------------------
router.patch("/teachers/:id", async (req, res) => {
  const { id } = req.params;
  const { name, department, teacherCode } = req.body;

  if (name !== undefined && (!name || !name.trim())) {
    return res.status(400).json({ ok: false, message: "กรุณากรอกชื่อ-นามสกุล" });
  }

  let cleanTeacherCode;
  if (teacherCode !== undefined) {
    cleanTeacherCode = teacherCode.toString().trim();

    if (!cleanTeacherCode) {
      return res.status(400).json({ ok: false, message: "กรุณากรอกรหัสประจำตัวครู" });
    }

    if (!/^[0-9]+$/.test(cleanTeacherCode)) {
      return res.status(400).json({ ok: false, message: "รหัสประจำตัวครูต้องเป็นตัวเลขเท่านั้น" });
    }
  }

  const updateFields = [];
  const updateValues = [];

  if (name !== undefined) {
    updateFields.push("name = ?");
    updateValues.push(name.trim());
  }
  if (department !== undefined) {
    updateFields.push("department = ?");
    updateValues.push(department && department.trim() ? department.trim() : null);
  }
  if (teacherCode !== undefined) {
    updateFields.push("teacher_code = ?");
    updateValues.push(cleanTeacherCode);
  }

  if (updateFields.length === 0) {
    return res.status(400).json({ ok: false, message: "ไม่มีข้อมูลให้แก้ไข" });
  }

  try {
    // pre-check กันซ้ำแบบ friendly message ก่อน (unique key ด้านล่าง
    // เป็น safety net อีกชั้นเผื่อ race condition เท่านั้น)
    if (teacherCode !== undefined) {
      const [existingForCodeRows] = await query(
        "SELECT id FROM teachers WHERE teacher_code = ? AND id != ?",
        [cleanTeacherCode, id]
      );

      if (existingForCodeRows.length > 0) {
        return res.status(409).json({
          ok: false,
          message: "รหัสประจำตัวนี้ถูกใช้กับครูคนอื่นไปแล้ว",
        });
      }
    }

    const [updateResult] = await query(
      `UPDATE teachers SET ${updateFields.join(", ")} WHERE id = ?`,
      [...updateValues, id]
    );

    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ ok: false, message: "ไม่พบครูคนนี้" });
    }

    const [updatedRows] = await query("SELECT * FROM teachers WHERE id = ?", [id]);

    return res.json({ ok: true, teacher: updatedRows[0] });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(409).json({
        ok: false,
        message: "รหัสประจำตัวนี้ถูกใช้กับครูคนอื่นไปแล้ว",
      });
    }
    console.error("Admin update teacher error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "แก้ไขข้อมูลครูไม่สำเร็จ",
    });
  }
});

module.exports = router;