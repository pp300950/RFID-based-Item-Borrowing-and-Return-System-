// routes/admin_assignments.js
// -----------------------------------------------------------------
// เฉพาะส่วน "มอบหมายครูดูแลห้อง/กุญแจ" (teacher_room_assignments)
// many-to-many: 1 ห้องมีครูดูแลได้หลายคน, 1 ครูดูแลได้สูงสุด 6 ห้อง
// (จำกัดจำนวนบังคับจริงด้วย trigger ที่ฝั่ง DB อยู่แล้ว — ดู schema.sql
// ไฟล์นี้แค่เช็คซ้ำฝั่ง backend ก่อน เพื่อให้ error message เป็นมิตรกว่า
// การปล่อยให้ DB exception โผล่มาตรงๆ)
// -----------------------------------------------------------------

const express = require("express");
const router = express.Router();
const supabase = require("../config/supabaseClient");

const MAX_ROOMS_PER_TEACHER = 6;

// -------------------------------------------------------------
// GET /api/admin/assignments
// ดึงรายการมอบหมายทั้งหมด พร้อมชื่อครูและชื่อห้อง (join ทั้งสองฝั่ง)
// query param ?teacherId=xx หรือ ?roomTagId=xx กรองได้ (ไม่บังคับ ใช้ได้ทีละอัน)
// -------------------------------------------------------------
router.get("/assignments", async (req, res) => {
  const { teacherId, roomTagId } = req.query;

  try {
    let query = supabase
      .from("teacher_room_assignments")
      .select("*, teachers(id, name, department), room_tags(id, room_name)")
      .order("assigned_at", { ascending: false });

    if (teacherId) {
      query = query.eq("teacher_id", teacherId);
    }
    if (roomTagId) {
      query = query.eq("room_tag_id", roomTagId);
    }

    const { data, error } = await query;

    if (error) throw error;

    return res.json({ ok: true, assignments: data });
  } catch (err) {
    console.error("Admin list assignments error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "ดึงรายการมอบหมายไม่สำเร็จ",
    });
  }
});

// -------------------------------------------------------------
// GET /api/admin/assignments/teacher/:teacherId/room-count
// ช่วย frontend เช็คว่าครูคนนี้ดูแลอยู่กี่ห้องแล้ว (ก่อนเปิดฟอร์มเพิ่ม)
// -------------------------------------------------------------
router.get("/assignments/teacher/:teacherId/room-count", async (req, res) => {
  const { teacherId } = req.params;

  try {
    const { count, error } = await supabase
      .from("teacher_room_assignments")
      .select("id", { count: "exact", head: true })
      .eq("teacher_id", teacherId);

    if (error) throw error;

    return res.json({ ok: true, count: count || 0, max: MAX_ROOMS_PER_TEACHER });
  } catch (err) {
    console.error("Admin count teacher rooms error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "ดึงจำนวนห้องที่ครูดูแลไม่สำเร็จ",
    });
  }
});

// -------------------------------------------------------------
// POST /api/admin/assignments
// body: { teacherId, roomTagId }
// มอบหมายครูให้ดูแลห้อง — เช็คครู/ห้องมีจริง, เช็คซ้ำ, เช็คโควตา 6 ห้อง
// -------------------------------------------------------------
router.post("/assignments", async (req, res) => {
  const { teacherId, roomTagId } = req.body;

  if (!teacherId || !roomTagId) {
    return res.status(400).json({ ok: false, message: "กรุณาเลือกครูและห้อง/กุญแจ" });
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

    const { data: roomExists, error: roomFindError } = await supabase
      .from("room_tags")
      .select("id")
      .eq("id", roomTagId)
      .maybeSingle();

    if (roomFindError) throw roomFindError;

    if (!roomExists) {
      return res.status(404).json({ ok: false, message: "ไม่พบห้อง/กุญแจที่เลือก" });
    }

    // เช็คว่ามอบหมายคู่นี้ไปแล้วหรือยัง (กันซ้ำ ให้ error message เป็นมิตร
    // แทนที่จะปล่อยให้ unique constraint พังเฉยๆ)
    const { data: existingPair, error: pairFindError } = await supabase
      .from("teacher_room_assignments")
      .select("id")
      .eq("teacher_id", teacherId)
      .eq("room_tag_id", roomTagId)
      .maybeSingle();

    if (pairFindError) throw pairFindError;

    if (existingPair) {
      return res.status(409).json({
        ok: false,
        message: "ครูคนนี้ดูแลห้อง/กุญแจนี้อยู่แล้ว",
      });
    }

    // เช็คโควตา 6 ห้องต่อครูก่อน insert (DB มี trigger กันซ้ำอีกชั้นอยู่แล้ว
    // แต่เช็คตรงนี้ก่อนเพื่อให้ error message เป็นมิตรกว่า)
    const { count: currentCount, error: countError } = await supabase
      .from("teacher_room_assignments")
      .select("id", { count: "exact", head: true })
      .eq("teacher_id", teacherId);

    if (countError) throw countError;

    if ((currentCount || 0) >= MAX_ROOMS_PER_TEACHER) {
      return res.status(409).json({
        ok: false,
        message: `ครูคนนี้ดูแลห้องครบ ${MAX_ROOMS_PER_TEACHER} ห้องแล้ว (สูงสุดต่อคน) กรุณาถอดห้องเดิมออกก่อนถ้าต้องการเพิ่มห้องใหม่`,
      });
    }

    const { data: created, error: insertError } = await supabase
      .from("teacher_room_assignments")
      .insert({ teacher_id: teacherId, room_tag_id: roomTagId })
      .select("*, teachers(id, name, department), room_tags(id, room_name)")
      .single();

    if (insertError) {
      // เผื่อกรณี race condition ที่แซง trigger ฝั่ง DB มาทัน
      if (insertError.message && insertError.message.includes("ดูแลห้องครบ")) {
        return res.status(409).json({
          ok: false,
          message: `ครูคนนี้ดูแลห้องครบ ${MAX_ROOMS_PER_TEACHER} ห้องแล้ว (สูงสุดต่อคน)`,
        });
      }
      throw insertError;
    }

    return res.json({ ok: true, assignment: created });
  } catch (err) {
    console.error("Admin create assignment error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "มอบหมายครูดูแลห้องไม่สำเร็จ",
    });
  }
});

// -------------------------------------------------------------
// DELETE /api/admin/assignments/:id
// ถอดครูออกจากการดูแลห้องนี้ (ลบแถวใน teacher_room_assignments)
// -------------------------------------------------------------
router.delete("/assignments/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const { data: currentAssignment, error: findError } = await supabase
      .from("teacher_room_assignments")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (findError) throw findError;

    if (!currentAssignment) {
      return res.status(404).json({ ok: false, message: "ไม่พบรายการมอบหมายนี้" });
    }

    const { error: deleteError } = await supabase
      .from("teacher_room_assignments")
      .delete()
      .eq("id", id);

    if (deleteError) throw deleteError;

    return res.json({ ok: true });
  } catch (err) {
    console.error("Admin delete assignment error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "ถอดครูออกจากห้องไม่สำเร็จ",
    });
  }
});

module.exports = router;
