// routes/admin_rooms.js
// -----------------------------------------------------------------
// เฉพาะส่วน "ห้อง/กุญแจ" (room_tags) สำหรับหน้า admin dashboard
// ไฟล์นี้ตั้งใจแยกออกจาก routes อื่น ๆ ของแอดมิน (room_items,
// teacher_tags, teacher_room_assignments) เพื่อให้รีวิวทีละก้อนได้ง่าย
//
// Auth: ป้องกันด้วย requireAuth + requireRole("admin") ที่จุด mount
// router นี้ใน server.js (app.use("/api/admin", requireAuth,
// requireRole("admin"), ...)) ไม่ได้ใส่ middleware ซ้ำในไฟล์นี้เอง
// เพื่อกันลืมเผลอ mount โดยไม่ป้องกันในอนาคต — ดู server.js เป็นจุดเดียว
// ที่ยืนยันว่าทุก /api/admin/* ต้อง login เป็นแอดมินก่อนเสมอ
//
// [MySQL migration] จุดที่เปลี่ยนหลักๆ ในไฟล์นี้ (ดู MANIFEST ข้อ 8):
//   - multer: memoryStorage() -> diskStorage() เขียนตรงไป
//     public/uploads/room-images/ ด้วยชื่อไฟล์รูปแบบเดิม
//   - image_url เก็บ path สัมพัทธ์ (/uploads/room-images/room-...) แทน
//     public URL เต็มของ Supabase Storage — express.static เสิร์ฟ
//     public/ อยู่แล้วใน server.js ฝั่ง frontend ไม่ต้องแก้อะไร
//   - "ลบไฟล์เก่า" ของ Supabase Storage -> fs.unlink() แบบ best-effort
//     เหมือนเดิม (catch แล้ว log เฉยๆ ไม่ throw)
//   - สร้างโฟลเดอร์ปลายทางด้วย fs.mkdirSync(..., { recursive: true })
//     ตอน startup ของไฟล์นี้ กัน ENOENT ตอนอัปโหลดรูปแรก
//   - POST /rooms/:id/images (multi-insert หลายแถวพร้อมกัน) ห่อด้วย
//     transaction จริงตามข้อ 9 ของ MANIFEST
// -----------------------------------------------------------------

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const router = express.Router();
// [Fix] เดิม const { pool } ใช้ pool.query()/pool.getConnection() ตรงๆ
// ทั่วทั้งไฟล์ — ใช้ได้เฉพาะ DB_MODE=local เพราะโหมด bridge
// (db-bridge-client.js) export pool: null เสมอ (ไม่มี raw pool ให้ใช้
// ตรงๆ ในสถาปัตยกรรม HTTP bridge) เปลี่ยนมาใช้ query()/withTransaction()
// แทนทุกจุด ให้ตรง pattern เดียวกับไฟล์ route อื่นทั้งหมด
// (tap.js, keys.js, admin_keys.js, admin_teachers.js, export.js)
const { query, withTransaction } = require("../config/db");

// -------------------------------------------------------------
// [Fix] DB_MODE=bridge (รันบน Render) — ไฟล์รูปต้องไปอยู่บนเครื่อง
// local (คู่กับ XAMPP) ไม่ใช่ดิสก์ของ Render เอง (ephemeral + คนละ
// เครื่องกับที่ express.static เสิร์ฟไฟล์อยู่จริง) จึงต้องแยกพฤติกรรม
// การจัดการไฟล์ตาม DB_MODE เป็นจุดเดียวตรงนี้:
//   - local  : multer diskStorage เขียนไฟล์ลงดิสก์ตรงๆ เหมือนเดิมทุก
//              ประการ ไม่มีอะไรเปลี่ยน
//   - bridge : multer memoryStorage เก็บไฟล์เป็น buffer ใน memory ก่อน
//              แล้ว forward ไปให้ bridge-server.js เขียนลงดิสก์บน
//              เครื่อง local แทน ผ่าน POST /upload-image (multipart)
//              และลบไฟล์ผ่าน DELETE /image — ใช้ DB_BRIDGE_URL/
//              DB_BRIDGE_KEY ตัวเดียวกับที่ config/db-bridge-client.js
//              ใช้อยู่แล้ว ไม่ต้องเพิ่ม env ใหม่
// -------------------------------------------------------------
const DB_MODE = process.env.DB_MODE === "bridge" ? "bridge" : "local";
const BRIDGE_URL = process.env.DB_BRIDGE_URL;
const BRIDGE_KEY = process.env.DB_BRIDGE_KEY;
const BRIDGE_UPLOAD_TIMEOUT_MS = 20000; // เท่ากับ FETCH_TIMEOUT_MS ใน db-bridge-client.js

// -------------------------------------------------------------
// โฟลเดอร์ปลายทางของรูปห้อง — สร้างไว้ล่วงหน้าตอนโหลดไฟล์นี้ กัน
// "ENOENT: no such directory" ตอนอัปโหลดรูปแรกสุดถ้ายังไม่มีโฟลเดอร์
// (git ไม่ track โฟลเดอร์ว่าง ต้องสร้างเองตอน startup)
// โหมด bridge ไม่ได้เขียนไฟล์ลงโฟลเดอร์นี้เอง (bridge-server.js เขียน
// ลงโฟลเดอร์เดียวกันนี้แต่บนเครื่อง local ต่างหาก) แต่ยังสร้างไว้เผื่อ
// ไม่ให้พังถ้ามีโค้ดอื่นอ้างอิง path นี้อยู่
// -------------------------------------------------------------
const ROOM_IMAGES_DIR = path.join(__dirname, "..", "public", "uploads", "room-images");
fs.mkdirSync(ROOM_IMAGES_DIR, { recursive: true });

// -------------------------------------------------------------
// buildRoomImageFilename(id, isMulti) -> "room-<id>-<suffix>.<ext>"
// ใช้ตั้งชื่อไฟล์ปลายทางให้ตรงรูปแบบเดิมทั้งสองโหมด (โหมด local ให้
// multer filename callback เรียกใช้ตอน "เขียนจริง", โหมด bridge ต้อง
// รู้ชื่อไฟล์ล่วงหน้าก่อนส่ง เพราะเป็นคนกำหนดชื่อเองแล้วบอก bridge
// ให้เขียนด้วยชื่อนี้ ไม่ใช่ให้ bridge สุ่มชื่อเอง — ดูคอมเมนต์ multer
// callback ใน bridge-server.js)
// -------------------------------------------------------------
function buildRoomImageFilename(id, originalname, isMulti) {
  const ext = (originalname.split(".").pop() || "jpg").toLowerCase();
  const suffix = isMulti
    ? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    : `${Date.now()}`;
  return `room-${id}-${suffix}.${ext}`;
}

// -------------------------------------------------------------
// multer: โหมด local ใช้ diskStorage เขียนไฟล์ตรงไป
// public/uploads/room-images/ เลย (แทน memoryStorage() + ส่งต่อให้
// Supabase Storage ของเดิม) ตั้งชื่อไฟล์ตอน "เขียนจริง" ใน filename
// callback ให้ตรงรูปแบบเดิม room-<id>-<timestamp>.<ext>
//
// โหมด bridge ใช้ memoryStorage แทน เพราะไฟล์ต้อง forward ไปเขียนที่
// เครื่อง local ผ่าน bridge ไม่ใช่เขียนบนดิสก์ของ Render เอง — ชื่อไฟล์
// คำนวณด้วย buildRoomImageFilename() เดียวกัน แล้วส่งชื่อนี้ไปพร้อม
// ไฟล์ตอนเรียก forwardImageToBridge() ด้านล่าง เพื่อให้ image_url ที่
// บันทึกลง DB ตรงกับชื่อไฟล์จริงบนเครื่อง local เป๊ะ
//
// จำกัดขนาด 5MB และรับเฉพาะไฟล์ที่ mimetype เป็นรูปภาพเท่านั้น (เหมือนเดิม)
// -------------------------------------------------------------
const storage =
  DB_MODE === "local"
    ? multer.diskStorage({
        destination: (req, file, cb) => {
          cb(null, ROOM_IMAGES_DIR);
        },
        filename: (req, file, cb) => {
          const id = req.params.id;
          const isMulti = req.route && req.route.path && req.route.path.endsWith("/images");
          cb(null, buildRoomImageFilename(id, file.originalname, isMulti));
        },
      })
    : multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("ไฟล์ต้องเป็นรูปภาพเท่านั้น"));
    }
    cb(null, true);
  },
});

// -------------------------------------------------------------
// forwardImageToBridge(file, filename) -> Promise<void>
// เฉพาะโหมด bridge — ส่งไฟล์ที่อยู่ใน memory (req.file.buffer จาก
// multer memoryStorage) ไปให้ bridge-server.js เขียนลงดิสก์บนเครื่อง
// local ผ่าน POST /upload-image (multipart/form-data)
// throw error ถ้า bridge ตอบ ok: false หรือต่อไม่ติด — handler ที่
// เรียกฟังก์ชันนี้ต้อง catch แล้วตอบ 500/ error ที่เหมาะสมเอง
// (ไม่มีไฟล์ค้างบนดิสก์ Render ต้องลบเพราะ memoryStorage ไม่เขียน
// ไฟล์ชั่วคราวลงดิสก์ตั้งแต่แรก ต่างจาก diskStorage โหมด local)
// -------------------------------------------------------------
async function forwardImageToBridge(file, filename) {
  if (!BRIDGE_URL || !BRIDGE_KEY) {
    throw new Error("DB_BRIDGE_URL / DB_BRIDGE_KEY ยังไม่ได้ตั้งค่า");
  }

  const form = new FormData();
  form.append("filename", filename);
  form.append("image", new Blob([file.buffer], { type: file.mimetype }), filename);

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), BRIDGE_UPLOAD_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${BRIDGE_URL}/upload-image`, {
      method: "POST",
      headers: { "X-Bridge-Key": BRIDGE_KEY },
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`bridge upload timeout หลังจาก ${BRIDGE_UPLOAD_TIMEOUT_MS}ms — เช็คว่าเครื่อง local + bridge-server.js + tunnel ยังรันอยู่ไหม`);
    }
    throw new Error(`ต่อ bridge ไม่ได้ (/upload-image): ${err.message} — เช็คว่าเครื่อง local + bridge-server.js + tunnel ยังรันอยู่ไหม`);
  } finally {
    clearTimeout(timeoutHandle);
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error(`bridge ตอบกลับไม่ใช่ JSON ที่ถูกต้อง (/upload-image): ${err.message}`);
  }

  if (!response.ok || !data.ok) {
    throw new Error(data.message || "bridge /upload-image ล้มเหลว");
  }
}

// -------------------------------------------------------------
// deleteImageViaBridge(filename) -> Promise<void>
// เฉพาะโหมด bridge — สั่งให้ bridge-server.js ลบไฟล์บนเครื่อง local
// ทิ้ง ผ่าน DELETE /image เป็น best-effort เหมือน fs.unlink ของโหมด
// local ทุกประการ (ไม่ throw ถ้าลบไม่สำเร็จ — แค่ log warning เฉยๆ
// เพราะไม่อยากให้ request หลักล้มเพราะลบไฟล์เก่าไม่ผ่าน)
// -------------------------------------------------------------
async function deleteImageViaBridge(filename) {
  if (!BRIDGE_URL || !BRIDGE_KEY) {
    console.error("Cleanup room image via bridge warning: DB_BRIDGE_URL / DB_BRIDGE_KEY ยังไม่ได้ตั้งค่า");
    return;
  }
  try {
    const response = await fetch(`${BRIDGE_URL}/image`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "X-Bridge-Key": BRIDGE_KEY,
      },
      body: JSON.stringify({ filename }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || !data.ok) {
      console.error("Cleanup room image via bridge warning:", (data && data.message) || response.statusText);
    }
  } catch (err) {
    console.error("Cleanup room image via bridge warning:", err.message);
  }
}

// -------------------------------------------------------------
// deleteRoomImageFile(imageUrl) -> Promise<void>
// จุดเดียวที่ตัดสินใจว่าจะลบไฟล์รูปเก่า/ที่ถูกลบด้วย fs.unlink ตรงๆ
// (โหมด local) หรือสั่งผ่าน bridge (โหมด bridge) — เรียกใช้แทน
// fs.unlink ตรงๆ ทุกจุดในไฟล์นี้ที่ต้องลบไฟล์รูป เป็น best-effort
// เหมือนกันทั้งสองโหมด ไม่ throw ออกไปให้ request หลักล้ม
// -------------------------------------------------------------
async function deleteRoomImageFile(imageUrl) {
  const filename = path.basename(imageUrl);
  if (DB_MODE === "bridge") {
    await deleteImageViaBridge(filename);
    return;
  }
  const filePath = path.join(ROOM_IMAGES_DIR, filename);
  fs.unlink(filePath, (unlinkErr) => {
    if (unlinkErr) {
      console.error("Cleanup room image warning:", unlinkErr.message);
    }
  });
}

// -------------------------------------------------------------
// validateBorrowWindow({ borrowWindowDays, borrowWindowStart, borrowWindowEnd })
// -> { ok: true, value: { borrow_window_days, borrow_window_start, borrow_window_end } }
//    | { ok: false, message }
//
// กติกา (สอดคล้องกับ schema.sql):
//   - borrowWindowDays: ไม่ส่งมา = ไม่แตะฟิลด์นี้เลย, null = ไม่จำกัดวัน
//     (เคลียร์ค่าเดิม), array = ต้องเป็นเลข 0-6 ทุกตัว (0=อาทิตย์..6=เสาร์)
//   - borrowWindowStart / borrowWindowEnd: ไม่ส่งมา = ไม่แตะฟิลด์นี้,
//     null = เคลียร์ค่าเดิม, string = ต้องเป็นรูปแบบเวลา HH:MM หรือ
//     HH:MM:SS เท่านั้น (ปล่อยให้ Postgres ตรวจละเอียดกว่านี้เอง)
//   - ถ้าจะตั้งช่วงเวลา (ไม่ใช่ null) ต้องส่งมาทั้งคู่พร้อมกัน จะตั้งแค่
//     start หรือ end อย่างเดียวไม่ได้ (ไม่มีความหมาย ทำให้ query
//     เปรียบเทียบเวลาในฝั่ง tap.js สับสน)
//   - ไม่ได้บังคับ start < end ที่นี่ — รองรับกรณีช่วงข้ามเที่ยงคืนได้
//     (เช่น 22:00 - 06:00) ปล่อยให้ tap.js เป็นคนตีความตอนเช็คจริง
//
// [MySQL] ไม่แก้ฟังก์ชันนี้เลย — ยังคืน borrow_window_days เป็น JS
// array ธรรมดา (จะไป JSON.stringify ตอน insert/update ในโค้ด route
// ด้านล่างแทน เพราะ mysql2 ไม่ serialize object/array ให้อัตโนมัติเป็น
// JSON column เหมือนที่ supabase-js เคยทำให้กับ smallint[])
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
      // ตัดตัวซ้ำ + เรียงลำดับ กันข้อมูลรกใน DB โดยไม่กระทบความหมาย
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

// -------------------------------------------------------------
// buildRoomUpdateSetClause(payload) -> { setSql, params }
// ช่วยประกอบ SET clause + params จาก object แบบ dynamic (เฉพาะ key ที่
// ส่งมา) ใช้ร่วมกันทั้ง POST (ผ่าน INSERT ปกติ ไม่ใช้ฟังก์ชันนี้) และ
// PATCH — borrow_window_days ต้อง JSON.stringify ก่อนเก็บลง JSON column
// เสมอ เพราะ mysql2 ไม่ serialize array ให้อัตโนมัติ
// -------------------------------------------------------------
function serializeRoomPayload(payload) {
  const out = { ...payload };
  if ("borrow_window_days" in out) {
    out.borrow_window_days =
      out.borrow_window_days === null ? null : JSON.stringify(out.borrow_window_days);
  }
  return out;
}

// -------------------------------------------------------------
// GET /api/admin/rooms
// ดึงรายการห้อง/กุญแจทั้งหมด เรียงตามชื่อห้อง
// -------------------------------------------------------------
router.get("/rooms", async (req, res) => {
  try {
    const [rows] = await query(
      `SELECT * FROM room_tags ORDER BY room_name ASC`
    );

    return res.json({ ok: true, rooms: rows });
  } catch (err) {
    console.error("Admin list rooms error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "ดึงรายการห้อง/กุญแจไม่สำเร็จ",
    });
  }
});

// -------------------------------------------------------------
// POST /api/admin/rooms
// body: { roomName, tagUid (ไม่บังคับ), description (ไม่บังคับ),
//         borrowWindowDays (ไม่บังคับ), borrowWindowStart (ไม่บังคับ),
//         borrowWindowEnd (ไม่บังคับ) }
// สร้างห้อง/กุญแจใหม่ — tagUid เว้นว่างได้ เผื่อยังไม่มีแท็กจริงมาผูก
// ช่วงเวลาที่อนุญาตยืมเว้นว่างได้เช่นกัน (= ไม่จำกัด) ดู
// validateBorrowWindow() ด้านบนสำหรับกติกาการรับค่า
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
    // ถ้ามีการกรอก tagUid มา เช็คซ้ำก่อน (เพราะ unique constraint จะ error
    // แบบไม่ friendly ถ้าไม่เช็คเอง)
    if (tagUid && tagUid.trim()) {
      const [existingRows] = await query(
        `SELECT id FROM room_tags WHERE tag_uid = ? LIMIT 1`,
        [tagUid.trim()]
      );

      if (existingRows.length > 0) {
        return res.status(409).json({
          ok: false,
          message: "เลขแท็กนี้ถูกผูกกับห้อง/กุญแจอื่นไปแล้ว",
        });
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
      `SELECT * FROM room_tags WHERE id = ?`,
      [insertResult.insertId]
    );

    return res.json({ ok: true, room: createdRows[0] });
  } catch (err) {
    console.error("Admin create room error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "สร้างห้อง/กุญแจไม่สำเร็จ",
    });
  }
});

// -------------------------------------------------------------
// PATCH /api/admin/rooms/:id
// body: { roomName, tagUid, description, isActive, borrowWindowDays,
//         borrowWindowStart, borrowWindowEnd } — ส่งเฉพาะฟิลด์ที่จะแก้ก็ได้
// ใช้แก้ข้อมูลห้อง หรือผูก/เปลี่ยนเลขแท็กจริงทีหลังได้จากจุดนี้ ส่ง
// borrowWindowDays/Start/End เป็น null เพื่อล้างข้อจำกัดกลับเป็น "ยืมได้
// ทุกวันทุกเวลา" ดู validateBorrowWindow() ด้านบนสำหรับกติกาการรับค่า
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
        return res.status(409).json({
          ok: false,
          message: "เลขแท็กนี้ถูกผูกกับห้อง/กุญแจอื่นไปแล้ว",
        });
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

    const [updatedRows] = await query(`SELECT * FROM room_tags WHERE id = ?`, [id]);

    return res.json({ ok: true, room: updatedRows[0] });
  } catch (err) {
    console.error("Admin update room error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "แก้ไขห้อง/กุญแจไม่สำเร็จ",
    });
  }
});

// -------------------------------------------------------------
// POST /api/admin/rooms/:id/image
// multipart/form-data field name: "image"
// อัปโหลดรูปห้องเป็นไฟล์ลงดิสก์ (public/uploads/room-images/) แล้ว
// บันทึก path สัมพัทธ์กลับเข้า room_tags.image_url ของห้องนั้น
//
// ตั้งชื่อไฟล์แบบ room-<id>-<timestamp>.<ext> กันชื่อไฟล์ชนกันเวลา
// อัปโหลดซ้ำ/แก้ไขรูปทีหลัง (multer diskStorage เขียนไฟล์นี้ให้เสร็จ
// แล้วก่อนเข้า handler ด้วยซ้ำ — ดู filename callback ด้านบน)
// -------------------------------------------------------------
router.post("/rooms/:id/image", upload.single("image"), async (req, res) => {
  const { id } = req.params;

  if (!req.file) {
    return res.status(400).json({ ok: false, message: "กรุณาเลือกไฟล์รูปภาพ" });
  }

  // [Fix] โหมด bridge: multer memoryStorage ไม่เขียนไฟล์ลงดิสก์ของ
  // Render เลย (ต่างจาก local ที่ diskStorage เขียนไปแล้วก่อนถึงจุดนี้)
  // จึงไม่มีอะไรต้อง fs.unlink cleanup ถ้า id ผิด/ล้มเหลวก่อนส่งไป
  // bridge — cleanup เฉพาะไฟล์ที่ "ส่งไป bridge สำเร็จแล้ว" เท่านั้น
  // (ดู catch ท้ายฟังก์ชัน)
  const filename =
    DB_MODE === "bridge" ? buildRoomImageFilename(id, req.file.originalname, false) : req.file.filename;

  let forwardedToBridge = false;

  try {
    // เช็คก่อนว่าห้องนี้มีจริง กัน orphan ไฟล์บนดิสก์ถ้า id ผิด
    const [roomRows] = await query(
      `SELECT id, image_url FROM room_tags WHERE id = ? LIMIT 1`,
      [id]
    );

    if (roomRows.length === 0) {
      // id ผิด — โหมด local: multer เขียนไฟล์ลงดิสก์ไปแล้วก่อนถึงจุดนี้
      // ลบไฟล์กำพร้าทิ้งแบบ best-effort (โหมด bridge ยังไม่ได้ forward
      // ไปที่ไหนเลย ไม่มีอะไรต้องลบ)
      if (DB_MODE === "local") {
        fs.unlink(req.file.path, (unlinkErr) => {
          if (unlinkErr) {
            console.error("Cleanup orphaned room image warning:", unlinkErr.message);
          }
        });
      }
      return res.status(404).json({ ok: false, message: "ไม่พบห้อง/กุญแจนี้" });
    }

    const room = roomRows[0];

    // โหมด bridge: forward ไฟล์ไปให้ bridge-server.js เขียนลงดิสก์บน
    // เครื่อง local ก่อน ถ้าล้มเหลว throw ออกไปให้ catch ด้านล่างจัดการ
    // (ยังไม่ได้แตะ DB เลยตอนนี้ ไม่ต้อง rollback อะไร)
    if (DB_MODE === "bridge") {
      await forwardImageToBridge(req.file, filename);
      forwardedToBridge = true;
    }

    const imageUrl = `/uploads/room-images/${filename}`;

    const [updateResult] = await query(
      `UPDATE room_tags SET image_url = ? WHERE id = ?`,
      [imageUrl, id]
    );

    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ ok: false, message: "ไม่พบห้อง/กุญแจนี้" });
    }

    const [updatedRows] = await query(`SELECT * FROM room_tags WHERE id = ?`, [id]);

    // ลบรูปเก่าทิ้งถ้ามี (best-effort — ไม่ throw ถ้าลบไม่สำเร็จ เพราะ
    // รูปใหม่บันทึกสำเร็จไปแล้ว ไม่อยากให้ request ทั้งเส้นล้มเพราะเรื่องนี้)
    // [MySQL] image_url ตอนนี้เป็น path สัมพัทธ์ (/uploads/room-images/xxx)
    // แทน public URL เต็มของ Supabase — deleteRoomImageFile() จัดการ
    // ทั้งสองโหมด (local: fs.unlink ตรงๆ, bridge: สั่งผ่าน bridge)
    if (room.image_url) {
      deleteRoomImageFile(room.image_url);
    }

    return res.json({ ok: true, room: updatedRows[0] });
  } catch (err) {
    console.error("Admin upload room image error:", err.message);
    // โหมด bridge + forward สำเร็จไปแล้วแต่ล้มเหลวหลังจากนั้น (เช่น
    // update DB ไม่ผ่าน) — ลบไฟล์ที่เพิ่ง forward ไปทิ้งกัน orphan บน
    // เครื่อง local (best-effort เหมือน cleanup อื่นๆ ในไฟล์นี้)
    if (DB_MODE === "bridge" && forwardedToBridge) {
      deleteImageViaBridge(filename);
    } else if (DB_MODE === "local" && req.file) {
      fs.unlink(req.file.path, (unlinkErr) => {
        if (unlinkErr) {
          console.error("Cleanup orphaned room image warning:", unlinkErr.message);
        }
      });
    }
    return res.status(500).json({
      ok: false,
      message: "อัปโหลดรูปภาพไม่สำเร็จ",
    });
  }
});

// -------------------------------------------------------------
// POST /api/admin/rooms/:id/images
// multipart/form-data field name: "images" (รับได้หลายไฟล์พร้อมกัน)
// เขียนไฟล์ลงดิสก์เดียวกับ endpoint เดี่ยวเดิม (ROOM_IMAGES_DIR) แล้ว
// บันทึกแต่ละไฟล์เป็น 1 แถวใน room_images (ตาราง multi-image ใหม่จาก
// Task 1) แทนที่จะทับ room_tags.image_url เดี่ยวเหมือน endpoint เก่า —
// endpoint เก่ายังอยู่เพื่อ backward compat (ดู MANIFEST Task 2b note)
//
// sort_order: ต่อจากรูปที่มากสุดที่มีอยู่แล้วของห้องนั้น (ไม่ใช่เริ่ม
// จาก 0 ใหม่ทุกครั้ง) เพื่อให้รูปที่อัปโหลดใหม่ต่อท้ายลำดับเดิมเสมอ
// จำกัดสูงสุด 10 ไฟล์ต่อ request กันแอดมินลากไฟล์เยอะเกินไปพร้อมกัน
//
// [MySQL] multer diskStorage เขียนทุกไฟล์ลงดิสก์เสร็จเรียบร้อยแล้ว
// ก่อนเข้า handler (ต่างจากเดิมที่ต้อง loop upload buffer ทีละไฟล์ขึ้น
// Supabase Storage เอง) handler จึงเหลือแค่ query sort_order สูงสุด +
// insert หลายแถวพร้อมกัน — ห่อด้วย transaction จริงตามข้อ 9 ของ
// MANIFEST (ถ้า insert ลง DB ล้มเหลว ต้อง rollback + ลบไฟล์ที่เขียนไป
// แล้วทั้งหมดทิ้งเหมือนของเดิม)
// -------------------------------------------------------------
const MAX_IMAGES_PER_UPLOAD = 10;

router.post("/rooms/:id/images", upload.array("images", MAX_IMAGES_PER_UPLOAD), async (req, res) => {
  const { id } = req.params;

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ ok: false, message: "กรุณาเลือกไฟล์รูปภาพอย่างน้อย 1 ไฟล์" });
  }

  // [Fix] โหมด bridge: คำนวณชื่อไฟล์ล่วงหน้าให้แต่ละไฟล์ (multer
  // memoryStorage ไม่ตั้งชื่อ/เขียนไฟล์ให้เอง) แล้ว track ว่า forward
  // ไป bridge สำเร็จแล้วกี่ไฟล์ เผื่อต้อง cleanup ทีหลัง — โหมด local
  // ยังใช้ req.files[].path ที่ diskStorage เขียนไปแล้วเหมือนเดิม
  const bridgeFilenames =
    DB_MODE === "bridge"
      ? req.files.map((file) => buildRoomImageFilename(id, file.originalname, true))
      : null;
  const forwardedFilenames = [];

  const cleanupUploadedFiles = () => {
    if (DB_MODE === "bridge") {
      for (const filename of forwardedFilenames) {
        deleteImageViaBridge(filename);
      }
      return;
    }
    for (const file of req.files) {
      fs.unlink(file.path, (unlinkErr) => {
        if (unlinkErr) {
          console.error("Cleanup orphaned room images warning:", unlinkErr.message);
        }
      });
    }
  };

  try {
    // เช็คก่อนว่าห้องนี้มีจริง กัน orphan ไฟล์บนดิสก์ถ้า id ผิด
    const [roomRows] = await query(
      `SELECT id FROM room_tags WHERE id = ? LIMIT 1`,
      [id]
    );

    if (roomRows.length === 0) {
      cleanupUploadedFiles();
      return res.status(404).json({ ok: false, message: "ไม่พบห้อง/กุญแจนี้" });
    }

    // โหมด bridge: forward ทุกไฟล์ไปให้ bridge-server.js เขียนลงดิสก์
    // บนเครื่อง local ทีละไฟล์ (bridge รองรับทีละไฟล์เท่านั้น ดู
    // คอมเมนต์หัวไฟล์ bridge-server.js) ก่อนแตะ DB เลย — ถ้าไฟล์ใดไฟล์
    // หนึ่ง forward ไม่สำเร็จ ลบไฟล์ที่ forward ไปแล้วก่อนหน้าทิ้งทั้งหมด
    // แล้ว throw ออกไปให้ catch ด้านล่างตอบ error (ยังไม่แตะ DB เลย
    // ตอนนี้ ไม่ต้อง rollback อะไรฝั่ง DB)
    if (DB_MODE === "bridge") {
      for (let i = 0; i < req.files.length; i += 1) {
        await forwardImageToBridge(req.files[i], bridgeFilenames[i]);
        forwardedFilenames.push(bridgeFilenames[i]);
      }
    }

    // หา sort_order สูงสุดปัจจุบันของห้องนี้ เพื่อต่อท้ายลำดับเดิม
    const [maxRows] = await query(
      `SELECT sort_order FROM room_images WHERE room_tag_id = ? ORDER BY sort_order DESC LIMIT 1`,
      [id]
    );

    let nextSortOrder = maxRows.length > 0 ? maxRows[0].sort_order + 1 : 0;

    const insertedRows = req.files.map((file, index) => {
      const filename = DB_MODE === "bridge" ? bridgeFilenames[index] : file.filename;
      const row = {
        room_tag_id: id,
        image_url: `/uploads/room-images/${filename}`,
        sort_order: nextSortOrder,
      };
      nextSortOrder += 1;
      return row;
    });

    // [Fix] เดิมใช้ pool.getConnection() + beginTransaction/commit/
    // rollback/release ด้วยมือ — พังในโหมด DB_MODE=bridge เพราะไม่มี
    // raw pool ให้ขอ connection ตรงๆ เปลี่ยนมาใช้ withTransaction()
    // แทน ซึ่งจัดการ begin/commit/rollback/release ให้อัตโนมัติ และ
    // ทำงานได้ทั้งสองโหมด (local ใช้ mysql2 connection จริง, bridge
    // ใช้ fake connection ที่ยิง HTTP ไปหา bridge-server.js — หน้าตา
    // การเรียกใช้เหมือนกันทุกจุดตามที่ config/db.js ออกแบบไว้)
    //
    // [MySQL] insert หลายแถวพร้อมกันด้วยคำสั่งเดียว (multi-row INSERT)
    // ถ้าล้มเหลว withTransaction จะ rollback ให้เอง — cleanupUploadedFiles()
    // ยังต้องเรียกเองตรงนี้เพราะเป็นการลบไฟล์บนดิสก์ ไม่ใช่ส่วนของ DB
    // transaction (withTransaction ไม่รู้จักไฟล์บนดิสก์)
    let createdRows;
    try {
      createdRows = await withTransaction(async (conn) => {
        const values = insertedRows.map((row) => [row.room_tag_id, row.image_url, row.sort_order]);
        await conn.query(
          `INSERT INTO room_images (room_tag_id, image_url, sort_order) VALUES ?`,
          [values]
        );

        // ไม่ใช้ insertResult.insertId + index ไล่เลขเดา id แถวที่เพิ่ง
        // insert (สมมติว่า auto_increment ออกเลขต่อเนื่องเป๊ะ) เพราะแม้
        // ปกติ InnoDB จะทำแบบนั้นกับ bulk insert แถวเดียวติดกัน แต่เป็น
        // สมมติฐานที่พังได้เงียบๆ ถ้ามีปัจจัยอื่นแทรก — ดึงกลับด้วย
        // room_tag_id ตรงๆ แทน ปลอดภัยกว่าและยังอยู่ใน transaction เดียวกัน
        // (เผื่อห้องนี้มีรูปเก่าอยู่ก่อนแล้ว กรองด้วย image_url ที่เพิ่ง
        // insert ไปด้วย กันดึงรูปเก่าปนมา)
        const newImageUrls = insertedRows.map((row) => row.image_url);
        const [rows] = await conn.query(
          `SELECT * FROM room_images WHERE room_tag_id = ? AND image_url IN (?) ORDER BY sort_order ASC`,
          [id, newImageUrls]
        );
        return rows;
      });
    } catch (insertError) {
      // insert ลง DB ล้มเหลวหลังเขียนไฟล์ลงดิสก์สำเร็จไปแล้ว (withTransaction
      // rollback ฝั่ง DB ให้เรียบร้อยแล้วก่อน throw กลับมาที่นี่) — ลบไฟล์
      // ที่เพิ่งเขียนทั้งหมดทิ้ง (best-effort) กัน orphan ไฟล์ค้างบนดิสก์
      // โดยไม่มี record อ้างอิงเลย
      cleanupUploadedFiles();
      throw insertError;
    }

    return res.json({ ok: true, images: createdRows });
  } catch (err) {
    console.error("Admin add room images error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "อัปโหลดรูปภาพไม่สำเร็จ",
    });
  }
});

// -------------------------------------------------------------
// DELETE /api/admin/rooms/:id/images/:imageId
// ลบรูปภาพ 1 รูปออกจาก room_images (และไฟล์จริงบนดิสก์)
// ไม่แตะ sort_order ของรูปอื่นที่เหลือ — เว้นช่องว่างในลำดับไว้ได้ ฝั่ง
// แสดงผล (frontend) ใช้ ORDER BY sort_order เฉยๆ ไม่ต้องเลขต่อเนื่อง
// -------------------------------------------------------------
router.delete("/rooms/:id/images/:imageId", async (req, res) => {
  const { id, imageId } = req.params;

  try {
    const [imageRows] = await query(
      `SELECT id, image_url FROM room_images WHERE id = ? AND room_tag_id = ? LIMIT 1`,
      [imageId, id]
    );

    if (imageRows.length === 0) {
      return res.status(404).json({ ok: false, message: "ไม่พบรูปภาพนี้" });
    }

    const image = imageRows[0];

    await query(`DELETE FROM room_images WHERE id = ?`, [imageId]);

    // ลบไฟล์จริงออกจากดิสก์ด้วย (best-effort — record ใน DB ลบไปแล้ว
    // สำเร็จ ไม่อยากให้ request ทั้งเส้นล้มเพราะลบไฟล์บนดิสก์ไม่ผ่าน)
    // [Fix] deleteRoomImageFile() จัดการทั้งสองโหมด — local: fs.unlink
    // ตรงๆ, bridge: สั่ง bridge-server.js ลบไฟล์บนเครื่อง local แทน
    deleteRoomImageFile(image.image_url);

    return res.json({ ok: true });
  } catch (err) {
    console.error("Admin delete room image error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "ลบรูปภาพไม่สำเร็จ",
    });
  }
});

// -------------------------------------------------------------
// PATCH /api/admin/rooms/:id/images/reorder
// body: { order: [imageId, imageId, ...] }
// จัดลำดับรูปภาพใหม่ทั้งชุดของห้องนี้ — client ส่ง array ของ imageId
// เรียงตามลำดับที่ต้องการ (เช่นหลังลาก-วางในหน้าแอดมิน) แล้ว server
// เขียน sort_order ใหม่ทับตามตำแหน่งใน array (index 0 = sort_order 0)
//
// กติกา:
//   - ทุก imageId ใน order ต้องเป็นของห้องนี้ (room_tag_id = :id) เท่านั้น
//     ถ้ามี id ที่ไม่ใช่ของห้องนี้ปนมา -> 400 (กันแอดมินหน้าเว็บส่ง
//     id ผิดห้องมาสลับ sort_order ห้องอื่นโดยไม่ตั้งใจ)
//   - ต้องส่ง imageId ครบทุกรูปที่มีอยู่จริงของห้องนี้ ห้ามส่งมาไม่ครบ
//     หรือส่งซ้ำ — เพื่อไม่ให้ sort_order ของรูปที่ตกหล่นค้างเป็นค่าเดิม
//     แล้วชนกับรูปที่ reorder ใหม่ (เช่นสองรูปได้ sort_order เดียวกัน)
//   - ไม่ใช้ endpoint นี้เพิ่ม/ลบรูป — แก้ได้แค่ลำดับของรูปที่มีอยู่แล้ว
//     เท่านั้น (เพิ่ม/ลบใช้ POST /rooms/:id/images กับ DELETE
//     /rooms/:id/images/:imageId ตามเดิม)
// -------------------------------------------------------------
router.patch("/rooms/:id/images/reorder", async (req, res) => {
  const { id } = req.params;
  const { order } = req.body;

  if (!Array.isArray(order) || order.length === 0) {
    return res.status(400).json({ ok: false, message: "กรุณาส่ง order เป็น array ของ imageId" });
  }

  // กันส่ง imageId ซ้ำ (ถ้าซ้ำ จะมี 2 รูปได้ sort_order เดียวกันไม่ได้
  // ตามที่ตั้งใจ — ปฏิเสธไปตรงๆ ดีกว่าเงียบๆ แล้วผลลัพธ์งง)
  const uniqueOrder = new Set(order);
  if (uniqueOrder.size !== order.length) {
    return res.status(400).json({ ok: false, message: "order มี imageId ซ้ำกัน" });
  }

  try {
    // ดึงรูปทั้งหมดที่มีอยู่จริงของห้องนี้มาเทียบ — ต้องตรงกับ order เป๊ะ
    // ทั้งจำนวนและตัวตน (set เดียวกัน) ไม่งั้นถือว่า request ไม่ถูกต้อง
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

    // เขียน sort_order ใหม่ทีละแถวตามตำแหน่งใน array (ไม่ใช้ Promise.all
    // แบบขนาน — จำนวนรูปต่อห้องน้อยอยู่แล้ว (จำกัดตอนอัปโหลดครั้งละ
    // สูงสุด 10) ทำทีละแถวเรียงลำดับชัดเจนกว่า และเลี่ยงปัญหา connection
    // pool ถูกใช้พร้อมกันเยอะโดยไม่จำเป็น)
    const updatedRows = [];
    for (let index = 0; index < orderIds.length; index += 1) {
      await query(`UPDATE room_images SET sort_order = ? WHERE id = ?`, [
        index,
        orderIds[index],
      ]);

      const [rows] = await query(`SELECT * FROM room_images WHERE id = ?`, [orderIds[index]]);
      updatedRows.push(rows[0]);
    }

    updatedRows.sort((a, b) => a.sort_order - b.sort_order);

    return res.json({ ok: true, images: updatedRows });
  } catch (err) {
    console.error("Admin reorder room images error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "จัดลำดับรูปภาพไม่สำเร็จ",
    });
  }
});

// -------------------------------------------------------------
// DELETE /api/admin/rooms/:id
// ลบห้อง/กุญแจ — จะพ่วงลบ room_images และ key_logs ของห้องนี้ไปด้วย
// อัตโนมัติ (on delete cascade ตาม schema) — ไฟล์รูปบนดิสก์ของ
// room_images ที่ถูกลบไปพร้อมกันนี้ "ไม่ได้" ถูกลบตามไปด้วย (ของเดิมบน
// Supabase ก็ไม่ได้ลบไฟล์ออกจาก Storage ตอนลบห้องเช่นกัน เป็น known
// gap เดิมที่ carry over มา ไม่ใช่ regression ใหม่จากการย้ายฐานข้อมูล)
// -------------------------------------------------------------
router.delete("/rooms/:id", async (req, res) => {
  const { id } = req.params;

  try {
    await query(`DELETE FROM room_tags WHERE id = ?`, [id]);

    return res.json({ ok: true });
  } catch (err) {
    console.error("Admin delete room error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "ลบห้อง/กุญแจไม่สำเร็จ",
    });
  }
});

// -------------------------------------------------------------
// Multer error handler เฉพาะ router นี้ (ไฟล์เกิน 5MB, ไม่ใช่รูปภาพ ฯลฯ)
// ต้องอยู่ท้ายไฟล์ หลัง route ทั้งหมด ตาม convention ของ Express error
// middleware (รับ 4 argument)
// -------------------------------------------------------------
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message === "ไฟล์ต้องเป็นรูปภาพเท่านั้น") {
    return res.status(400).json({ ok: false, message: err.message });
  }
  next(err);
});

module.exports = router;