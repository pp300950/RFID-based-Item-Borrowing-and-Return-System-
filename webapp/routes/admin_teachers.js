// routes/admin_teachers.js
// -----------------------------------------------------------------
// สองส่วนที่เกี่ยวกับ "ครู" ฝั่งแอดมิน:
//   1. แก้ไขข้อมูลตัวครูเอง (PATCH /teachers/:id — ชื่อ/แผนก)
//   2. assign เลขแท็กให้ครู (teacher_tags, 1:1 กับ teachers)
// รวมสองส่วนไว้ไฟล์เดียวเพราะทั้งคู่ผูกกับหน้า "แท็กครู" เดียวกันใน
// admin dashboard และมีขนาดเล็กพอที่ไม่ต้องแยกไฟล์ (ดู MANIFEST Task 3)
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
// GET /api/admin/teacher-tags
// ดึงรายการ "ครูทั้งหมด" พร้อมสถานะว่ามีแท็กหรือยัง (left join teacher_tags)
// เพื่อให้หน้าแอดมินเห็นครูที่ยังไม่มีแท็กได้ง่ายๆ ในรายการเดียว
//
// ของเดิม embed teacher_tags(...) เป็น object เดียว (ไม่ใช่ array) เพราะ
// เป็นความสัมพันธ์ 1:1 — ที่นี่ทำ LEFT JOIN ตรงๆ แล้ว map กลับเป็น
// shape เดิม { ...teacher, teacher_tags: {id, tag_uid, assigned_at} | null }
// -------------------------------------------------------------
router.get("/teacher-tags", async (req, res) => {
  try {
    const [rows] = await query(
      `SELECT
         t.id, t.name, t.department, t.teacher_code,
         tt.id AS tt_id, tt.tag_uid AS tt_tag_uid, tt.assigned_at AS tt_assigned_at
       FROM teachers t
       LEFT JOIN teacher_tags tt ON tt.teacher_id = t.id
       ORDER BY t.name ASC`
    );

    const teachers = rows.map((r) => ({
      id: r.id,
      name: r.name,
      department: r.department,
      teacher_code: r.teacher_code,
      teacher_tags:
        r.tt_id !== null
          ? { id: r.tt_id, tag_uid: r.tt_tag_uid, assigned_at: r.tt_assigned_at }
          : null,
    }));

    return res.json({ ok: true, teachers });
  } catch (err) {
    console.error("Admin list teacher-tags error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "ดึงรายการแท็กครูไม่สำเร็จ",
    });
  }
});

// -------------------------------------------------------------
// POST /api/admin/teacher-tags
// body: { teacherId, tagUid }
// assign เลขแท็กให้ครู — error ถ้าครูคนนี้มีแท็กอยู่แล้ว (unique)
// หรือถ้าเลขแท็กนี้ถูกใช้กับครูคนอื่นไปแล้ว
// -------------------------------------------------------------
router.post("/teacher-tags", async (req, res) => {
  const { teacherId, tagUid } = req.body;

  if (!teacherId || !tagUid || !tagUid.trim()) {
    return res.status(400).json({ ok: false, message: "กรุณาเลือกครูและกรอกเลขแท็ก" });
  }

  const cleanTagUid = tagUid.trim();

  try {
    const [teacherRows] = await query("SELECT id FROM teachers WHERE id = ?", [teacherId]);

    if (teacherRows.length === 0) {
      return res.status(404).json({ ok: false, message: "ไม่พบครูคนนี้" });
    }

    const [existingForTeacherRows] = await query(
      "SELECT id FROM teacher_tags WHERE teacher_id = ?",
      [teacherId]
    );

    if (existingForTeacherRows.length > 0) {
      return res.status(409).json({
        ok: false,
        message: "ครูคนนี้มีแท็กอยู่แล้ว ถ้าต้องการเปลี่ยนเลขแท็ก กรุณาใช้ปุ่มแก้ไขแทน",
      });
    }

    const [existingForTagRows] = await query(
      "SELECT id FROM teacher_tags WHERE tag_uid = ?",
      [cleanTagUid]
    );

    if (existingForTagRows.length > 0) {
      return res.status(409).json({
        ok: false,
        message: "เลขแท็กนี้ถูกผูกกับครูคนอื่นไปแล้ว",
      });
    }

    const [insertResult] = await query(
      "INSERT INTO teacher_tags (teacher_id, tag_uid) VALUES (?, ?)",
      [teacherId, cleanTagUid]
    );

    const [createdRows] = await query("SELECT * FROM teacher_tags WHERE id = ?", [
      insertResult.insertId,
    ]);

    return res.json({ ok: true, teacherTag: createdRows[0] });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(409).json({
        ok: false,
        message: "เลขแท็กนี้ถูกผูกกับครูคนอื่นไปแล้ว",
      });
    }
    console.error("Admin assign teacher tag error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "ผูกแท็กให้ครูไม่สำเร็จ",
    });
  }
});

// -------------------------------------------------------------
// PATCH /api/admin/teachers/:id
// body: { name, department }
// แก้ไขข้อมูลตัวครูเอง (ชื่อ-นามสกุล / แผนก) — แยกจาก PATCH
// /teacher-tags/:teacherId ด้านล่าง ซึ่งแก้แค่เลขแท็ก RFID เท่านั้น
// สองอันนี้ตั้งใจแยก endpoint กันเพราะเป็นคนละ resource กัน (teachers
// vs teacher_tags) แม้จะแก้ไขจากหน้าแอดมินเดียวกันก็ตาม
//
// กติกา:
//   - name: บังคับกรอก ห้ามเป็นค่าว่าง/เว้นวรรคล้วน (เหมือนตอนสมัคร)
//   - department: ไม่บังคับ — ส่ง null หรือสตริงว่างเพื่อเคลียร์ค่าเดิม
//     ได้ ไม่ส่งมาเลย (undefined) = ไม่แตะฟิลด์นี้
//   - ไม่แตะ teacher_code หรือ teacher_tags จาก endpoint นี้เลย
// -------------------------------------------------------------
router.patch("/teachers/:id", async (req, res) => {
  const { id } = req.params;
  const { name, department } = req.body;

  if (name !== undefined && (!name || !name.trim())) {
    return res.status(400).json({ ok: false, message: "กรุณากรอกชื่อ-นามสกุล" });
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

  if (updateFields.length === 0) {
    return res.status(400).json({ ok: false, message: "ไม่มีข้อมูลให้แก้ไข" });
  }

  try {
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
    console.error("Admin update teacher error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "แก้ไขข้อมูลครูไม่สำเร็จ",
    });
  }
});

// -------------------------------------------------------------
// PATCH /api/admin/teacher-tags/:teacherId
// body: { tagUid }
// เปลี่ยนเลขแท็กของครูคนที่มีอยู่แล้ว (เช่นแท็กเดิมหาย ออกใบใหม่)
// -------------------------------------------------------------
router.patch("/teacher-tags/:teacherId", async (req, res) => {
  const { teacherId } = req.params;
  const { tagUid } = req.body;

  if (!tagUid || !tagUid.trim()) {
    return res.status(400).json({ ok: false, message: "กรุณากรอกเลขแท็กใหม่" });
  }

  const cleanTagUid = tagUid.trim();

  try {
    const [existingForTagRows] = await query(
      "SELECT id FROM teacher_tags WHERE tag_uid = ? AND teacher_id != ?",
      [cleanTagUid, teacherId]
    );

    if (existingForTagRows.length > 0) {
      return res.status(409).json({
        ok: false,
        message: "เลขแท็กนี้ถูกผูกกับครูคนอื่นไปแล้ว",
      });
    }

    const [updateResult] = await query(
      "UPDATE teacher_tags SET tag_uid = ? WHERE teacher_id = ?",
      [cleanTagUid, teacherId]
    );

    if (updateResult.affectedRows === 0) {
      return res.status(404).json({
        ok: false,
        message: "ครูคนนี้ยังไม่มีแท็ก กรุณาใช้ปุ่มเพิ่มแท็กแทน",
      });
    }

    const [updatedRows] = await query("SELECT * FROM teacher_tags WHERE teacher_id = ?", [
      teacherId,
    ]);

    return res.json({ ok: true, teacherTag: updatedRows[0] });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(409).json({
        ok: false,
        message: "เลขแท็กนี้ถูกผูกกับครูคนอื่นไปแล้ว",
      });
    }
    console.error("Admin update teacher tag error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "แก้ไขแท็กครูไม่สำเร็จ",
    });
  }
});

// -------------------------------------------------------------
// DELETE /api/admin/teacher-tags/:teacherId
// เอาแท็กออกจากครูคนนี้ (ครูจะกลายเป็น "ยังไม่มีแท็ก" อีกครั้ง)
// -------------------------------------------------------------
router.delete("/teacher-tags/:teacherId", async (req, res) => {
  const { teacherId } = req.params;

  try {
    await query("DELETE FROM teacher_tags WHERE teacher_id = ?", [teacherId]);

    return res.json({ ok: true });
  } catch (err) {
    console.error("Admin delete teacher tag error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "ลบแท็กครูไม่สำเร็จ",
    });
  }
});

module.exports = router;