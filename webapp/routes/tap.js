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
// -----------------------------------------------------------------

const express = require("express");
const router = express.Router();
const supabase = require("../config/supabaseClient");
const {
  getPendingRegistration,
  resolveRegistration,
} = require("./register_session");

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
// POST /api/tap
// body: { tagUid, readerId }
// readerId: ตัวระบุเครื่องอ่าน (เผื่ออนาคตมีหลายเครื่อง) ถ้าไม่ส่งมา
// ใช้ "default" — พอสำหรับกรณีมีเครื่องอ่านเดียวที่ห้องทะเบียนตอนนี้
//
// response ทุกกรณีมี field "state" บอกสถานะปัจจุบันให้หน้าจอแสดงผล:
//   'session_started' | 'borrowed' | 'returned' | 'wrong_teacher' |
//   'unknown_tag' | 'session_expired'
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
    // -----------------------------------------------------------
    const { data: teacherTag, error: teacherTagError } = await supabase
      .from("teacher_tags")
      .select("teacher_id, teachers(id, name)")
      .eq("tag_uid", cleanTagUid)
      .maybeSingle();

    if (teacherTagError) throw teacherTagError;

    // --- กรณี 1: แตะแท็กครู ---
    if (teacherTag) {
      const teacher = teacherTag.teachers;

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
    const { data: roomTag, error: roomTagError } = await supabase
      .from("room_tags")
      .select("id, room_name, status, borrowed_by_teacher_id, borrowed_by:borrowed_by_teacher_id(id, name)")
      .eq("tag_uid", cleanTagUid)
      .maybeSingle();

    if (roomTagError) throw roomTagError;

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
        const { data: createdTeacher, error: createTeacherError } = await supabase
          .from("teachers")
          .insert({
            name: pending.name,
            department: pending.department,
            last_login_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (createTeacherError) throw createTeacherError;

        const { error: createTagError } = await supabase
          .from("teacher_tags")
          .insert({
            teacher_id: createdTeacher.id,
            tag_uid: cleanTagUid,
          });

        if (createTagError) throw createTagError;

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
      // ยืม
      const { data: updated, error: updateError } = await supabase
        .from("room_tags")
        .update({
          status: "borrowed",
          borrowed_by_teacher_id: session.teacherId,
          borrowed_at: new Date().toISOString(),
        })
        .eq("id", roomTag.id)
        .eq("status", "available") // conditional update กันแตะรัว/race
        .select()
        .maybeSingle();

      if (updateError) throw updateError;

      if (!updated) {
        return res.status(409).json({
          ok: false,
          state: "wrong_teacher",
          message: "กุญแจนี้เพิ่งถูกยืมไปพอดี กรุณาลองใหม่อีกครั้ง",
        });
      }

      await supabase.from("key_logs").insert({
        room_tag_id: roomTag.id,
        teacher_id: session.teacherId,
        action: "borrow",
      });

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
      const { data: updated, error: updateError } = await supabase
        .from("room_tags")
        .update({
          status: "available",
          borrowed_by_teacher_id: null,
          borrowed_at: null,
        })
        .eq("id", roomTag.id)
        .eq("status", "borrowed")
        .eq("borrowed_by_teacher_id", session.teacherId) // conditional update กัน race
        .select()
        .maybeSingle();

      if (updateError) throw updateError;

      if (!updated) {
        return res.status(409).json({
          ok: false,
          state: "wrong_teacher",
          message: "มีความเปลี่ยนแปลงสถานะกุญแจนี้ระหว่างที่กำลังดำเนินการ กรุณาลองใหม่อีกครั้ง",
        });
      }

      await supabase.from("key_logs").insert({
        room_tag_id: roomTag.id,
        teacher_id: session.teacherId,
        action: "return",
      });

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
