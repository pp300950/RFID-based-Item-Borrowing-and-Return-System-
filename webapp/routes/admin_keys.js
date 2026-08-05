// routes/admin_keys.js
// -----------------------------------------------------------------
// เฉพาะส่วน "สถานะกุญแจ + ประวัติยืม-คืน" สำหรับหน้า admin dashboard
// ไม่ใช่ CRUD ห้อง (นั่นอยู่ที่ admin_rooms.js) — ไฟล์นี้เป็น read-only
// มุมมองสรุปว่ากุญแจดอกไหนถูกยืมอยู่ / ประวัติการแตะแท็กทั้งหมด
//
// Auth: ป้องกันด้วย requireAuth + requireRole("admin") ที่จุด mount
// router นี้ใน server.js เหมือนไฟล์ route แอดมินอื่นๆ ทั้งหมด
//
// หมายเหตุ: หน้าครู (teacher.html) ก็ต้องดูสถานะกุญแจ + ประวัติของ
// ตัวเองได้เหมือนกัน แต่ใช้ endpoint แยกที่ /api/keys/* (mount แบบ
// requireAuth เฉยๆ ไม่บังคับ role) ดูไฟล์ routes/keys.js
// -----------------------------------------------------------------

const express = require("express");
const router = express.Router();
const supabase = require("../config/supabaseClient");

// -------------------------------------------------------------
// GET /api/admin/keys/status
// สถานะปัจจุบันของกุญแจทุกดอก (ว่าง/ถูกยืม + ใครยืมอยู่) เรียงตามชื่อห้อง
// -------------------------------------------------------------
router.get("/keys/status", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("room_tags")
      .select(
        "id, room_name, tag_uid, description, is_active, status, borrowed_at, borrowed_by:borrowed_by_teacher_id(id, name, department)"
      )
      .order("room_name", { ascending: true });

    if (error) throw error;

    return res.json({ ok: true, keys: data });
  } catch (err) {
    console.error("Admin keys status error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "ดึงสถานะกุญแจไม่สำเร็จ",
    });
  }
});

// -------------------------------------------------------------
// GET /api/admin/keys/history
// query params (ไม่บังคับทั้งหมด):
//   roomTagId  -> กรองเฉพาะกุญแจดอกนั้น
//   teacherId  -> กรองเฉพาะครูคนนั้น
//   action     -> "borrow" หรือ "return"
//   limit      -> จำนวนแถวสูงสุด (default 100, สูงสุด 500)
// ประวัติการยืม-คืนทั้งหมด เรียงล่าสุดก่อน
// -------------------------------------------------------------
router.get("/keys/history", async (req, res) => {
  const { roomTagId, teacherId, action, limit } = req.query;

  const parsedLimit = Math.min(parseInt(limit, 10) || 100, 500);

  try {
    let query = supabase
      .from("key_logs")
      .select(
        "id, action, acted_at, room_tags(id, room_name), teachers(id, name, department)"
      )
      .order("acted_at", { ascending: false })
      .limit(parsedLimit);

    if (roomTagId) query = query.eq("room_tag_id", roomTagId);
    if (teacherId) query = query.eq("teacher_id", teacherId);
    if (action === "borrow" || action === "return") query = query.eq("action", action);

    const { data, error } = await query;

    if (error) throw error;

    return res.json({ ok: true, logs: data });
  } catch (err) {
    console.error("Admin keys history error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "ดึงประวัติการยืม-คืนไม่สำเร็จ",
    });
  }
});

module.exports = router;
