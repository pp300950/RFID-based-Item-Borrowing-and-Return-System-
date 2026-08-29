// routes/admin_rooms.js
// -----------------------------------------------------------------
// เฉพาะส่วน "ห้อง/กุญแจ" (room_tags) สำหรับหน้า admin dashboard
//
// Auth: ป้องกันด้วย requireAuth + requireRole("admin") ที่จุด mount
// router นี้ใน server.js — ไม่ได้ใส่ middleware ซ้ำในไฟล์นี้เอง
//
// [BLOB migration] รูปภาพเก็บเป็น binary (LONGBLOB) ตรงในตาราง MySQL
// แทนไฟล์บนดิสก์ — สาเหตุ: เดิมเก็บไฟล์จริงบนดิสก์ ปัญหาคือ Render
// (ที่รันเว็บ) กับเครื่อง local (ที่รัน MySQL/bridge) เป็นคนละเครื่อง
// กัน ไฟล์ที่ bridge เขียนลงดิสก์เครื่อง local ไม่มีทาง "โผล่" ที่
// Render ได้เลย ทำให้ endpoint /uploads/room-images/... ตอบ 404 เสมอ
// เปลี่ยนมาเก็บเป็น BLOB ผ่าน query()/withTransaction() ปกติ (เหมือน
// ข้อมูลอื่นทุกจุด) แก้ปัญหานี้ตรงๆ เพราะไม่ต้องพึ่ง path ไฟล์/tunnel
// URL อีกต่อไป — โค้ดไฟล์นี้จึงไม่ต้องแยก local/bridge สำหรับรูปภาพ
// อีกแล้ว (multer ใช้ memoryStorage() เสมอทั้งสองโหมด) ง่ายขึ้นมาก
//
// การดึงรูปกลับมาโชว์ ดู GET /api/admin/rooms/:id/image และ
// GET /api/admin/rooms/images/:imageId ท้ายไฟล์นี้ + public route คู่กัน
// ใน server.js (ไม่ต้อง login เพราะหน้า keys.html ก็ต้องโชว์รูปได้ด้วย)
// -----------------------------------------------------------------

const express = require("express");
const multer = require("multer");
const router = express.Router();
// [Fix] เดิม const { pool } ใช้ pool.query()/pool.getConnection() ตรงๆ
// ทั่วทั้งไฟล์ — ใช้ได้เฉพาะ DB_MODE=local เปลี่ยนมาใช้
// query()/withTransaction() แทนทุกจุด ให้ตรง pattern เดียวกับไฟล์
// route อื่นทั้งหมด (tap.js, keys.js, admin_keys.js, ฯลฯ)
const { query, withTransaction } = require("../config/db");

// -------------------------------------------------------------
// multer: memoryStorage() เสมอ ไม่ว่าจะ DB_MODE ไหน — รูปภาพจะถูกอ่าน
// เป็น req.file.buffer แล้ว INSERT/UPDATE ลง MySQL เป็น LONGBLOB ตรงๆ
// ผ่าน query()/withTransaction() (ซึ่งวิ่งผ่าน bridge อัตโนมัติเองอยู่
// แล้วถ้า DB_MODE=bridge — ไม่ต้องยุ่งเรื่อง path ไฟล์/forward เอง
// เหมือนโค้ดเดิมอีกต่อไป)
//
// จำกัดขนาด 5MB และรับเฉพาะไฟล์ที่ mimetype เป็นรูปภาพเท่านั้น (เหมือนเดิม)
// -------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("ไฟล์ต้องเป็นรูปภาพเท่านั้น"));
    }
    cb(null, true);
  },
});

// -------------------------------------------------------------
// validateBorrowWindow — ไม่แก้จากเดิม (ไม่เกี่ยวกับรูปภาพ)
// -------------------------------------------------------------
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

function validateBorrowWindow(body) {
  const { borrowWindowDays, borrowWindowStart, borrowWindowEnd } = body;
  const value = {};

  if (borrowWindowDays !== undefined) {
    if (borrowWindowDays === null) {
      value.borrow_window_days = null;
    } else if (
      !Array.isArray(borrowWindowDays) ||
      borrowWindowDays.length === 0 ||
      !borrowWindowDays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    ) {
      return {
        ok: false,
        message: "borrowWindowDays ต้องเป็น null หรือ array ของเลข 0-6 (0=อาทิตย์..6=เสาร์)",
      };
    } else {
      value.borrow_window_days = [...new Set(borrowWindowDays)].sort((a, b) => a - b);
    }
  }

  const startProvided = borrowWindowStart !== undefined;
  const endProvided = borrowWindowEnd !== undefined;

  if (startProvided !== endProvided) {
    return {
      ok: false,
      message: "กรุณาส่ง borrowWindowStart และ borrowWindowEnd มาพร้อมกันเสมอ",
    };
  }

  if (startProvided && endProvided) {
    const bothNull = borrowWindowStart === null && borrowWindowEnd === null;
    const bothStrings =
      typeof borrowWindowStart === "string" && typeof borrowWindowEnd === "string";

    if (!bothNull && !bothStrings) {
      return {
        ok: false,
        message: "borrowWindowStart/borrowWindowEnd ต้องเป็น null ทั้งคู่ หรือเป็นเวลาทั้งคู่",
      };
    }

    if (bothStrings) {
      if (!TIME_RE.test(borrowWindowStart) || !TIME_RE.test(borrowWindowEnd)) {
        return {
          ok: false,
          message: "รูปแบบเวลาต้องเป็น HH:MM หรือ HH:MM:SS",
        };
      }
      value.borrow_window_start = borrowWindowStart;
      value.borrow_window_end = borrowWindowEnd;
    } else {
      value.borrow_window_start = null;
      value.borrow_window_end = null;
    }
  }

  return { ok: true, value };
}

function serializeRoomPayload(payload) {
  const out = { ...payload };
  if ("borrow_window_days" in out) {
    out.borrow_window_days =
      out.borrow_window_days === null ? null : JSON.stringify(out.borrow_window_days);
  }
  return out;
}

// คอลัมน์ที่ปลอดภัยจะ SELECT * แทน — เว้น image_data (LONGBLOB) ออกจาก
// list/detail query เสมอ กัน response ใหญ่โดยไม่จำเป็น ใช้ has_image
// เป็น flag แทน แล้วดึงรูปจริงแยกผ่าน endpoint /image ต่างหาก
const ROOM_LIST_COLUMNS = `
  id, room_name, tag_uid, description, is_active, status,
  borrowed_by_teacher_id, borrowed_at, borrow_window_days,
  borrow_window_start, borrow_window_end, created_at,
  (image_data IS NOT NULL) AS has_image
`;

// -------------------------------------------------------------
// GET /api/admin/rooms
// -------------------------------------------------------------
router.get("/rooms", async (req, res) => {
  try {
    const [rows] = await query(
      `SELECT ${ROOM_LIST_COLUMNS} FROM room_tags ORDER BY room_name ASC`
    );
    return res.json({ ok: true, rooms: rows });
  } catch (err) {
    console.error("Admin list rooms error:", err.message);
    return res.status(500).json({ ok: false, message: "ดึงรายการห้อง/กุญแจไม่สำเร็จ" });
  }
});

// -------------------------------------------------------------
// POST /api/admin/rooms
// -------------------------------------------------------------
router.post("/rooms", async (req, res) => {
  const { roomName, tagUid, description } = req.body;

  if (!roomName || !roomName.trim()) {
    return res.status(400).json({ ok: false, message: "กรุณากรอกชื่อห้อง/กุญแจ" });
  }

  const windowResult = validateBorrowWindow(req.body);
  if (!windowResult.ok) {
    return res.status(400).json({ ok: false, message: windowResult.message });
  }

  try {
    if (tagUid && tagUid.trim()) {
      const [existingRows] = await query(
        `SELECT id FROM room_tags WHERE tag_uid = ? LIMIT 1`,
        [tagUid.trim()]
      );
      if (existingRows.length > 0) {
        return res.status(409).json({ ok: false, message: "เลขแท็กนี้ถูกผูกกับห้อง/กุญแจอื่นไปแล้ว" });
      }
    }

    const payload = serializeRoomPayload({
      room_name: roomName.trim(),
      tag_uid: tagUid && tagUid.trim() ? tagUid.trim() : null,
      description: description ? description.trim() : null,
      ...windowResult.value,
    });

    const columns = Object.keys(payload);
    const placeholders = columns.map(() => "?").join(", ");
    const values = columns.map((col) => payload[col]);

    const [insertResult] = await query(
      `INSERT INTO room_tags (${columns.join(", ")}) VALUES (${placeholders})`,
      values
    );

    const [createdRows] = await query(
      `SELECT ${ROOM_LIST_COLUMNS} FROM room_tags WHERE id = ?`,
      [insertResult.insertId]
    );

    return res.json({ ok: true, room: createdRows[0] });
  } catch (err) {
    console.error("Admin create room error:", err.message);
    return res.status(500).json({ ok: false, message: "สร้างห้อง/กุญแจไม่สำเร็จ" });
  }
});

// -------------------------------------------------------------
// PATCH /api/admin/rooms/:id
// -------------------------------------------------------------
router.patch("/rooms/:id", async (req, res) => {
  const { id } = req.params;
  const { roomName, tagUid, description, isActive } = req.body;

  const windowResult = validateBorrowWindow(req.body);
  if (!windowResult.ok) {
    return res.status(400).json({ ok: false, message: windowResult.message });
  }

  const updatePayload = { ...windowResult.value };
  if (roomName !== undefined) updatePayload.room_name = roomName.trim();
  if (tagUid !== undefined) updatePayload.tag_uid = tagUid && tagUid.trim() ? tagUid.trim() : null;
  if (description !== undefined) updatePayload.description = description ? description.trim() : null;
  if (isActive !== undefined) updatePayload.is_active = !!isActive;

  if (Object.keys(updatePayload).length === 0) {
    return res.status(400).json({ ok: false, message: "ไม่มีข้อมูลให้แก้ไข" });
  }

  try {
    if (updatePayload.tag_uid) {
      const [existingRows] = await query(
        `SELECT id FROM room_tags WHERE tag_uid = ? AND id != ? LIMIT 1`,
        [updatePayload.tag_uid, id]
      );
      if (existingRows.length > 0) {
        return res.status(409).json({ ok: false, message: "เลขแท็กนี้ถูกผูกกับห้อง/กุญแจอื่นไปแล้ว" });
      }
    }

    const payload = serializeRoomPayload(updatePayload);
    const columns = Object.keys(payload);
    const setSql = columns.map((col) => `${col} = ?`).join(", ");
    const values = columns.map((col) => payload[col]);

    const [updateResult] = await query(
      `UPDATE room_tags SET ${setSql} WHERE id = ?`,
      [...values, id]
    );

    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ ok: false, message: "ไม่พบห้อง/กุญแจนี้" });
    }

    const [updatedRows] = await query(
      `SELECT ${ROOM_LIST_COLUMNS} FROM room_tags WHERE id = ?`,
      [id]
    );

    return res.json({ ok: true, room: updatedRows[0] });
  } catch (err) {
    console.error("Admin update room error:", err.message);
    return res.status(500).json({ ok: false, message: "แก้ไขห้อง/กุญแจไม่สำเร็จ" });
  }
});

// -------------------------------------------------------------
// POST /api/admin/rooms/:id/image
// multipart/form-data field name: "image"
// [BLOB migration] อ่านไฟล์จาก req.file.buffer แล้วเก็บตรงลง
// room_tags.image_data/image_mime ผ่าน query() ปกติ — ทำงานเหมือนกัน
// ทุกจุดไม่ว่า DB_MODE จะเป็น local หรือ bridge
// -------------------------------------------------------------
router.post("/rooms/:id/image", upload.single("image"), async (req, res) => {
  const { id } = req.params;

  if (!req.file) {
    return res.status(400).json({ ok: false, message: "กรุณาเลือกไฟล์รูปภาพ" });
  }

  try {
    const [updateResult] = await query(
      `UPDATE room_tags SET image_data = ?, image_mime = ? WHERE id = ?`,
      [req.file.buffer, req.file.mimetype, id]
    );

    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ ok: false, message: "ไม่พบห้อง/กุญแจนี้" });
    }

    const [updatedRows] = await query(
      `SELECT ${ROOM_LIST_COLUMNS} FROM room_tags WHERE id = ?`,
      [id]
    );

    return res.json({ ok: true, room: updatedRows[0] });
  } catch (err) {
    console.error("Admin upload room image error:", err.message);
    return res.status(500).json({ ok: false, message: "อัปโหลดรูปภาพไม่สำเร็จ" });
  }
});

// -------------------------------------------------------------
// GET /api/admin/rooms/:id/image
// ดึงรูปภาพเดี่ยวของห้อง (room_tags.image_data) กลับมาเป็นไฟล์รูปจริง
// endpoint นี้ผ่าน requireAuth + requireRole("admin") (mount ที่
// server.js) — หน้า public ใช้ endpoint คู่กันที่ไม่ต้อง login แทน
// (ดู server.js — GET /uploads/room-images/room/:id)
// -------------------------------------------------------------
router.get("/rooms/:id/image", async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await query(
      `SELECT image_data, image_mime FROM room_tags WHERE id = ? LIMIT 1`,
      [id]
    );

    if (rows.length === 0 || !rows[0].image_data) {
      return res.status(404).json({ ok: false, message: "ไม่พบรูปภาพนี้" });
    }

    res.set("Content-Type", rows[0].image_mime || "image/jpeg");
    return res.send(rows[0].image_data);
  } catch (err) {
    console.error("Admin get room image error:", err.message);
    return res.status(500).json({ ok: false, message: "ดึงรูปภาพไม่สำเร็จ" });
  }
});

// -------------------------------------------------------------
// POST /api/admin/rooms/:id/images
// multipart/form-data field name: "images" (รับได้หลายไฟล์พร้อมกัน)
// [BLOB migration] insert แต่ละไฟล์เป็น 1 แถวใน room_images พร้อม
// image_data/image_mime — ห่อด้วย withTransaction() จริง ถ้า insert
// ล้มเหลว rollback ให้เองทั้งหมด (ไม่มีไฟล์บนดิสก์ต้อง cleanup อีก
// ต่อไป เพราะรูปเป็น BLOB ในแถวที่ rollback ได้ปกติ)
// -------------------------------------------------------------
const MAX_IMAGES_PER_UPLOAD = 10;

router.post("/rooms/:id/images", upload.array("images", MAX_IMAGES_PER_UPLOAD), async (req, res) => {
  const { id } = req.params;

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ ok: false, message: "กรุณาเลือกไฟล์รูปภาพอย่างน้อย 1 ไฟล์" });
  }

  try {
    const [roomRows] = await query(`SELECT id FROM room_tags WHERE id = ? LIMIT 1`, [id]);
    if (roomRows.length === 0) {
      return res.status(404).json({ ok: false, message: "ไม่พบห้อง/กุญแจนี้" });
    }

    const [maxRows] = await query(
      `SELECT sort_order FROM room_images WHERE room_tag_id = ? ORDER BY sort_order DESC LIMIT 1`,
      [id]
    );
    let nextSortOrder = maxRows.length > 0 ? maxRows[0].sort_order + 1 : 0;

    const insertedRows = req.files.map((file) => {
      const row = {
        room_tag_id: id,
        image_data: file.buffer,
        image_mime: file.mimetype,
        sort_order: nextSortOrder,
      };
      nextSortOrder += 1;
      return row;
    });

    // [Fix] เดิมใช้ pool.getConnection() ด้วยมือ — เปลี่ยนมาใช้
    // withTransaction() แทน ทำงานได้ทั้งสองโหมด
    const createdRows = await withTransaction(async (conn) => {
      const insertedIds = [];
      // insert ทีละแถว (ไม่ใช้ multi-row VALUES ?) เพราะ image_data เป็น
      // LONGBLOB ตัวใหญ่ — ทีละแถวชัดเจนและปลอดภัยกว่าส่งก้อนใหญ่ผ่าน
      // JSON ทีเดียวตอน DB_MODE=bridge
      for (const row of insertedRows) {
        const [result] = await conn.query(
          `INSERT INTO room_images (room_tag_id, image_data, image_mime, sort_order) VALUES (?, ?, ?, ?)`,
          [row.room_tag_id, row.image_data, row.image_mime, row.sort_order]
        );
        insertedIds.push(result.insertId);
      }

      const [rows] = await conn.query(
        `SELECT id, room_tag_id, sort_order, created_at FROM room_images WHERE id IN (?) ORDER BY sort_order ASC`,
        [insertedIds]
      );
      return rows;
    });

    return res.json({ ok: true, images: createdRows });
  } catch (err) {
    console.error("Admin add room images error:", err.message);
    return res.status(500).json({ ok: false, message: "อัปโหลดรูปภาพไม่สำเร็จ" });
  }
});

// -------------------------------------------------------------
// GET /api/admin/rooms/images/:imageId
// ดึงรูปภาพเดี่ยวจาก room_images (multi-image) กลับมาเป็นไฟล์รูปจริง
// -------------------------------------------------------------
router.get("/rooms/images/:imageId", async (req, res) => {
  const { imageId } = req.params;

  try {
    const [rows] = await query(
      `SELECT image_data, image_mime FROM room_images WHERE id = ? LIMIT 1`,
      [imageId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, message: "ไม่พบรูปภาพนี้" });
    }

    res.set("Content-Type", rows[0].image_mime || "image/jpeg");
    return res.send(rows[0].image_data);
  } catch (err) {
    console.error("Admin get room images list image error:", err.message);
    return res.status(500).json({ ok: false, message: "ดึงรูปภาพไม่สำเร็จ" });
  }
});

// -------------------------------------------------------------
// DELETE /api/admin/rooms/:id/images/:imageId
// [BLOB migration] ลบแค่แถวใน DB พอ ไม่ต้อง cleanup ไฟล์บนดิสก์อีก
// ต่อไป (BLOB หายไปพร้อมแถวโดยอัตโนมัติ)
// -------------------------------------------------------------
router.delete("/rooms/:id/images/:imageId", async (req, res) => {
  const { id, imageId } = req.params;

  try {
    const [imageRows] = await query(
      `SELECT id FROM room_images WHERE id = ? AND room_tag_id = ? LIMIT 1`,
      [imageId, id]
    );

    if (imageRows.length === 0) {
      return res.status(404).json({ ok: false, message: "ไม่พบรูปภาพนี้" });
    }

    await query(`DELETE FROM room_images WHERE id = ?`, [imageId]);

    return res.json({ ok: true });
  } catch (err) {
    console.error("Admin delete room image error:", err.message);
    return res.status(500).json({ ok: false, message: "ลบรูปภาพไม่สำเร็จ" });
  }
});

// -------------------------------------------------------------
// PATCH /api/admin/rooms/:id/images/reorder — ไม่แก้จากเดิม
// -------------------------------------------------------------
router.patch("/rooms/:id/images/reorder", async (req, res) => {
  const { id } = req.params;
  const { order } = req.body;

  if (!Array.isArray(order) || order.length === 0) {
    return res.status(400).json({ ok: false, message: "กรุณาส่ง order เป็น array ของ imageId" });
  }

  const uniqueOrder = new Set(order);
  if (uniqueOrder.size !== order.length) {
    return res.status(400).json({ ok: false, message: "order มี imageId ซ้ำกัน" });
  }

  try {
    const [existingImages] = await query(
      `SELECT id FROM room_images WHERE room_tag_id = ?`,
      [id]
    );

    if (!existingImages || existingImages.length === 0) {
      return res.status(404).json({ ok: false, message: "ห้องนี้ยังไม่มีรูปภาพให้จัดลำดับ" });
    }

    const existingIds = new Set(existingImages.map((img) => String(img.id)));
    const orderIds = order.map((imgId) => String(imgId));

    const sameSize = existingIds.size === orderIds.length;
    const allBelongToRoom = orderIds.every((imgId) => existingIds.has(imgId));

    if (!sameSize || !allBelongToRoom) {
      return res.status(400).json({
        ok: false,
        message: "order ต้องมี imageId ครบทุกรูปของห้องนี้ และเป็นของห้องนี้เท่านั้น",
      });
    }

    const updatedRows = [];
    for (let index = 0; index < orderIds.length; index += 1) {
      await query(`UPDATE room_images SET sort_order = ? WHERE id = ?`, [index, orderIds[index]]);
      const [rows] = await query(
        `SELECT id, room_tag_id, sort_order, created_at FROM room_images WHERE id = ?`,
        [orderIds[index]]
      );
      updatedRows.push(rows[0]);
    }

    updatedRows.sort((a, b) => a.sort_order - b.sort_order);

    return res.json({ ok: true, images: updatedRows });
  } catch (err) {
    console.error("Admin reorder room images error:", err.message);
    return res.status(500).json({ ok: false, message: "จัดลำดับรูปภาพไม่สำเร็จ" });
  }
});

// -------------------------------------------------------------
// DELETE /api/admin/rooms/:id
// [BLOB migration] รูปภาพเป็น BLOB ในแถวเดียวกัน หายไปพร้อม cascade
// delete อัตโนมัติ ไม่มีไฟล์บนดิสก์ตกค้างให้ต้องเป็นห่วงอีกต่อไป
// -------------------------------------------------------------
router.delete("/rooms/:id", async (req, res) => {
  const { id } = req.params;

  try {
    await query(`DELETE FROM room_tags WHERE id = ?`, [id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Admin delete room error:", err.message);
    return res.status(500).json({ ok: false, message: "ลบห้อง/กุญแจไม่สำเร็จ" });
  }
});

// -------------------------------------------------------------
// Multer error handler เฉพาะ router นี้
// -------------------------------------------------------------
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message === "ไฟล์ต้องเป็นรูปภาพเท่านั้น") {
    return res.status(400).json({ ok: false, message: err.message });
  }
  next(err);
});

module.exports = router;
