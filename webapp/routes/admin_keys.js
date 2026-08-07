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
        "id, room_name, tag_uid, description, is_active, status, borrowed_at, image_url, borrowed_by:borrowed_by_teacher_id(id, name, department)"
      )
      .order("room_name", { ascending: true });

    if (error) throw error;

    // isCurrentlyBorrowed: derived from status, not a stored field — added
    // here so the admin table can render a dedicated "currently borrowed"
    // column/badge without the frontend re-deriving `status === "borrowed"`
    // itself in JS (see MANIFEST Task 4).
    const keys = (data || []).map((row) => ({
      ...row,
      isCurrentlyBorrowed: row.status === "borrowed",
    }));

    return res.json({ ok: true, keys });
  } catch (err) {
    console.error("Admin keys status error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "ดึงสถานะกุญแจไม่สำเร็จ",
    });
  }
});

// -------------------------------------------------------------
// attachIsCurrentlyBorrowed(logs)
// -----------------------------------------------------------------
// key_logs แต่ละแถวเป็น "เหตุการณ์ในอดีต" (borrow/return ครั้งหนึ่งๆ)
// ไม่มีสถานะปัจจุบันในตัวเอง — isCurrentlyBorrowed ที่แนบไปคือ "กุญแจ
// ดอกที่แถวนี้พูดถึง ตอนนี้ (ปัจจุบัน) ถูกยืมอยู่หรือเปล่า" ซึ่งต้อง
// ไปดูที่ room_tags.status สดๆ ไม่ใช่ derive จากแค่ action ของแถวนั้น
// (แถว action: "borrow" เก่าๆ อาจถูกคืนไปแล้วหลังจากนั้น — isCurrently
// Borrowed ต้อง false ไม่ใช่ true ตาม action)
//
// ทำไมไม่ join ตรงๆ ใน select ข้างบน: Supabase/PostgREST select แบบ
// embed (room_tags(...)) ดึงได้แค่คอลัมน์ที่มีอยู่ในแถว room_tags นั้น
// อยู่แล้ว (id, room_name) — จะเพิ่ม status เข้าไปในนั้นเลยก็ได้ แต่
// แยกมาเป็น query ต่างหากที่นี่ เพื่อไม่ให้กระทบ response shape เดิม
// ของ room_tags nested object (โค้ดฝั่ง frontend เดิมที่ใช้ room_tags.id
// / room_tags.room_name อยู่แล้วจะไม่พัง) และเพื่อให้ query นี้ทำ
// batch เดียวจบ ไม่ query ซ้ำต่อแถว
// -------------------------------------------------------------
async function attachIsCurrentlyBorrowed(logs) {
  if (logs.length === 0) return logs;

  const roomTagIds = [...new Set(logs.map((row) => row.room_tag_id).filter((id) => id != null))];

  if (roomTagIds.length === 0) {
    return logs.map((row) => ({ ...row, isCurrentlyBorrowed: false }));
  }

  const { data: currentRoomTags, error } = await supabase
    .from("room_tags")
    .select("id, status")
    .in("id", roomTagIds);

  if (error) throw error;

  const statusById = new Map((currentRoomTags || []).map((rt) => [rt.id, rt.status]));

  return logs.map((row) => ({
    ...row,
    isCurrentlyBorrowed: statusById.get(row.room_tag_id) === "borrowed",
  }));
}

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
        "id, action, acted_at, room_tag_id, room_tags(id, room_name), teachers(id, name, department)"
      )
      .order("acted_at", { ascending: false })
      .limit(parsedLimit);

    if (roomTagId) query = query.eq("room_tag_id", roomTagId);
    if (teacherId) query = query.eq("teacher_id", teacherId);
    if (action === "borrow" || action === "return") query = query.eq("action", action);

    const { data, error } = await query;

    if (error) throw error;

    const logs = await attachIsCurrentlyBorrowed(data || []);

    return res.json({ ok: true, logs });
  } catch (err) {
    console.error("Admin keys history error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "ดึงประวัติการยืม-คืนไม่สำเร็จ",
    });
  }
});

module.exports = router;