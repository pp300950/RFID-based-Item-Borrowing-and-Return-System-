// routes/keys.js
// -----------------------------------------------------------------
// มุมมอง read-only แบบสาธารณะ (ไม่มี login สำหรับครูอีกต่อไปตาม
// สถาปัตยกรรมใหม่ — ดู README ข้อ 10):
//   - ดูสถานะกุญแจทั้งหมด (ใครก็เข้าดูได้ ไม่ต้อง login)
//
// *** เปลี่ยนใหญ่: ตัด GET /keys/history/mine ออก *** เดิม endpoint นี้
// อ้างอิง req.user.id เพื่อกรองประวัติ "ของตัวเอง" แต่ตอนนี้ไม่มีครูที่
// login ผ่านเว็บแล้ว จึงไม่มี "ตัวเอง" ให้อ้างอิง — ถ้าต้องการดูประวัติ
// รายคนในอนาคต ให้ทำเป็นหน้าแอดมิน (ผ่าน admin_keys.js ที่มีอยู่แล้ว)
// แทน ไม่ใช่หน้าสาธารณะ
//
// Auth: mount แบบ public ใน server.js (ไม่ผ่าน requireAuth)
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
        "id, room_name, tag_uid, description, is_active, status, borrowed_at, image_url, borrowed_by:borrowed_by_teacher_id(id, name, department)"
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

module.exports = router;