// routes/admin_teachers.js
// -----------------------------------------------------------------
// เฉพาะส่วน "assign เลขแท็กให้ครู" (teacher_tags, 1:1 กับ teachers)
// -----------------------------------------------------------------

const express = require("express");
const router = express.Router();
const supabase = require("../config/supabaseClient");

// -------------------------------------------------------------
// GET /api/admin/teacher-tags
// ดึงรายการ "ครูทั้งหมด" พร้อมสถานะว่ามีแท็กหรือยัง (left join teacher_tags)
// เพื่อให้หน้าแอดมินเห็นครูที่ยังไม่มีแท็กได้ง่ายๆ ในรายการเดียว
// -------------------------------------------------------------
router.get("/teacher-tags", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("teachers")
      .select("id, name, department, teacher_code, teacher_tags(id, tag_uid, assigned_at)")
      .order("name", { ascending: true });

    if (error) throw error;

    return res.json({ ok: true, teachers: data });
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

  try {
    const { data: teacherExists, error: teacherFindError } = await supabase
      .from("teachers")
      .select("id")
      .eq("id", teacherId)
      .maybeSingle();

    if (teacherFindError) throw teacherFindError;

    if (!teacherExists) {
      return res.status(404).json({ ok: false, message: "ไม่พบครูคนนี้" });
    }

    const { data: existingForTeacher, error: findByTeacherError } = await supabase
      .from("teacher_tags")
      .select("id")
      .eq("teacher_id", teacherId)
      .maybeSingle();

    if (findByTeacherError) throw findByTeacherError;

    if (existingForTeacher) {
      return res.status(409).json({
        ok: false,
        message: "ครูคนนี้มีแท็กอยู่แล้ว ถ้าต้องการเปลี่ยนเลขแท็ก กรุณาใช้ปุ่มแก้ไขแทน",
      });
    }

    const { data: existingForTag, error: findByTagError } = await supabase
      .from("teacher_tags")
      .select("id")
      .eq("tag_uid", tagUid.trim())
      .maybeSingle();

    if (findByTagError) throw findByTagError;

    if (existingForTag) {
      return res.status(409).json({
        ok: false,
        message: "เลขแท็กนี้ถูกผูกกับครูคนอื่นไปแล้ว",
      });
    }

    const { data: created, error: insertError } = await supabase
      .from("teacher_tags")
      .insert({ teacher_id: teacherId, tag_uid: tagUid.trim() })
      .select()
      .single();

    if (insertError) throw insertError;

    return res.json({ ok: true, teacherTag: created });
  } catch (err) {
    console.error("Admin assign teacher tag error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "ผูกแท็กให้ครูไม่สำเร็จ",
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

  try {
    const { data: existingForTag, error: findByTagError } = await supabase
      .from("teacher_tags")
      .select("id")
      .eq("tag_uid", tagUid.trim())
      .neq("teacher_id", teacherId)
      .maybeSingle();

    if (findByTagError) throw findByTagError;

    if (existingForTag) {
      return res.status(409).json({
        ok: false,
        message: "เลขแท็กนี้ถูกผูกกับครูคนอื่นไปแล้ว",
      });
    }

    const { data: updated, error: updateError } = await supabase
      .from("teacher_tags")
      .update({ tag_uid: tagUid.trim() })
      .eq("teacher_id", teacherId)
      .select()
      .single();

    if (updateError) throw updateError;

    if (!updated) {
      return res.status(404).json({
        ok: false,
        message: "ครูคนนี้ยังไม่มีแท็ก กรุณาใช้ปุ่มเพิ่มแท็กแทน",
      });
    }

    return res.json({ ok: true, teacherTag: updated });
  } catch (err) {
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
    const { error } = await supabase
      .from("teacher_tags")
      .delete()
      .eq("teacher_id", teacherId);

    if (error) throw error;

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
