// routes/tap.js
// -----------------------------------------------------------------
// *** เปลี่ยนใหญ่ (พ.ย. 2026): ตัดระบบ "บัตรครู" ออกทั้งหมด ***
// ปีนี้โรงเรียนไม่มีบัตรประจำตัวครูแล้ว — ครูระบุตัวตนด้วยการ "พิมพ์
// รหัสประจำตัว" (teachers.teacher_code) แทนการแตะแท็ก RFID
//
// endpoint นี้ (POST /api/tap) ตอนนี้รับเฉพาะ "แท็กกุญแจห้อง" เท่านั้น
// (room_tags) — ไม่เช็ค teacher_tags อีกต่อไป เพราะตารางนั้นถูกลบไปแล้ว
// (ดู schema.sql) การเปิด session ครูย้ายไปที่ endpoint ใหม่:
//   POST /api/tap/teacher-code  (ดูด้านล่าง)
//
// Flow ใหม่:
//   1. ครูพิมพ์รหัสประจำตัว (ตัวเลขล้วน) ผ่านคีย์แพดบน display.html ->
//      POST /api/tap/teacher-code -> เปิด/ต่ออายุ session ผูกกับ
//      "เครื่องอ่านเครื่องนี้" (readerId) เก็บใน memory เหมือนเดิม
//   2. แตะแท็กกุญแจ (tag_uid ตรงกับ room_tags) ต่อได้เรื่อยๆ ภายใน
//      session เดียวกัน (ยืมได้หลายดอกต่อครั้ง) ผ่าน POST /api/tap:
//        - room_tags.status === 'available' -> ยืม (borrow)
//        - room_tags.status === 'borrowed' โดยครูคนเดียวกับ session -> คืน (return)
//        - room_tags.status === 'borrowed' โดยครูอื่น -> แจ้ง error ไม่ทำอะไร
//   3. session หมดอายุอัตโนมัติถ้าไม่มีการแตะกุญแจต่อภายใน TTL ที่ตั้งไว้
//      (พิมพ์รหัสใหม่เพื่อเริ่ม session ใหม่ได้เสมอ)
//
// ไม่ใส่ requireAuth ทั้งสอง endpoint เพราะจุดนี้ไม่ใช่ "ผู้ใช้ login"
// แต่เป็นอุปกรณ์ทางกายภาพที่ตั้งอยู่หน้างาน (ห้องทะเบียน เครื่องเดียว
// เปิดให้ครูทุกคนใช้งานร่วมกัน) — ความปลอดภัยอยู่ที่ตัวรหัสครู (ต้องรู้
// รหัสจริงถึงจะพิมพ์ถูก) ไม่ใช่ JWT
// -----------------------------------------------------------------

const express = require("express");
const router = express.Router();
const { query } = require("../config/db");
const { sendGroupMessage, buildBorrowedMessage } = require("../services/line_notify");

const SESSION_TTL_MS = 20 * 1000; // 20 วินาที นับจากการแตะล่าสุด (เปิด session หรือแตะกุญแจ)

// key: readerId (string) -> { teacherId, teacherName, expiresAt }
const activeSessions = new Map();

function getSession(readerId) {
  const session = activeSessions.get(readerId);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    activeSessions.delete(readerId);
    return null;
  }
  return session;
}

function setSession(readerId, teacherId, teacherName) {
  activeSessions.set(readerId, {
    teacherId,
    teacherName,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
}

function touchSession(readerId) {
  const session = activeSessions.get(readerId);
  if (session) {
    session.expiresAt = Date.now() + SESSION_TTL_MS;
  }
}

function clearSession(readerId) {
  activeSessions.delete(readerId);
}

// -------------------------------------------------------------
// isWithinBorrowWindow(roomTag) -> boolean
// เช็คว่า "ตอนนี้" (เวลาปัจจุบันของ server) อยู่ในช่วงที่อนุญาตให้ยืม
// กุญแจดอกนี้ไหม ตาม roomTag.borrow_window_days / _start / _end
//
// กติกา (ตรงกับ schema.sql):
//   - borrow_window_days: null/ว่าง = ไม่จำกัดวัน (ทุกวันผ่านเงื่อนไขนี้)
//     ไม่ null = ต้องมีเลขวันปัจจุบัน (0=อาทิตย์..6=เสาร์) อยู่ในอาร์เรย์
//   - borrow_window_start/_end: ต้องมาคู่กันเสมอ — null ทั้งคู่ = ไม่จำกัดเวลา
//   - รองรับช่วงข้ามเที่ยงคืน (เช่น 22:00–06:00): ถ้า start > end แปลว่า
//     ช่วงเวลาที่อนุญาต "ข้ามคืน" ไปวันถัดไป เช็คแบบ (now >= start ||
//     now <= end) แทนแบบปกติ (now >= start && now <= end)
//   - เฉพาะการ "ยืม" เท่านั้นที่ถูกเช็คนี้กัน — การ "คืน" ไม่ต้องเรียก
//     ฟังก์ชันนี้เลย (ดูจุดเรียกใช้ด้านล่าง)
// -------------------------------------------------------------
function isWithinBorrowWindow(roomTag) {
  // [TIMEZONE] เซิร์ฟเวอร์บน Render เป็น UTC — เลื่อนเวลาไป +7 ชม. แล้วอ่านด้วย
  // getUTC* เพื่อให้ได้ "วัน/เวลาปัจจุบันของไทย" ไม่ขึ้นกับ timezone เครื่อง
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000);

  // --- เช็ควัน ---
  const days = roomTag.borrow_window_days;
  if (Array.isArray(days) && days.length > 0) {
    const currentDay = now.getUTCDay(); // 0=อาทิตย์..6=เสาร์ ตรงกับ schema
    if (!days.includes(currentDay)) {
      return false;
    }
  }

  // --- เช็คเวลา ---
  const start = roomTag.borrow_window_start;
  const end = roomTag.borrow_window_end;

  if (!start || !end) {
    // ทั้งคู่ null (หรือฟิลด์ใดฟิลด์หนึ่งหายไปผิดปกติ) = ไม่จำกัดเวลา
    return true;
  }

  // เทียบแบบ string "HH:MM:SS" ตรงๆ ได้เลย — mysql2 กับ dateStrings:true
  // (ดู config/db.js) คืนค่า TIME column มาเป็น "HH:MM:SS" ตรงๆ อยู่แล้ว
  const pad2 = (n) => String(n).padStart(2, "0");
  const nowTimeStr = `${pad2(now.getUTCHours())}:${pad2(now.getUTCMinutes())}:${pad2(now.getUTCSeconds())}`;

  if (start <= end) {
    // ช่วงปกติภายในวันเดียว
    return nowTimeStr >= start && nowTimeStr <= end;
  }

  // ช่วงข้ามเที่ยงคืน (เช่น 22:00:00–06:00:00)
  return nowTimeStr >= start || nowTimeStr <= end;
}

// -------------------------------------------------------------
// parseRoomTagRow(row) -> roomTag shape เดิมที่ route ด้านล่างคาดหวัง
// รับแถวดิบจาก JOIN query (มี prefix borrowed_by_id / borrowed_by_name
// จาก LEFT JOIN teachers) มาแปลงเป็น:
//   { id, room_name, status, borrowed_by_teacher_id,
//     borrowed_by: { id, name } | null,
//     borrow_window_days: array | null,   // parse จาก JSON string
//     borrow_window_start, borrow_window_end }
// -------------------------------------------------------------
function parseRoomTagRow(row) {
  return {
    id: row.id,
    room_name: row.room_name,
    status: row.status,
    borrowed_by_teacher_id: row.borrowed_by_teacher_id,
    borrowed_by:
      row.borrowed_by_teacher_id != null
        ? { id: row.borrowed_by_id, name: row.borrowed_by_name }
        : null,
    borrow_window_days:
      row.borrow_window_days == null
        ? null
        : typeof row.borrow_window_days === "string"
        ? JSON.parse(row.borrow_window_days)
        : row.borrow_window_days, // เผื่อ driver บาง config parse JSON ให้อัตโนมัติแล้ว
    borrow_window_start: row.borrow_window_start,
    borrow_window_end: row.borrow_window_end,
  };
}

const ROOM_TAG_SELECT_SQL = `
  SELECT
    rt.id, rt.room_name, rt.status, rt.borrowed_by_teacher_id,
    rt.borrow_window_days, rt.borrow_window_start, rt.borrow_window_end,
    t.id AS borrowed_by_id, t.name AS borrowed_by_name
  FROM room_tags rt
  LEFT JOIN teachers t ON t.id = rt.borrowed_by_teacher_id
`;

// -------------------------------------------------------------
// POST /api/tap/teacher-code
// body: { teacherCode, readerId }
// ครูพิมพ์รหัสประจำตัว (ตัวเลขล้วน) ผ่านคีย์แพดบนจอ -> เปิด/ต่ออายุ
// session ยืม-คืน (แทนที่การ "แตะแท็กครู" แบบเดิม)
//
// เป็น synchronous call เดียวจบ — รู้ผลทันทีไม่ต้อง poll (ต่างจาก flow
// สมัครครูแบบเดิมที่ต้องรอแตะบัตรแยกต่างหาก)
// -------------------------------------------------------------
router.post("/tap/teacher-code", async (req, res) => {
  const { teacherCode, readerId } = req.body;
  const reader = readerId || "default";

  if (!teacherCode || !teacherCode.toString().trim()) {
    return res.status(400).json({ ok: false, message: "กรุณากรอกรหัสประจำตัวครู" });
  }

  const cleanCode = teacherCode.toString().trim();

  if (!/^[0-9]+$/.test(cleanCode)) {
    return res.status(400).json({ ok: false, message: "รหัสประจำตัวครูต้องเป็นตัวเลขเท่านั้น" });
  }

  try {
    const [teacherRows] = await query(
      `SELECT id, name FROM teachers WHERE teacher_code = ? LIMIT 1`,
      [cleanCode]
    );

    if (teacherRows.length === 0) {
      return res.status(404).json({
        ok: false,
        state: "unknown_code",
        message: "ไม่พบรหัสประจำตัวนี้ในระบบ กรุณาตรวจสอบรหัสอีกครั้ง หรือติดต่อแอดมิน",
      });
    }

    const teacher = teacherRows[0];

    // เปิด session ยืม-คืน (ทับ session เดิมถ้ามี)
    setSession(reader, teacher.id, teacher.name);

    return res.json({
      ok: true,
      state: "session_started",
      message: `สวัสดีคุณครู ${teacher.name} — แตะแท็กกุญแจที่ต้องการยืม/คืนได้เลย`,
      teacher: { id: teacher.id, name: teacher.name },
    });
  } catch (err) {
    console.error("Teacher-code tap error:", err.message);
    return res.status(500).json({ ok: false, message: "ตรวจสอบรหัสประจำตัวไม่สำเร็จ" });
  }
});

// -------------------------------------------------------------
// POST /api/tap
// body: { tagUid, readerId }
// รับเฉพาะ "แท็กกุญแจห้อง" เท่านั้น — ต้องมี session ครูที่เปิดไว้แล้ว
// ผ่าน POST /api/tap/teacher-code ก่อนเสมอ (ไม่มีแท็กครูอีกต่อไป)
//
// readerId: ตัวระบุเครื่องอ่าน (เผื่ออนาคตมีหลายเครื่อง) ถ้าไม่ส่งมา
// ใช้ "default" — พอสำหรับกรณีมีเครื่องอ่านเดียวที่ห้องทะเบียนตอนนี้
//
// response ทุกกรณีมี field "state" บอกสถานะปัจจุบันให้หน้าจอแสดงผล:
//   'borrowed' | 'returned' | 'wrong_teacher' | 'unknown_tag' |
//   'session_expired' | 'outside_window'
// -------------------------------------------------------------
router.post("/tap", async (req, res) => {
  const { tagUid, readerId } = req.body;
  const reader = readerId || "default";

  if (!tagUid || !tagUid.trim()) {
    return res.status(400).json({ ok: false, message: "ไม่พบเลขแท็กที่ส่งมา" });
  }

  const cleanTagUid = tagUid.trim();

  try {
    // --- เช็คว่าเป็นแท็กกุญแจที่รู้จักไหม ---
    const [roomTagRows] = await query(
      `${ROOM_TAG_SELECT_SQL} WHERE rt.tag_uid = ? LIMIT 1`,
      [cleanTagUid]
    );

    const roomTag = roomTagRows.length > 0 ? parseRoomTagRow(roomTagRows[0]) : null;

    if (!roomTag) {
      return res.status(404).json({
        ok: false,
        state: "unknown_tag",
        message: "ไม่พบแท็กกุญแจนี้ในระบบ",
      });
    }

    // --- ต้องมี session ครูที่ยัง active อยู่ก่อน (เปิดผ่านรหัสประจำตัว) ---
    const session = getSession(reader);

    if (!session) {
      return res.status(409).json({
        ok: false,
        state: "session_expired",
        message: "กรุณาพิมพ์รหัสประจำตัวครูก่อน แล้วค่อยแตะแท็กกุญแจ",
      });
    }

    touchSession(reader);

    // --- ตัดสินใจ borrow หรือ return ---
    if (roomTag.status === "available") {
      // ยืม — เช็คช่วงเวลาที่อนุญาตก่อนเสมอ (การคืนไม่ต้องเช็คนี้เลย —
      // "คืน" ต้องทำได้เสมอไม่ว่ากรณีใด กันครูค้างกุญแจเพราะติดช่วงห้ามยืม)
      if (!isWithinBorrowWindow(roomTag)) {
        return res.status(409).json({
          ok: false,
          state: "outside_window",
          message: `กุญแจ "${roomTag.room_name}" ยืมได้เฉพาะในช่วงเวลาที่กำหนดเท่านั้น กรุณาลองใหม่ในช่วงเวลาที่อนุญาต`,
          room: { id: roomTag.id, roomName: roomTag.room_name },
        });
      }

      // UPDATE ... WHERE ... แล้วเช็ค affectedRows === 0 (conditional
      // update กัน race) — ถ้า affectedRows > 0 ถึงจะถือว่ายืมสำเร็จ
      const [updateResult] = await query(
        `UPDATE room_tags
         SET status = 'borrowed', borrowed_by_teacher_id = ?, borrowed_at = NOW()
         WHERE id = ? AND status = 'available'`,
        [session.teacherId, roomTag.id]
      );

      if (updateResult.affectedRows === 0) {
        // มีคนแตะแซงไปก่อนแล้ว (เช็คแล้วตอน SELECT ด้านบนว่า available
        // แต่พอจะ UPDATE จริงมีคนอื่นเปลี่ยนสถานะไปก่อนพอดี)
        return res.status(409).json({
          ok: false,
          state: "wrong_teacher",
          message: "กุญแจนี้เพิ่งถูกยืมไปพอดี กรุณาลองใหม่อีกครั้ง",
        });
      }

      await query(
        `INSERT INTO key_logs (room_tag_id, teacher_id, action) VALUES (?, ?, 'borrow')`,
        [roomTag.id, session.teacherId]
      );

      // -----------------------------------------------------------
      // [LINE notify] แจ้งเตือนเข้ากลุ่มทันทีตอนยืมสำเร็จ — เรียกแบบ
      // "fire-and-forget" (ไม่ await ใน critical path, .catch กันเงียบๆ)
      // เพื่อไม่ให้ /api/tap ตอบช้าหรือ error ไปด้วยแค่เพราะ LINE ส่งไม่
      // ผ่าน (เช่น เน็ตหลุด, โควต้าหมด) — ธุรกรรมยืมกุญแจถือว่าสำเร็จ
      // แล้วตั้งแต่ก่อนบรรทัดนี้ ไม่เกี่ยวกับผลของการแจ้งเตือน
      // -----------------------------------------------------------
      const nowStr = new Date().toLocaleTimeString("th-TH", {
        timeZone: "Asia/Bangkok",
        hour: "2-digit",
        minute: "2-digit",
      });
      sendGroupMessage(
        buildBorrowedMessage({
          teacherName: session.teacherName,
          roomName: roomTag.room_name,
          time: nowStr,
        })
      ).catch((err) =>
        console.error("tap.js: sendGroupMessage (borrowed) ล้มเหลว:", err.message)
      );

      return res.json({
        ok: true,
        state: "borrowed",
        message: `ยืมกุญแจ "${roomTag.room_name}" สำเร็จ — คุณครู ${session.teacherName}`,
        room: { id: roomTag.id, roomName: roomTag.room_name },
        teacher: { id: session.teacherId, name: session.teacherName },
      });
    }

    // status === 'borrowed' ตอนนี้
    if (roomTag.borrowed_by_teacher_id === session.teacherId) {
      // คืน (ครูคนเดิมที่ยืมไปแตะซ้ำ)
      // conditional update กัน race เหมือนจุดยืมด้านบน แต่เช็คเงื่อนไข
      // เพิ่มอีกชั้น (status = 'borrowed' AND borrowed_by_teacher_id = ?)
      const [updateResult] = await query(
        `UPDATE room_tags
         SET status = 'available', borrowed_by_teacher_id = NULL, borrowed_at = NULL
         WHERE id = ? AND status = 'borrowed' AND borrowed_by_teacher_id = ?`,
        [roomTag.id, session.teacherId]
      );

      if (updateResult.affectedRows === 0) {
        return res.status(409).json({
          ok: false,
          state: "wrong_teacher",
          message: "มีความเปลี่ยนแปลงสถานะกุญแจนี้ระหว่างที่กำลังดำเนินการ กรุณาลองใหม่อีกครั้ง",
        });
      }

      await query(
        `INSERT INTO key_logs (room_tag_id, teacher_id, action) VALUES (?, ?, 'return')`,
        [roomTag.id, session.teacherId]
      );

      return res.json({
        ok: true,
        state: "returned",
        message: `คืนกุญแจ "${roomTag.room_name}" สำเร็จ — คุณครู ${session.teacherName}`,
        room: { id: roomTag.id, roomName: roomTag.room_name },
        teacher: { id: session.teacherId, name: session.teacherName },
      });
    }

    // ถูกยืมอยู่โดยครูคนอื่น
    const holderName = roomTag.borrowed_by ? roomTag.borrowed_by.name : "ไม่ทราบชื่อ";
    return res.status(409).json({
      ok: false,
      state: "wrong_teacher",
      message: `กุญแจ "${roomTag.room_name}" ถูกยืมอยู่โดยคุณครู ${holderName} — คืนได้เฉพาะครูท่านที่ยืมไปเท่านั้น`,
    });
  } catch (err) {
    console.error("Tap error:", err.message);
    return res.status(500).json({ ok: false, message: "ประมวลผลการแตะแท็กไม่สำเร็จ" });
  }
});

// -------------------------------------------------------------
// GET /api/tap/session?readerId=xxx
// ให้หน้าจอ poll เช็คได้ว่า session ครูตอนนี้ (ถ้ามี) ยังค้างอยู่ไหม
// ใช้แสดงผล เช่น "คุณครู ทักษิณ กำลังยืม/คืน — แตะแท็กกุญแจได้เลย"
// -------------------------------------------------------------
router.get("/tap/session", (req, res) => {
  const reader = (req.query.readerId || "default").toString();
  const session = getSession(reader);

  if (!session) {
    return res.json({ ok: true, active: false });
  }

  return res.json({
    ok: true,
    active: true,
    teacher: { id: session.teacherId, name: session.teacherName },
    expiresInMs: session.expiresAt - Date.now(),
  });
});

// -------------------------------------------------------------
// POST /api/tap/session/clear
// body: { readerId } — ปิด session ทันที (เช่น ปุ่ม "เสร็จสิ้น" บนหน้าจอ
// ให้ครูกดจบเองก่อนหมดเวลา TTL)
// -------------------------------------------------------------
router.post("/tap/session/clear", (req, res) => {
  const reader = (req.body.readerId || "default").toString();
  clearSession(reader);
  return res.json({ ok: true });
});

module.exports = router;