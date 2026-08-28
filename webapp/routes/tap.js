// routes/tap.js
// -----------------------------------------------------------------
// หัวใจของระบบ: endpoint เดียวรับทุกการ "แตะแท็ก" จากเครื่องอ่าน
// + ส่ง Line Notify เวลายืม/คืน
//
// ไม่ใส่ requireAuth เพราะจุดนี้เป็นอุปกรณ์ทางกายภาพที่ห้องทะเบียน
// ความปลอดภัยอยู่ที่แท็กประจำตัวครูเอง
// -----------------------------------------------------------------

const express = require("express");
const router = express.Router();
const axios = require("axios");
const pool = require("../config/db");
const {
  getPendingRegistration,
  resolveRegistration,
} = require("./register_session");

const SESSION_TTL_MS = 20 * 1000; // 20 วินาที

// key: readerId -> { teacherId, teacherName, expiresAt }
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

// -----------------------------------------------------------------
// Line Notify ฟังก์ชัน
// -----------------------------------------------------------------
async function sendLineNotify(message) {
  try {
    const token = process.env.LINE_NOTIFY_TOKEN;
    if (!token) {
      console.warn("⚠️ LINE_NOTIFY_TOKEN ไม่ได้ตั้งค่า — skip Line Notify");
      return;
    }

    await axios.post(
      "https://notify-api.line.me/api/notify",
      `message=${encodeURIComponent(message)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    console.log(`✅ Line Notify sent: ${message}`);
  } catch (err) {
    console.error("❌ Line Notify error:", err.message);
    // ไม่ throw — let request ของ tap ดำเนินการต่อได้แม้ notify ล้มเหลว
  }
}

// -----------------------------------------------------------------
// isWithinBorrowWindow(roomTag) -> boolean
// -----------------------------------------------------------------
function isWithinBorrowWindow(roomTag) {
  const now = new Date();

  // --- เช็ควัน ---
  const days = roomTag.borrow_window_days;
  if (Array.isArray(days) && days.length > 0) {
    const currentDay = now.getDay();
    if (!days.includes(currentDay)) {
      return false;
    }
  }

  // --- เช็คเวลา ---
  const start = roomTag.borrow_window_start;
  const end = roomTag.borrow_window_end;

  if (!start || !end) {
    return true;
  }

  const pad2 = (n) => String(n).padStart(2, "0");
  const nowTimeStr = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;

  if (start <= end) {
    return nowTimeStr >= start && nowTimeStr <= end;
  }

  return nowTimeStr >= start || nowTimeStr <= end;
}

// -----------------------------------------------------------------
// parseRoomTagRow(row) -> roomTag shape
// -----------------------------------------------------------------
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
        : row.borrow_window_days,
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

// -----------------------------------------------------------------
// POST /api/tap
// body: { tagUid, readerId }
// -----------------------------------------------------------------
router.post("/tap", async (req, res) => {
  const { tagUid, readerId } = req.body;
  const reader = readerId || "default";

  if (!tagUid || !tagUid.trim()) {
    return res
      .status(400)
      .json({ ok: false, message: "ไม่พบเลขแท็กที่ส่งมา" });
  }

  const cleanTagUid = tagUid.trim();

  let connection;
  try {
    connection = await pool.getConnection();

    // --- เช็คแท็กครู ---
    const [teacherTagRows] = await connection.query(
      `SELECT tt.teacher_id, t.id AS teacher_id_full, t.name AS teacher_name
       FROM teacher_tags tt
       JOIN teachers t ON t.id = tt.teacher_id
       WHERE tt.tag_uid = ?
       LIMIT 1`,
      [cleanTagUid]
    );

    const teacherTag =
      teacherTagRows.length > 0 ? teacherTagRows[0] : null;

    // --- กรณี 1: แตะแท็กครู ---
    if (teacherTag) {
      const teacher = {
        id: teacherTag.teacher_id_full,
        name: teacherTag.teacher_name,
      };

      const pendingDuringTeacherTap = getPendingRegistration(reader);
      if (pendingDuringTeacherTap) {
        resolveRegistration(reader, {
          ok: false,
          message: `บัตรใบนี้ถูกใช้เป็นบัตรประจำตัวของคุณครู ${teacher.name} อยู่แล้ว`,
        });
        return res.status(409).json({
          ok: false,
          state: "tag_already_bound",
          message: `บัตรใบนี้ถูกใช้เป็นบัตรประจำตัวของคุณครู ${teacher.name} อยู่แล้ว`,
        });
      }

      setSession(reader, teacher.id, teacher.name);

      return res.json({
        ok: true,
        state: "session_started",
        message: `สวัสดีคุณครู ${teacher.name} — แตะแท็กกุญแจที่ต้องการยืม/คืนได้เลย`,
        teacher: { id: teacher.id, name: teacher.name },
      });
    }

    // --- เช็คแท็กกุญแจ ---
    const [roomTagRows] = await connection.query(
      `${ROOM_TAG_SELECT_SQL} WHERE rt.tag_uid = ? LIMIT 1`,
      [cleanTagUid]
    );

    const roomTag =
      roomTagRows.length > 0 ? parseRoomTagRow(roomTagRows[0]) : null;

    if (!roomTag) {
      const pending = getPendingRegistration(reader);

      if (!pending) {
        return res.status(404).json({
          ok: false,
          state: "unknown_tag",
          message:
            "ไม่พบแท็กนี้ในระบบ (ไม่ใช่ทั้งแท็กครูและแท็กกุญแจ)",
        });
      }

      try {
        // [MySQL Transaction] สมัครครูใหม่
        await connection.beginTransaction();

        const [insertTeacherResult] = await connection.query(
          `INSERT INTO teachers (name, department, teacher_code, last_login_at)
           VALUES (?, ?, ?, ?)`,
          [pending.name, pending.department, cleanTagUid, new Date()]
        );

        const teacherId = insertTeacherResult.insertId;

        await connection.query(
          `INSERT INTO teacher_tags (teacher_id, tag_uid) VALUES (?, ?)`,
          [teacherId, cleanTagUid]
        );

        await connection.commit();

        const [teacherRows] = await connection.query(
          `SELECT id, name FROM teachers WHERE id = ?`,
          [teacherId]
        );

        const createdTeacher = teacherRows[0];

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
        await connection.rollback();
        console.error("Tap register-bind error:", registerErr.message);
        resolveRegistration(reader, {
          ok: false,
          message:
            "ผูกบัตรกับบัญชีที่กำลังสมัครไม่สำเร็จ กรุณาลองสมัครใหม่อีกครั้ง",
        });
        return res.status(500).json({
          ok: false,
          state: "register_failed",
          message:
            "ผูกบัตรกับบัญชีที่กำลังสมัครไม่สำเร็จ กรุณาลองสมัครใหม่อีกครั้ง",
        });
      }
    }

    // --- เช็ค session ครู ---
    const session = getSession(reader);

    if (!session) {
      return res.status(409).json({
        ok: false,
        state: "session_expired",
        message: "กรุณาแตะแท็กประจำตัวครูก่อน แล้วค่อยแตะแท็กกุญแจ",
      });
    }

    touchSession(reader);

    // --- ยืม ---
    if (roomTag.status === "available") {
      if (!isWithinBorrowWindow(roomTag)) {
        return res.status(409).json({
          ok: false,
          state: "outside_window",
          message: `กุญแจ "${roomTag.room_name}" ยืมได้เฉพาะในช่วงเวลาที่กำหนดเท่านั้น`,
          room: { id: roomTag.id, roomName: roomTag.room_name },
        });
      }

      const [updateResult] = await connection.query(
        `UPDATE room_tags
         SET status = 'borrowed', borrowed_by_teacher_id = ?, borrowed_at = ?
         WHERE id = ? AND status = 'available'`,
        [session.teacherId, new Date(), roomTag.id]
      );

      if (updateResult.affectedRows === 0) {
        return res.status(409).json({
          ok: false,
          state: "wrong_teacher",
          message: "กุญแจนี้เพิ่งถูกยืมไปพอดี กรุณาลองใหม่อีกครั้ง",
        });
      }

      await connection.query(
        `INSERT INTO key_logs (room_tag_id, teacher_id, action) VALUES (?, ?, 'borrow')`,
        [roomTag.id, session.teacherId]
      );

      // 🔔 Line Notify
      const lineMessage = `✅ ยืมกุญแจ: "${roomTag.room_name}" โดยคุณครู ${session.teacherName}`;
      sendLineNotify(lineMessage);

      return res.json({
        ok: true,
        state: "borrowed",
        message: `ยืมกุญแจ "${roomTag.room_name}" สำเร็จ — คุณครู ${session.teacherName}`,
        room: { id: roomTag.id, roomName: roomTag.room_name },
        teacher: { id: session.teacherId, name: session.teacherName },
      });
    }

    // --- คืน ---
    if (roomTag.borrowed_by_teacher_id === session.teacherId) {
      const [updateResult] = await connection.query(
        `UPDATE room_tags
         SET status = 'available', borrowed_by_teacher_id = NULL, borrowed_at = NULL
         WHERE id = ? AND status = 'borrowed' AND borrowed_by_teacher_id = ?`,
        [roomTag.id, session.teacherId]
      );

      if (updateResult.affectedRows === 0) {
        return res.status(409).json({
          ok: false,
          state: "wrong_teacher",
          message:
            "มีความเปลี่ยนแปลงสถานะกุญแจนี้ระหว่างที่กำลังดำเนินการ กรุณาลองใหม่",
        });
      }

      await connection.query(
        `INSERT INTO key_logs (room_tag_id, teacher_id, action) VALUES (?, ?, 'return')`,
        [roomTag.id, session.teacherId]
      );

      // 🔔 Line Notify
      const lineMessage = `🔑 คืนกุญแจ: "${roomTag.room_name}" โดยคุณครู ${session.teacherName}`;
      sendLineNotify(lineMessage);

      return res.json({
        ok: true,
        state: "returned",
        message: `คืนกุญแจ "${roomTag.room_name}" สำเร็จ — คุณครู ${session.teacherName}`,
        room: { id: roomTag.id, roomName: roomTag.room_name },
        teacher: { id: session.teacherId, name: session.teacherName },
      });
    }

    // --- ครูอื่นถือกุญแจ ---
    const holderName = roomTag.borrowed_by
      ? roomTag.borrowed_by.name
      : "ไม่ทราบชื่อ";
    return res.status(409).json({
      ok: false,
      state: "wrong_teacher",
      message: `กุญแจ "${roomTag.room_name}" ถูกยืมอยู่โดยคุณครู ${holderName} — คืนได้เฉพาะครูท่านที่ยืมไปเท่านั้น`,
    });
  } catch (err) {
    console.error("Tap error:", err.message);
    return res
      .status(500)
      .json({
        ok: false,
        message: "ประมวลผลการแตะแท็กไม่สำเร็จ",
        error: err.message,
      });
  } finally {
    if (connection) connection.release();
  }
});

// -----------------------------------------------------------------
// GET /api/tap/session
// -----------------------------------------------------------------
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

// -----------------------------------------------------------------
// POST /api/tap/session/clear
// -----------------------------------------------------------------
router.post("/tap/session/clear", (req, res) => {
  const reader = (req.body.readerId || "default").toString();
  clearSession(reader);
  return res.json({ ok: true });
});

module.exports = router;
