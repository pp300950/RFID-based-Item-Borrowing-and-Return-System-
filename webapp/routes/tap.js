// routes/tap.js
// -----------------------------------------------------------------
// หัวใจของระบบใหม่: endpoint เดียวรับทุกการ "แตะแท็ก" จากเครื่องอ่านที่
// ห้องทะเบียน (ดู rfid_reader flow: เครื่องอ่านพิมพ์เลขบัตรเข้า input
// ที่โฟกัสค้างไว้บนหน้าเว็บ -> หน้าเว็บยิง POST มาที่นี่ทุกครั้งที่มี
// ค่าใหม่เข้ามา)
//
// ไม่ใส่ requireAuth เพราะจุดนี้ไม่ใช่ "ผู้ใช้ login" แต่เป็นอุปกรณ์ทาง
// กายภาพที่ตั้งอยู่หน้างาน (ห้องทะเบียน) — ความปลอดภัยอยู่ที่ตัวแท็ก
// ประจำตัวครูเอง (ต้องมีบัตรจริงถึงจะแตะได้) ไม่ใช่ JWT
//
// Flow:
//   1. แตะแท็กครู (tag_uid ตรงกับ teacher_tags) -> เปิด/ต่ออายุ session
//      ชั่วคราวผูกกับ "เครื่องอ่านเครื่องนี้" (readerId) เก็บใน memory
//      พอ เพราะอายุสั้น ไม่ต้องมี table
//   2. แตะแท็กกุญแจ (tag_uid ตรงกับ room_tags) ต่อได้เรื่อยๆ ภายใน
//      session เดียวกัน (ยืมได้หลายดอกต่อครั้ง):
//        - room_tags.status === 'available' -> ยืม (borrow)
//        - room_tags.status === 'borrowed' โดยครูคนเดียวกับ session -> คืน (return)
//        - room_tags.status === 'borrowed' โดยครูอื่น -> แจ้ง error ไม่ทำอะไร
//   3. session หมดอายุอัตโนมัติถ้าไม่มีการแตะกุญแจต่อภายใน TTL ที่ตั้งไว้
//      (แตะแท็กครูใหม่เพื่อเริ่ม session ใหม่ได้เสมอ)
//
// [MySQL migration] จุดที่เปลี่ยนหลักๆ ในไฟล์นี้ (ดู MANIFEST ข้อ 1-3, 9):
//   - teacher_tags -> teachers embed (Supabase nested select) เขียนเป็น
//     LEFT JOIN ธรรมดา แล้ว map กลับเป็น shape { teacher_id, teachers: {id, name} }
//   - room_tags -> borrowed_by:borrowed_by_teacher_id(...) embed เขียนเป็น
//     LEFT JOIN กับ teachers อีกตัว แล้ว map กลับเป็น
//     { ...room, borrowed_by: {id, name} | null } เหมือนเดิมทุกจุด
//   - borrow_window_days เป็น JSON column แล้ว (ไม่ใช่ Postgres smallint[])
//     ต้อง JSON.parse ก่อนส่งเข้า isWithinBorrowWindow() เพราะ mysql2 คืน
//     JSON column มาเป็น string ดิบ ไม่ auto-parse ให้เหมือน supabase-js
//   - .eq(...).eq(...).select().maybeSingle() (conditional update กัน
//     race) เขียนเป็น UPDATE ... WHERE ... แล้วเช็ค result.affectedRows
//     === 0 แทนการเช็ค null, แล้ว SELECT แถวใหม่อีกทีหลัง update สำเร็จ
//     (mysql2 ไม่มี .select() ในตัวเหมือน Supabase)
//   - แตะแท็กครูใหม่ (auto-register): insert teachers + insert
//     teacher_tags สองคำสั่งแยกกัน ห่อด้วย withTransaction() จริงตาม
//     ข้อ 9 ของ MANIFEST (ของเดิมบน Supabase ไม่มี transaction จริงตรงนี้)
// -----------------------------------------------------------------

const express = require("express");
const router = express.Router();
const { query, withTransaction } = require("../config/db");
const {
  getPendingRegistration,
  resolveRegistration,
} = require("./register_session");
const { sendGroupMessage, buildBorrowedMessage } = require("../services/line_notify");

const SESSION_TTL_MS = 20 * 1000; // 20 วินาที นับจากการแตะล่าสุด (ครูหรือกุญแจ)

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
// กติกา (ตรงกับ schema.sql + Task 2a):
//   - borrow_window_days: null/ว่าง = ไม่จำกัดวัน (ทุกวันผ่านเงื่อนไขนี้)
//     ไม่ null = ต้องมีเลขวันปัจจุบัน (0=อาทิตย์..6=เสาร์) อยู่ในอาร์เรย์
//   - borrow_window_start/_end: ต้องมาคู่กันเสมอ (การันตีจาก Task 2a
//     validateBorrowWindow) — null ทั้งคู่ = ไม่จำกัดเวลา
//   - รองรับช่วงข้ามเที่ยงคืน (เช่น 22:00–06:00): ถ้า start > end แปลว่า
//     ช่วงเวลาที่อนุญาต "ข้ามคืน" ไปวันถัดไป เช็คแบบ (now >= start ||
//     now <= end) แทนแบบปกติ (now >= start && now <= end)
//   - เฉพาะการ "ยืม" เท่านั้นที่ถูกเช็คนี้กัน — การ "คืน" ไม่ต้องเรียก
//     ฟังก์ชันนี้เลย (ดูจุดเรียกใช้ด้านล่าง)
//
// [MySQL] ฟังก์ชันนี้ไม่แก้ logic เลย ยังรับ roomTag.borrow_window_days
// เป็น JS array/null เหมือนเดิม — การแปลงจาก JSON string ของ MySQL เป็น
// array ทำที่จุดโหลด roomTag ก่อนเรียกฟังก์ชันนี้ (ดู parseRoomTagRow)
// เพื่อให้ฟังก์ชันนี้ไม่ต้องรู้เรื่อง MySQL เลย
// -------------------------------------------------------------
function isWithinBorrowWindow(roomTag) {
  const now = new Date();

  // --- เช็ควัน ---
  const days = roomTag.borrow_window_days;
  if (Array.isArray(days) && days.length > 0) {
    const currentDay = now.getDay(); // 0=อาทิตย์..6=เสาร์ ตรงกับ schema
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
  // เหมือนที่ postgres time type เคยถูก serialize มาผ่าน supabase-js
  const pad2 = (n) => String(n).padStart(2, "0");
  const nowTimeStr = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;

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
//
// [MySQL] แทนที่ Supabase nested select
// "borrowed_by:borrowed_by_teacher_id(id, name)" — ดู MANIFEST ข้อ 3
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
// POST /api/tap
// body: { tagUid, readerId }
// readerId: ตัวระบุเครื่องอ่าน (เผื่ออนาคตมีหลายเครื่อง) ถ้าไม่ส่งมา
// ใช้ "default" — พอสำหรับกรณีมีเครื่องอ่านเดียวที่ห้องทะเบียนตอนนี้
//
// response ทุกกรณีมี field "state" บอกสถานะปัจจุบันให้หน้าจอแสดงผล:
//   'session_started' | 'borrowed' | 'returned' | 'wrong_teacher' |
//   'unknown_tag' | 'session_expired' | 'outside_window'
//   ('outside_window' เพิ่มใหม่ — Task 6: ยืมถูกบล็อกเพราะอยู่นอกช่วง
//   เวลาที่อนุญาต ดู isWithinBorrowWindow ด้านล่าง — ใช้กับ "ยืม" เท่านั้น
//   "คืน" ไม่มี state นี้เกิดขึ้นได้เลยเพราะไม่ถูกเช็คช่วงเวลา)
// -------------------------------------------------------------
router.post("/tap", async (req, res) => {
  const { tagUid, readerId } = req.body;
  const reader = readerId || "default";

  if (!tagUid || !tagUid.trim()) {
    return res.status(400).json({ ok: false, message: "ไม่พบเลขแท็กที่ส่งมา" });
  }

  const cleanTagUid = tagUid.trim();

  try {
    // -----------------------------------------------------------
    // เช็คก่อนว่าแท็กนี้เป็นแท็กครูหรือแท็กกุญแจ (สอง table แยกกัน
    // เพราะเลขแท็กแต่ละประเภทไม่ชนกันอยู่แล้วโดย unique constraint
    // ของแต่ละ table เอง)
    //
    // [MySQL] teacher_tags(...).select("teacher_id, teachers(id, name)")
    // -> LEFT JOIN teachers ธรรมดา (ดู MANIFEST ข้อ 3)
    // -----------------------------------------------------------
    const [teacherTagRows] = await query(
      `SELECT tt.teacher_id, t.id AS teacher_id_full, t.name AS teacher_name
       FROM teacher_tags tt
       JOIN teachers t ON t.id = tt.teacher_id
       WHERE tt.tag_uid = ?
       LIMIT 1`,
      [cleanTagUid]
    );

    const teacherTag = teacherTagRows.length > 0 ? teacherTagRows[0] : null;

    // --- กรณี 1: แตะแท็กครู ---
    if (teacherTag) {
      const teacher = { id: teacherTag.teacher_id_full, name: teacherTag.teacher_name };

      // ถ้า readerId นี้กำลังอยู่ในโหมดรอสมัครครูคนใหม่พอดี แปลว่าคนที่
      // กำลังสมัครแตะบัตรใบที่ "มีคนใช้อยู่แล้ว" เข้ามา (บัตรประจำตัว
      // ครูที่โรงเรียนออกให้ ไม่ใช่แท็กแบนพวงกุญแจแบบเดิม ผูกได้แค่ครู
      // เดียวเสมอ) ต้องแจ้ง error ให้ชัดว่าบัตรนี้ผูกกับครูคนอื่นไปแล้ว
      // ไม่ใช่ไปเปิด session ยืม-คืนแทนให้เงียบๆ
      const pendingDuringTeacherTap = getPendingRegistration(reader);
      if (pendingDuringTeacherTap) {
        resolveRegistration(reader, {
          ok: false,
          message: `บัตรใบนี้ถูกใช้เป็นบัตรประจำตัวของคุณครู ${teacher.name} อยู่แล้ว กรุณาใช้บัตรใบอื่น หรือติดต่อแอดมินหากบัตรนี้ควรเป็นของคุณ`,
        });
        return res.status(409).json({
          ok: false,
          state: "tag_already_bound",
          message: `บัตรใบนี้ถูกใช้เป็นบัตรประจำตัวของคุณครู ${teacher.name} อยู่แล้ว`,
        });
      }

      // ไม่ได้อยู่ในโหมดสมัคร -> เป็นการแตะปกติ เปิด session ยืม-คืน (ทับ session เดิมถ้ามี)
      setSession(reader, teacher.id, teacher.name);

      return res.json({
        ok: true,
        state: "session_started",
        message: `สวัสดีคุณครู ${teacher.name} — แตะแท็กกุญแจที่ต้องการยืม/คืนได้เลย`,
        teacher: { id: teacher.id, name: teacher.name },
      });
    }

    // --- ไม่ใช่แท็กครู -> เช็คว่าเป็นแท็กกุญแจไหม ---
    // [MySQL] room_tags(...).select("..., borrowed_by:borrowed_by_teacher_id(id, name), ...")
    // -> ROOM_TAG_SELECT_SQL (LEFT JOIN teachers) แล้ว parseRoomTagRow()
    // แปลงกลับเป็น shape เดิม (ดู MANIFEST ข้อ 3)
    const [roomTagRows] = await query(
      `${ROOM_TAG_SELECT_SQL} WHERE rt.tag_uid = ? LIMIT 1`,
      [cleanTagUid]
    );

    const roomTag = roomTagRows.length > 0 ? parseRoomTagRow(roomTagRows[0]) : null;

    if (!roomTag) {
      // -------------------------------------------------------
      // ไม่เจอทั้ง teacher_tags และ room_tags — ก่อนจะตอบว่า "ไม่รู้จัก
      // แท็กนี้" ต้องเช็คก่อนว่า readerId นี้กำลังอยู่ใน "โหมดรอสมัคร"
      // ครูอยู่หรือเปล่า (มีคนกรอกฟอร์มสมัครค้างไว้ผ่าน
      // POST /api/register/teacher/start แล้วรอแตะบัตรอยู่พอดี)
      //
      // ถ้าใช่ -> intent ตอนนั้นชัดเจนว่าแตะเพื่อผูกเป็นบัตรครูใหม่
      // จึงสร้างครูใหม่ + ผูก tag_uid ให้ทันที ไม่ต้อง auto-create
      // ในกรณีอื่นนอกเหนือจากนี้เด็ดขาด (ความปลอดภัย: ป้องกันแท็กแปลก
      // ปลอมสร้างครูใหม่มั่วๆ ตอนไม่มีใครกำลังสมัครอยู่)
      // -------------------------------------------------------
      const pending = getPendingRegistration(reader);

      if (!pending) {
        return res.status(404).json({
          ok: false,
          state: "unknown_tag",
          message: "ไม่พบแท็กนี้ในระบบ (ไม่ใช่ทั้งแท็กครูและแท็กกุญแจ)",
        });
      }

      try {
        // [MySQL] insert teachers + insert teacher_tags สองคำสั่งแยกกัน
        // -> ห่อด้วย withTransaction() จริงตามข้อ 9 ของ MANIFEST (ของเดิม
        // บน Supabase ไม่มี transaction จริงตรงนี้ — ถ้า insert ที่สอง
        // ล้มเหลว ครูที่สร้างไปแล้วจะค้างไม่มี tag ผูก) ที่นี่ถ้า insert
        // ใดล้มเหลว rollback ทั้งคู่กลับ ไม่ทิ้งครูกำพร้าไว้
        const createdTeacher = await withTransaction(async (conn) => {
          const [insertTeacherResult] = await conn.query(
            `INSERT INTO teachers (name, department, teacher_code, last_login_at)
             VALUES (?, ?, ?, ?)`,
            [
              pending.name,
              pending.department,
              // teachers.teacher_code เป็น NOT NULL ใน schema จริง แต่ flow
              // สมัครผ่านการแตะบัตรนี้ไม่มีขั้นตอนให้ครูกรอกรหัสเอง จึงใช้
              // tag_uid ของบัตรที่แตะเป็น teacher_code ไปเลย — รับประกัน
              // ไม่ซ้ำอยู่แล้วเพราะ tag_uid มี unique constraint ในตัว
              cleanTagUid,
              new Date(),
            ]
          );

          const teacherId = insertTeacherResult.insertId;

          await conn.query(
            `INSERT INTO teacher_tags (teacher_id, tag_uid) VALUES (?, ?)`,
            [teacherId, cleanTagUid]
          );

          const [teacherRows] = await conn.query(
            `SELECT id, name FROM teachers WHERE id = ?`,
            [teacherId]
          );

          return teacherRows[0];
        });

        resolveRegistration(reader, {
          ok: true,
          teacher: { id: createdTeacher.id, name: createdTeacher.name },
        });

        return res.json({
          ok: true,
          state: "registered",
          message: `สมัครสำเร็จ — คุณครู ${createdTeacher.name} ผูกบัตรประจำตัวเรียบร้อยแล้ว`,
          teacher: { id: createdTeacher.id, name: createdTeacher.name },
        });
      } catch (registerErr) {
        console.error("Tap register-bind error:", registerErr.message);
        resolveRegistration(reader, {
          ok: false,
          message: "ผูกบัตรกับบัญชีที่กำลังสมัครไม่สำเร็จ กรุณาลองสมัครใหม่อีกครั้ง",
        });
        return res.status(500).json({
          ok: false,
          state: "register_failed",
          message: "ผูกบัตรกับบัญชีที่กำลังสมัครไม่สำเร็จ กรุณาลองสมัครใหม่อีกครั้ง",
        });
      }
    }

    // --- กรณี 2: แตะแท็กกุญแจ -> ต้องมี session ครูที่ยัง active อยู่ก่อน ---
    const session = getSession(reader);

    if (!session) {
      return res.status(409).json({
        ok: false,
        state: "session_expired",
        message: "กรุณาแตะแท็กประจำตัวครูก่อน แล้วค่อยแตะแท็กกุญแจ",
      });
    }

    touchSession(reader);

    // --- ตัดสินใจ borrow หรือ return ---
    if (roomTag.status === "available") {
      // ยืม — เช็คช่วงเวลาที่อนุญาตก่อนเสมอ (การคืนไม่ต้องเช็คนี้เลย —
      // ดู isWithinBorrowWindow ด้านบนและ constraint ที่ล็อกไว้ใน MANIFEST:
      // "คืน" ต้องทำได้เสมอไม่ว่ากรณีใด กันครูค้างกุญแจเพราะติดช่วงห้ามยืม)
      if (!isWithinBorrowWindow(roomTag)) {
        return res.status(409).json({
          ok: false,
          state: "outside_window",
          message: `กุญแจ "${roomTag.room_name}" ยืมได้เฉพาะในช่วงเวลาที่กำหนดเท่านั้น กรุณาลองใหม่ในช่วงเวลาที่อนุญาต`,
          room: { id: roomTag.id, roomName: roomTag.room_name },
        });
      }

      // [MySQL] .update({...}).eq("id", roomTag.id).eq("status", "available")
      // .select().maybeSingle() -> UPDATE ... WHERE ... แล้วเช็ค
      // affectedRows === 0 แทนการเช็ค null (ดู MANIFEST ข้อ 2) — ถ้า
      // affectedRows > 0 ถึงจะ SELECT แถวใหม่กลับมา (mysql2 ไม่มี
      // .select() ในตัวเหมือน Supabase)
      const [updateResult] = await query(
        `UPDATE room_tags
         SET status = 'borrowed', borrowed_by_teacher_id = ?, borrowed_at = ?
         WHERE id = ? AND status = 'available'`,
        [session.teacherId, new Date(), roomTag.id]
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
      // [MySQL] conditional update กัน race เหมือนจุดยืมด้านบน แต่เช็ค
      // เงื่อนไขเพิ่มอีกชั้น (status = 'borrowed' AND borrowed_by_teacher_id = ?)
      // ตรงกับ .eq().eq().eq() สามชั้นของเดิม
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