// routes/keys.js
// -----------------------------------------------------------------
// มุมมอง read-only สำหรับ "ครูที่ login แล้ว" (ไม่ใช่แค่แอดมิน):
//   - ดูสถานะกุญแจทั้งหมด (เหมือน admin_keys.js/keys/status แต่เปิด
//     ให้ role ครูเข้าถึงได้ด้วย)
//   - ดูประวัติการยืม-คืนของ "ตัวเองเท่านั้น" (กรอง teacher_id จาก
//     req.user เสมอ ไม่รับ teacherId จาก client เพื่อกันดูของคนอื่น)
//
// Auth: requireAuth เฉยๆ ที่จุด mount ใน server.js (ไม่บังคับ role
// เฉพาะ เพราะทั้งครูและแอดมินควรดูได้)
// -----------------------------------------------------------------

const express = require("express");
const router = express.Router();
const supabase = require("../config/supabaseClient");

// -------------------------------------------------------------
// GET /api/keys/status
// สถานะปัจจุบันของกุญแจทุกดอก (ว่าง/ถูกยืม + ใครยืมอยู่)
// -------------------------------------------------------------
router.get("/keys/status", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("room_tags")
      .select(
        "id, room_name, tag_uid, description, is_active, status, borrowed_at, borrowed_by:borrowed_by_teacher_id(id, name, department)"
      )
      .eq("is_active", true)
      .order("room_name", { ascending: true });

    if (error) throw error;

    return res.json({ ok: true, keys: data });
  } catch (err) {
    console.error("Keys status error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "ดึงสถานะกุญแจไม่สำเร็จ",
    });
  }
});

// -------------------------------------------------------------
// GET /api/keys/history/mine
// ประวัติการยืม-คืนของครูที่ login อยู่เท่านั้น (จำกัด 50 รายการล่าสุด)
// -------------------------------------------------------------
router.get("/keys/history/mine", async (req, res) => {
  if (req.user.role !== "teacher") {
    return res.status(403).json({ ok: false, message: "เฉพาะครูเท่านั้นที่ดูประวัติของตัวเองได้ที่นี่" });
  }

  try {
    const { data, error } = await supabase
      .from("key_logs")
      .select("id, action, acted_at, room_tags(id, room_name)")
      .eq("teacher_id", req.user.id)
      .order("acted_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    return res.json({ ok: true, logs: data });
  } catch (err) {
    console.error("Keys history mine error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "ดึงประวัติของคุณไม่สำเร็จ",
    });
  }
});

module.exports = router;
