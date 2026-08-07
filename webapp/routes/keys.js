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
//
// *** ขยายเพิ่ม (MANIFEST Task 5a) ***
//   - room_images: อาร์เรย์รูปภาพทั้งหมดของห้อง/กุญแจนั้น เรียงตาม
//     sort_order (แทนที่/เสริม image_url เดี่ยวเดิมซึ่งยังคงส่งมาด้วย
//     เพื่อ backward compat — ดู schema.sql migration note) ใช้ embed
//     แบบ nested ของ PostgREST ตรงๆ ในนี้เลย ไม่ต้อง query แยก เพราะ
//     เป็น 1 request เดียวที่ join ผ่าน FK room_images.room_tag_id ได้
//     อยู่แล้ว ต่างจาก isCurrentlyBorrowed ใน admin_keys.js (Task 4)
//     ที่ต้อง query แยกเพราะเป็นการเทียบข้ามตาราง key_logs <-> room_tags
//     คนละ FK กัน ไม่ใช่ embed เดียวกัน
//   - borrow_window_days / borrow_window_start / borrow_window_end: ส่ง
//     ตรงๆ ตามที่เก็บในคอลัมน์ (null = ไม่จำกัด) ให้ฝั่งหน้าเว็บ
//     (teacher.js, Task 9c) ไปแสดงเป็น badge ช่วงเวลาที่ยืมได้เอง —
//     endpoint นี้แค่ส่งข้อมูลดิบ ไม่ตีความ/ฟอร์แมตข้อความ
// -------------------------------------------------------------
router.get("/keys/status", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("room_tags")
      .select(
        "id, room_name, tag_uid, description, is_active, status, borrowed_at, image_url, " +
          "borrow_window_days, borrow_window_start, borrow_window_end, " +
          "borrowed_by:borrowed_by_teacher_id(id, name, department), " +
          "room_images(id, image_url, sort_order)"
      )
      .eq("is_active", true)
      .order("room_name", { ascending: true })
      .order("sort_order", { foreignTable: "room_images", ascending: true });

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
// GET /api/keys/:id/history
// ประวัติยืม-คืนล่าสุดของกุญแจดอกเดียว (สำหรับ modal รายละเอียดห้อง
// ที่ teacher.js เปิดตอนคลิกการ์ด — Task 9a) ส่งแค่ 10 รายการล่าสุด
// + total count รวม เพื่อให้หน้าเว็บโชว์ปุ่ม "ดูทั้งหมด" ไป
// /history.html?roomId=X ได้ถ้า count > 10 (ไม่ต้องดึงมาทั้งหมดที่นี่)
//
// public, ไม่มี auth — เหมือน /keys/status เดิม
// -------------------------------------------------------------
const ROOM_HISTORY_PREVIEW_LIMIT = 10;

router.get("/keys/:id/history", async (req, res) => {
  const { id } = req.params;
  const roomTagId = parseInt(id, 10);

  if (!Number.isInteger(roomTagId)) {
    return res.status(400).json({ ok: false, message: "รหัสห้อง/กุญแจไม่ถูกต้อง" });
  }

  try {
    // เช็คก่อนว่าห้อง/กุญแจนี้มีอยู่จริง (แยก query จาก history เพื่อให้
    // แยกแยะ "ห้องไม่มีอยู่" (404) ออกจาก "ห้องมีอยู่แต่ยังไม่เคยมี
    // ประวัติเลย" (200, logs: [], totalCount: 0) ได้ชัดเจน)
    const { data: room, error: roomError } = await supabase
      .from("room_tags")
      .select("id, room_name")
      .eq("id", roomTagId)
      .maybeSingle();

    if (roomError) throw roomError;

    if (!room) {
      return res.status(404).json({ ok: false, message: "ไม่พบห้อง/กุญแจนี้" });
    }

    // นับ total count แยกจากการดึง 10 รายการ (count: "exact", head: true
    // -> ไม่ดึง body กลับมา แค่เอาเลขนับ ประหยัดกว่าดึงมาทั้งหมดแล้วนับเอง)
    const { count: totalCount, error: countError } = await supabase
      .from("key_logs")
      .select("id", { count: "exact", head: true })
      .eq("room_tag_id", roomTagId);

    if (countError) throw countError;

    const { data: logs, error: logsError } = await supabase
      .from("key_logs")
      .select("id, action, acted_at, teachers(id, name, department)")
      .eq("room_tag_id", roomTagId)
      .order("acted_at", { ascending: false })
      .limit(ROOM_HISTORY_PREVIEW_LIMIT);

    if (logsError) throw logsError;

    return res.json({
      ok: true,
      room: { id: room.id, roomName: room.room_name },
      logs: logs || [],
      totalCount: totalCount || 0,
    });
  } catch (err) {
    console.error("Room history error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "ดึงประวัติกุญแจไม่สำเร็จ",
    });
  }
});

// -------------------------------------------------------------
// GET /api/keys/history/all
// query params:
//   page   -> เลขหน้า เริ่มที่ 1 (default 1)
//   limit  -> จำนวนต่อหน้า (default 20, สูงสุด 100)
//   roomId -> กรองเฉพาะห้อง/กุญแจดอกนั้น (ไม่บังคับ — ใช้กับ
//             /history.html?roomId=X ตอนกดปุ่ม "ดูทั้งหมด" จาก modal)
//
// ประวัติยืม-คืนของทุกห้อง แบบ public paginated — คนละ endpoint กับ
// /api/admin/keys/history (admin_keys.js) ซึ่งต้อง login และรองรับ
// filter หลากหลายกว่า (teacherId, action) หน้านี้ตั้งใจให้เรียบง่าย
// กว่าเพราะเป็นหน้า public ที่ใครก็เข้าดูได้ — ไม่มี filter เพิ่มเติม
// นอกจาก roomId ตาม scope ที่ล็อกไว้ใน MANIFEST
// -------------------------------------------------------------
const HISTORY_PAGE_SIZE_DEFAULT = 20;
const HISTORY_PAGE_SIZE_MAX = 100;

router.get("/keys/history/all", async (req, res) => {
  const { page, limit, roomId } = req.query;

  const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
  const parsedLimit = Math.min(
    Math.max(parseInt(limit, 10) || HISTORY_PAGE_SIZE_DEFAULT, 1),
    HISTORY_PAGE_SIZE_MAX
  );

  const from = (parsedPage - 1) * parsedLimit;
  const to = from + parsedLimit - 1;

  try {
    let query = supabase
      .from("key_logs")
      .select(
        "id, action, acted_at, room_tags(id, room_name), teachers(id, name, department)",
        { count: "exact" }
      )
      .order("acted_at", { ascending: false })
      .range(from, to);

    if (roomId) {
      const parsedRoomId = parseInt(roomId, 10);
      if (!Number.isInteger(parsedRoomId)) {
        return res.status(400).json({ ok: false, message: "รหัสห้อง/กุญแจไม่ถูกต้อง" });
      }
      query = query.eq("room_tag_id", parsedRoomId);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    return res.json({
      ok: true,
      logs: data || [],
      page: parsedPage,
      limit: parsedLimit,
      totalCount: count || 0,
      totalPages: Math.max(Math.ceil((count || 0) / parsedLimit), 1),
    });
  } catch (err) {
    console.error("All keys history error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "ดึงประวัติยืม-คืนไม่สำเร็จ",
    });
  }
});

module.exports = router;