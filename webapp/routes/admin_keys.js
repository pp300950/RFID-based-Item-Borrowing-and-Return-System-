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
//
// *** ย้ายจาก Supabase -> MySQL (XAMPP) ***
// แก้เฉพาะชั้นที่คุยกับฐานข้อมูล — endpoint path, response shape,
// เงื่อนไข business logic เหมือนเดิมทุกจุด (ดู MANIFEST)
// -----------------------------------------------------------------

const express = require("express");
const router = express.Router();
const { query } = require("../config/db");

// -------------------------------------------------------------
// GET /api/admin/keys/status
// สถานะปัจจุบันของกุญแจทุกดอก (ว่าง/ถูกยืม + ใครยืมอยู่) เรียงตามชื่อห้อง
// -------------------------------------------------------------
router.get("/keys/status", async (req, res) => {
  try {
    const [rows] = await query(
      `SELECT
         rt.id, rt.room_name, rt.tag_uid, rt.description, rt.is_active,
         rt.status, rt.borrowed_at, rt.image_url,
         t.id AS borrower_id, t.name AS borrower_name, t.department AS borrower_department
       FROM room_tags rt
       LEFT JOIN teachers t ON t.id = rt.borrowed_by_teacher_id
       ORDER BY rt.room_name ASC`
    );

    // isCurrentlyBorrowed: derived from status, not a stored field — added
    // here so the admin table can render a dedicated "currently borrowed"
    // column/badge without the frontend re-deriving `status === "borrowed"`
    // itself in JS (see MANIFEST Task 4).
    const keys = rows.map((r) => ({
      id: r.id,
      room_name: r.room_name,
      tag_uid: r.tag_uid,
      description: r.description,
      is_active: !!r.is_active,
      status: r.status,
      borrowed_at: r.borrowed_at,
      image_url: r.image_url,
      borrowed_by:
        r.borrower_id !== null
          ? { id: r.borrower_id, name: r.borrower_name, department: r.borrower_department }
          : null,
      isCurrentlyBorrowed: r.status === "borrowed",
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
// เดิมเหตุผลที่แยก query ต่างหากคือ PostgREST embed ดึงได้แค่คอลัมน์ที่
// ประกาศไว้ใน select เท่านั้น ไม่อยากกระทบ response shape เดิมของ
// room_tags nested object — ที่ MySQL ก็ยังคงแยก query ไว้เหมือนเดิม
// ด้วยเหตุผลเดียวกัน (ไม่ยุ่งกับ JOIN หลักที่คืนแค่ id/room_name) และ
// ทำ batch เดียวจบด้วย WHERE room_tag_id IN (...) แทนการ query ต่อแถว
// -------------------------------------------------------------
async function attachIsCurrentlyBorrowed(logs) {
  if (logs.length === 0) return logs;

  const roomTagIds = [...new Set(logs.map((row) => row.room_tag_id).filter((id) => id != null))];

  if (roomTagIds.length === 0) {
    return logs.map((row) => ({ ...row, isCurrentlyBorrowed: false }));
  }

  const [currentRoomTags] = await query(
    "SELECT id, status FROM room_tags WHERE id IN (?)",
    [roomTagIds]
  );

  const statusById = new Map(currentRoomTags.map((rt) => [rt.id, rt.status]));

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
//
// ไม่มี count ในนี้ (ไม่ paginate) จึงไม่ต้องกังวลเรื่องแยก 2 query
// ตาม MANIFEST ข้อ 5 — แค่ JOIN + filter ตรงๆ
// -------------------------------------------------------------
router.get("/keys/history", async (req, res) => {
  const { roomTagId, teacherId, action, limit } = req.query;

  const parsedLimit = Math.min(parseInt(limit, 10) || 100, 500);

  const conditions = [];
  const params = [];

  if (roomTagId) {
    conditions.push("kl.room_tag_id = ?");
    params.push(roomTagId);
  }
  if (teacherId) {
    conditions.push("kl.teacher_id = ?");
    params.push(teacherId);
  }
  if (action === "borrow" || action === "return") {
    conditions.push("kl.action = ?");
    params.push(action);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const [rows] = await query(
      `SELECT
         kl.id, kl.action, kl.acted_at, kl.room_tag_id,
         rt.id AS room_id, rt.room_name,
         t.id AS teacher_id, t.name AS teacher_name, t.department AS teacher_department
       FROM key_logs kl
       LEFT JOIN room_tags rt ON rt.id = kl.room_tag_id
       LEFT JOIN teachers t ON t.id = kl.teacher_id
       ${whereClause}
       ORDER BY kl.acted_at DESC
       LIMIT ?`,
      [...params, parsedLimit]
    );

    const mappedLogs = rows.map((r) => ({
      id: r.id,
      action: r.action,
      acted_at: r.acted_at,
      room_tag_id: r.room_tag_id,
      room_tags: r.room_id !== null ? { id: r.room_id, room_name: r.room_name } : null,
      teachers:
        r.teacher_id !== null
          ? { id: r.teacher_id, name: r.teacher_name, department: r.teacher_department }
          : null,
    }));

    const logs = await attachIsCurrentlyBorrowed(mappedLogs);

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
