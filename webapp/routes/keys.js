// routes/keys.js
// -----------------------------------------------------------------
// มุมมอง read-only แบบสาธารณะ (ไม่ต้อง login)
// - ดูสถานะกุญแจทั้งหมด
// - ดูประวัติยืม-คืน
//
// Auth: public routes (ไม่มี requireAuth)
// -----------------------------------------------------------------

const express = require("express");
const router = express.Router();
const pool = require("../config/db");

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

// -----------------------------------------------------------------
// GET /api/keys/status
// สถานะกุญแจทั้งหมด (ว่าง/ถูกย��ม + ใครยืมอยู่ + รูปภาพ)
// -----------------------------------------------------------------
router.get("/keys/status", async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();

    // ดึงกุญแจทั้งหมด + ผู้ยืม
    const [roomRows] = await connection.query(
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
      const [imageRows] = await connection.query(
        `SELECT id, room_tag_id, image_url, sort_order
         FROM room_images
         WHERE room_tag_id IN (?)
         ORDER BY sort_order ASC`,
        [roomIds]
      );

      imagesByRoomId = new Map();
      for (const img of imageRows) {
        if (!imagesByRoomId.has(img.room_tag_id))
          imagesByRoomId.set(img.room_tag_id, []);
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
          ? {
              id: r.borrower_id,
              name: r.borrower_name,
              department: r.borrower_department,
            }
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
    });
    return res.status(500).json({
      ok: false,
      message: "ดึงสถานะกุญแจไม่สำเร็จ",
    });
  } finally {
    if (connection) connection.release();
  }
});

// -----------------------------------------------------------------
// GET /api/keys/:id/history
// ประวัติยืม-คืนของกุญแจดอกเดียว (10 รายการล่าสุด + total count)
// -----------------------------------------------------------------
const ROOM_HISTORY_PREVIEW_LIMIT = 10;

router.get("/keys/:id/history", async (req, res) => {
  const { id } = req.params;
  const roomTagId = parseInt(id, 10);

  if (!Number.isInteger(roomTagId)) {
    return res
      .status(400)
      .json({ ok: false, message: "รหัสห้อง/กุญแจไม่ถูกต้อง" });
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // เช็คห้องมีอยู่ไหม
    const [roomRows] = await connection.query(
      "SELECT id, room_name FROM room_tags WHERE id = ?",
      [roomTagId]
    );

    if (roomRows.length === 0) {
      return res
        .status(404)
        .json({ ok: false, message: "ไม่พบห้อง/กุญแจนี้" });
    }
    const room = roomRows[0];

    // นับ total count
    const [countRows] = await connection.query(
      "SELECT COUNT(*) AS total FROM key_logs WHERE room_tag_id = ?",
      [roomTagId]
    );
    const totalCount = countRows[0].total;

    // ดึง 10 รายการล่าสุด
    const [logRows] = await connection.query(
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
          ? {
              id: r.teacher_id,
              name: r.teacher_name,
              department: r.teacher_department,
            }
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
    });
    return res.status(500).json({
      ok: false,
      message: "ดึงประวัติกุญแจไม่สำเร็จ",
    });
  } finally {
    if (connection) connection.release();
  }
});

// -----------------------------------------------------------------
// GET /api/keys/history/all
// ประวัติยืม-คืนทั้งหมด (paginated)
// query: page, limit, roomId (optional filter)
// -----------------------------------------------------------------
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
      return res
        .status(400)
        .json({ ok: false, message: "รหัสห้อง/กุญแจไม่ถูกต้อง" });
    }
  }

  let connection;
  try {
    connection = await pool.getConnection();

    const whereClause =
      parsedRoomId !== null ? "WHERE kl.room_tag_id = ?" : "";
    const whereParams = parsedRoomId !== null ? [parsedRoomId] : [];

    // นับทั้งหมด
    const [countRows] = await connection.query(
      `SELECT COUNT(*) AS total FROM key_logs kl ${whereClause}`,
      whereParams
    );
    const totalCount = countRows[0].total;

    // ดึงข้อมูล paginated
    const [logRows] = await connection.query(
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
      room_tags:
        r.room_id !== null ? { id: r.room_id, room_name: r.room_name } : null,
      teachers:
        r.teacher_id !== null
          ? {
              id: r.teacher_id,
              name: r.teacher_name,
              department: r.teacher_department,
            }
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
    });
    return res.status(500).json({
      ok: false,
      message: "ดึงประวัติยืม-คืนไม่สำเร็จ",
    });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
