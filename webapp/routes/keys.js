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
//
// *** ย้ายจาก Supabase -> MySQL (XAMPP) ***
// แก้เฉพาะชั้นที่คุยกับฐานข้อมูล — endpoint path, response shape,
// เงื่อนไข business logic เหมือนเดิมทุกจุด (ดู MANIFEST)
// -----------------------------------------------------------------

const express = require("express");
const router = express.Router();
const { query } = require("../config/db");

// mysql2 ไม่ auto-parse คอลัมน์ type JSON ให้เป็น JS array เสมอไป (ขึ้นกับ
// เวอร์ชัน/การตั้งค่า) — กันไว้ทั้งสองแบบเหมือนที่ทำใน tap.js (MANIFEST
// ข้อ 1) ถ้าเจอ string ให้ parse, ถ้า driver parse มาให้แล้วก็ใช้ตรงๆ
function parseBorrowWindowDays(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

// -------------------------------------------------------------
// GET /api/keys/status
// สถานะปัจจุบันของกุญแจทุกดอก (ว่าง/ถูกยืม + ใครยืมอยู่)
//
// ของเดิมใช้ PostgREST embed ดึง borrowed_by (1:1 ผ่าน FK) และ
// room_images (1:many ผ่าน FK) มาในคำสั่งเดียว — MySQL ไม่มี embed
// แบบนี้ เลยแยกเป็น 2 query: (1) ห้องทั้งหมด + LEFT JOIN teachers
// สำหรับ borrowed_by (ยัง 1:1 join ตรงๆ ได้ปกติ) (2) รูปทั้งหมดของ
// ห้องที่ดึงมาในรอบแรก ด้วย WHERE room_tag_id IN (...) แล้ว group
// เข้าด้วยกันในโค้ด JS — ตรงตาม MANIFEST ข้อ 4 (ห้ามลืม sort ตาม
// sort_order ตอน group)
// -------------------------------------------------------------
router.get("/keys/status", async (req, res) => {
  try {
    const [roomRows] = await query(
      `SELECT
         rt.id, rt.room_name, rt.tag_uid, rt.description, rt.is_active,
         rt.status, rt.borrowed_at, rt.image_url,
         rt.borrow_window_days, rt.borrow_window_start, rt.borrow_window_end,
         t.id AS borrower_id, t.name AS borrower_name, t.department AS borrower_department
       FROM room_tags rt
       LEFT JOIN teachers t ON t.id = rt.borrowed_by_teacher_id
       WHERE rt.is_active = 1
       ORDER BY rt.room_name ASC`
    );

    const roomIds = roomRows.map((r) => r.id);

    let imagesByRoomId = new Map();
    if (roomIds.length > 0) {
      const [imageRows] = await query(
        `SELECT id, room_tag_id, image_url, sort_order
         FROM room_images
         WHERE room_tag_id IN (?)
         ORDER BY sort_order ASC`,
        [roomIds]
      );

      imagesByRoomId = new Map();
      for (const img of imageRows) {
        if (!imagesByRoomId.has(img.room_tag_id)) imagesByRoomId.set(img.room_tag_id, []);
        imagesByRoomId.get(img.room_tag_id).push({
          id: img.id,
          image_url: img.image_url,
          sort_order: img.sort_order,
        });
      }
    }

    const keys = roomRows.map((r) => ({
      id: r.id,
      room_name: r.room_name,
      tag_uid: r.tag_uid,
      description: r.description,
      is_active: !!r.is_active,
      status: r.status,
      borrowed_at: r.borrowed_at,
      image_url: r.image_url,
      borrow_window_days: parseBorrowWindowDays(r.borrow_window_days),
      borrow_window_start: r.borrow_window_start,
      borrow_window_end: r.borrow_window_end,
      borrowed_by:
        r.borrower_id !== null
          ? { id: r.borrower_id, name: r.borrower_name, department: r.borrower_department }
          : null,
      room_images: imagesByRoomId.get(r.id) || [],
    }));

    return res.json({ ok: true, keys });
  } catch (err) {
    console.error("Keys status error:", {
      message: err.message,
      code: err.code,
      errno: err.errno,
      sqlMessage: err.sqlMessage,
      sqlState: err.sqlState,
    });
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
    const [roomRows] = await query("SELECT id, room_name FROM room_tags WHERE id = ?", [
      roomTagId,
    ]);

    if (roomRows.length === 0) {
      return res.status(404).json({ ok: false, message: "ไม่พบห้อง/กุญแจนี้" });
    }
    const room = roomRows[0];

    // นับ total count แยกจากการดึง 10 รายการ — เทียบเท่า count: "exact",
    // head: true ของ Supabase (แค่เอาเลขนับ ไม่ต้องดึง body)
    const [countRows] = await query(
      "SELECT COUNT(*) AS total FROM key_logs WHERE room_tag_id = ?",
      [roomTagId]
    );
    const totalCount = countRows[0].total;

    const [logRows] = await query(
      `SELECT
         kl.id, kl.action, kl.acted_at,
         t.id AS teacher_id, t.name AS teacher_name, t.department AS teacher_department
       FROM key_logs kl
       LEFT JOIN teachers t ON t.id = kl.teacher_id
       WHERE kl.room_tag_id = ?
       ORDER BY kl.acted_at DESC
       LIMIT ?`,
      [roomTagId, ROOM_HISTORY_PREVIEW_LIMIT]
    );

    const logs = logRows.map((r) => ({
      id: r.id,
      action: r.action,
      acted_at: r.acted_at,
      teachers:
        r.teacher_id !== null
          ? { id: r.teacher_id, name: r.teacher_name, department: r.teacher_department }
          : null,
    }));

    return res.json({
      ok: true,
      room: { id: room.id, roomName: room.room_name },
      logs,
      totalCount,
    });
  } catch (err) {
    console.error("Room history error:", {
      message: err.message,
      code: err.code,
      errno: err.errno,
      sqlMessage: err.sqlMessage,
      sqlState: err.sqlState,
    });
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
//
// ของเดิม { count: "exact" } + .range(from, to) ได้ count คู่กับข้อมูล
// ใน query เดียว — MySQL แยกเป็น 2 query ชัดเจนตาม MANIFEST ข้อ 5:
// SELECT COUNT(*) ... แล้วค่อย SELECT ... LIMIT ? OFFSET ?
//
// สำคัญ: response ของแถวต้องมี key ชื่อ room_tags / teachers (ไม่ใช่
// room / teacher) เพราะ public/js/history.js ที่มีอยู่แล้วอ่านจาก
// log.room_tags.room_name และ log.teachers.name ตรงๆ
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
  const offset = (parsedPage - 1) * parsedLimit;

  let parsedRoomId = null;
  if (roomId) {
    parsedRoomId = parseInt(roomId, 10);
    if (!Number.isInteger(parsedRoomId)) {
      return res.status(400).json({ ok: false, message: "รหัสห้อง/กุญแจไม่ถูกต้อง" });
    }
  }

  try {
    const whereClause = parsedRoomId !== null ? "WHERE kl.room_tag_id = ?" : "";
    const whereParams = parsedRoomId !== null ? [parsedRoomId] : [];

    const [countRows] = await query(
      `SELECT COUNT(*) AS total FROM key_logs kl ${whereClause}`,
      whereParams
    );
    const totalCount = countRows[0].total;

    const [logRows] = await query(
      `SELECT
         kl.id, kl.action, kl.acted_at,
         rt.id AS room_id, rt.room_name,
         t.id AS teacher_id, t.name AS teacher_name, t.department AS teacher_department
       FROM key_logs kl
       LEFT JOIN room_tags rt ON rt.id = kl.room_tag_id
       LEFT JOIN teachers t ON t.id = kl.teacher_id
       ${whereClause}
       ORDER BY kl.acted_at DESC
       LIMIT ? OFFSET ?`,
      [...whereParams, parsedLimit, offset]
    );

    const logs = logRows.map((r) => ({
      id: r.id,
      action: r.action,
      acted_at: r.acted_at,
      room_tags: r.room_id !== null ? { id: r.room_id, room_name: r.room_name } : null,
      teachers:
        r.teacher_id !== null
          ? { id: r.teacher_id, name: r.teacher_name, department: r.teacher_department }
          : null,
    }));

    return res.json({
      ok: true,
      logs,
      page: parsedPage,
      limit: parsedLimit,
      totalCount,
      totalPages: Math.max(Math.ceil(totalCount / parsedLimit), 1),
    });
  } catch (err) {
    console.error("All keys history error:", {
      message: err.message,
      code: err.code,
      errno: err.errno,
      sqlMessage: err.sqlMessage,
      sqlState: err.sqlState,
    });
    return res.status(500).json({
      ok: false,
      message: "ดึงประวัติยืม-คืนไม่สำเร็จ",
    });
  }
});

module.exports = router;