// routes/transactions.js
// -----------------------------------------------------------------
// Flow ยืม-คืนของจริง (เวอร์ชันเว็บ หลัง login) ตาม HANDOFF.md ข้อ 3:
//
//   1. นักเรียน/ครู login แล้วเห็นรายการ room_items พร้อมสถานะ
//   2. กด "ขอยืม" หรือ "ขอคืน" -> สร้าง transaction สถานะ pending
//   3. ครูที่มีสิทธิ์ดูแลห้องนั้น (teacher_room_assignments) กด "อนุมัติ"
//   4. อนุมัติแล้วค่อยอัปเดต room_items.status จริง + ปิด transaction
//
// ทุก route ในไฟล์นี้ต้อง login ก่อน (requireAuth) — ทั้งนักเรียนและครู
// เข้าดู/ขอยืม-คืนได้ แต่อนุมัติได้เฉพาะครูที่มีสิทธิ์เท่านั้น
//
// ทุกครั้งที่เจอความพยายามทำเกินสิทธิ์/ผิดปกติ จะบันทึกลง
// access_violation_logs ไว้ด้วย (ไม่ block การตอบ error กลับไปให้ user)
//
// -----------------------------------------------------------------
// FIX (race condition): เดิมทุก route ใช้ pattern "select ตรวจสอบ
// สถานะ -> ค่อย update" แยกเป็นสองคำสั่งแบบไม่ atomic เช่น เช็คว่า
// room_items.status === 'available' แล้วค่อย insert transaction, หรือ
// เช็คว่า transactions.status === 'pending' แล้วค่อย update เป็น
// approved — ถ้ามี 2 request มาพร้อมกัน (เช่น double-click, หรือครู
// 2 คนกด approve พร้อมกัน) ทั้งคู่จะเห็น state เดิมผ่านการเช็คพร้อมกัน
// แล้วทำซ้ำทั้งคู่ ทำให้ข้อมูลเพี้ยน (สร้าง transaction ซ้ำ, หรือ
// room_items ถูกอัปเดตสองรอบ)
//
// วิธีแก้: เปลี่ยนทุกจุดที่เคย "select แล้วค่อย update" ให้เป็น
// "conditional update เดียว" (.update(...).eq('status', 'pending'))
// แล้วเช็คว่ามีแถวที่ถูกอัปเดตจริงไหมจาก .select().maybeSingle() —
// ถ้าไม่มีแถวกลับมา แปลว่ามีคนอื่นชิงทำไปก่อนแล้ว (แพ้ race) ให้ตอบ 409
// กลับไปแทน ไม่ต้อง throw เพราะไม่ใช่ error จริง เป็นแค่แพ้ race
//
// หลักการ: การ "อ้างสิทธิ์" (claim) แถวต้องเกิดขึ้นในคำสั่ง SQL เดียว
// ที่มีทั้งเงื่อนไขเช็คสถานะเดิมและการเปลี่ยนสถานะใหม่พร้อมกัน ไม่ใช่
// สองคำสั่งแยกกันที่มีช่องว่างให้ request อื่นแทรกได้
// -----------------------------------------------------------------

const express = require("express");
const router = express.Router();
const supabase = require("../config/supabaseClient");
const { requireAuth, requireRole } = require("../middleware/auth");

// -------------------------------------------------------------
// helper: บันทึก log กรณีผิดปกติ — ไม่ throw ต่อ (best-effort เฉยๆ
// เพราะไม่อยากให้การ log ล้มเหลวไปบัง error หลักที่ user ต้องเห็น)
// -------------------------------------------------------------
async function logViolation({ eventType, actorType, actorId, roomItemId, transactionId, detail }) {
  try {
    await supabase.from("access_violation_logs").insert({
      event_type: eventType,
      actor_type: actorType || null,
      actor_student_id: actorType === "student" ? actorId : null,
      actor_teacher_id: actorType === "teacher" ? actorId : null,
      room_item_id: roomItemId || null,
      transaction_id: transactionId || null,
      detail: detail || null,
    });
  } catch (logErr) {
    console.error("Log violation failed:", logErr.message);
  }
}

// -------------------------------------------------------------
// GET /api/items
// รายการของที่ยืมได้ทั้งหมด พร้อมชื่อห้อง — ให้นักเรียน/ครูดูก่อนกดยืม
// (ต้อง login ก่อน ไม่ว่า role ไหนก็เห็นรายการเดียวกัน)
// -------------------------------------------------------------
router.get("/items", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("room_items")
      .select("*, room_tags(id, room_name)")
      .order("id", { ascending: true });

    if (error) throw error;

    return res.json({ ok: true, items: data });
  } catch (err) {
    console.error("List items error:", err.message);
    return res.status(500).json({ ok: false, message: "ดึงรายการของไม่สำเร็จ" });
  }
});

// -------------------------------------------------------------
// GET /api/transactions/pending
// รายการ transaction ที่รอการอนุมัติ — ใช้ทั้งฝั่งนักเรียน (ดูสถานะที่ตัวเอง
// ขอไว้) และฝั่งครู (ดูว่ามีอะไรรอตัวเองอนุมัติบ้าง)
// ครู: จะกรองมาเฉพาะห้องที่ตัวเองมีสิทธิ์ดูแลให้อัตโนมัติ ถ้าไม่ส่ง query
// นักเรียน: เห็นเฉพาะที่ตัวเองขอไว้เท่านั้น
// -------------------------------------------------------------
router.get("/transactions/pending", requireAuth, async (req, res) => {
  try {
    let query = supabase
      .from("transactions")
      .select(
        "*, room_items(id, item_name, status, room_tag_id, room_tags(id, room_name)), " +
          "requested_by_student:requested_by_student_id(id, name, room, seat_no), " +
          "requested_by_teacher:requested_by_teacher_id(id, name, department)"
      )
      .eq("status", "pending")
      .order("requested_at", { ascending: true });

    const { data: allPending, error } = await query;

    if (error) throw error;

    if (req.user.role === "student") {
      const mine = allPending.filter(
        (t) => t.requested_by_type === "student" && t.requested_by_student_id === req.user.id
      );
      return res.json({ ok: true, transactions: mine });
    }

    if (req.user.role === "teacher") {
      // ดึงห้องที่ครูคนนี้มีสิทธิ์ดูแล แล้วกรอง pending เฉพาะห้องเหล่านั้น
      const { data: assignments, error: assignError } = await supabase
        .from("teacher_room_assignments")
        .select("room_tag_id")
        .eq("teacher_id", req.user.id);

      if (assignError) throw assignError;

      const myRoomIds = new Set((assignments || []).map((a) => a.room_tag_id));

      const forMyRooms = allPending.filter((t) => {
        const roomTagId = t.room_items && t.room_items.room_tag_id;
        return myRoomIds.has(roomTagId);
      });

      return res.json({ ok: true, transactions: forMyRooms });
    }

    // admin หรือ role อื่น: เห็นทั้งหมด
    return res.json({ ok: true, transactions: allPending });
  } catch (err) {
    console.error("List pending transactions error:", err.message);
    return res.status(500).json({ ok: false, message: "ดึงรายการที่รออนุมัติไม่สำเร็จ" });
  }
});

// -------------------------------------------------------------
// POST /api/borrow
// body: { roomItemId }
// นักเรียนหรือครู กดขอยืมของชิ้นนี้ -> สร้าง transaction สถานะ pending
// (ยังไม่แตะ room_items.status จนกว่าจะมีครูอนุมัติ)
//
// FIX: เดิมเช็ค item.status และ existingPending แยกจาก insert เป็น
// คนละคำสั่ง ทำให้สองคน borrow ของชิ้นเดียวกันพร้อมกันได้ (ทั้งคู่เห็น
// available/ไม่มี pending พร้อมกัน) ตอนนี้ "ยึดสิทธิ์" ของชิ้นนั้นด้วย
// การ conditional-update room_items.status: 'available' -> 'claimed'
// ในคำสั่งเดียวก่อน (atomic) ถ้าไม่มีแถวกลับมา = มีคนอื่นชิงไปก่อนแล้ว
// หลังจาก insert transaction สำเร็จ ค่อยคืนสถานะ item กลับเป็น
// 'available' เหมือนเดิม (เพราะ item ยังไม่ถูกยืมจริงจนกว่าจะ approve
// แค่ต้องการ "lock" ชั่วคราวระหว่างสร้าง transaction เท่านั้น)
// -------------------------------------------------------------
router.post("/borrow", requireAuth, async (req, res) => {
  const { roomItemId } = req.body;
  const requesterType = req.user.role; // "student" | "teacher"
  const requesterId = req.user.id;

  if (requesterType !== "student" && requesterType !== "teacher") {
    return res.status(403).json({ ok: false, message: "เฉพาะนักเรียนและครูเท่านั้นที่ขอยืมของได้" });
  }

  if (!roomItemId) {
    return res.status(400).json({ ok: false, message: "กรุณาเลือกของที่ต้องการยืม" });
  }

  try {
    const { data: item, error: itemFindError } = await supabase
      .from("room_items")
      .select("id, status")
      .eq("id", roomItemId)
      .maybeSingle();

    if (itemFindError) throw itemFindError;

    if (!item) {
      await logViolation({
        eventType: "invalid_target",
        actorType: requesterType,
        actorId: requesterId,
        roomItemId,
        detail: "พยายามขอยืม room_item ที่ไม่มีอยู่จริง",
      });
      return res.status(404).json({ ok: false, message: "ไม่พบของชิ้นนี้" });
    }

    if (item.status !== "available") {
      return res.status(409).json({ ok: false, message: "ของชิ้นนี้ถูกยืมอยู่แล้ว ไม่สามารถขอยืมซ้ำได้" });
    }

    // --- จุดกันชน (atomic claim) ---
    // ยึดสิทธิ์ของชิ้นนี้ด้วย conditional update เดียว: ต้องยังเป็น
    // 'available' อยู่ตอน update เท่านั้นถึงจะสำเร็จ (กันสอง request
    // มาถึงพร้อมกันแล้วผ่านเช็คด้านบนทั้งคู่)
    const { data: claimedItem, error: claimError } = await supabase
      .from("room_items")
      .update({ status: "pending_borrow" })
      .eq("id", roomItemId)
      .eq("status", "available")
      .select("id")
      .maybeSingle();

    if (claimError) throw claimError;

    if (!claimedItem) {
      // แพ้ race หรือมีคนอื่นแทรกไปแล้วระหว่างเช็คกับ claim
      return res.status(409).json({
        ok: false,
        message: "ของชิ้นนี้เพิ่งถูกขอยืม/ถูกยืมไปพอดี กรุณาลองใหม่อีกครั้ง",
      });
    }

    const insertPayload = {
      room_item_id: roomItemId,
      action: "borrow",
      status: "pending",
      requested_by_type: requesterType,
      requested_by_student_id: requesterType === "student" ? requesterId : null,
      requested_by_teacher_id: requesterType === "teacher" ? requesterId : null,
    };

    const { data: created, error: insertError } = await supabase
      .from("transactions")
      .insert(insertPayload)
      .select("*, room_items(id, item_name, status, room_tags(id, room_name))")
      .single();

    if (insertError) {
      // insert transaction ล้มเหลว -> ต้องปล่อย lock ของ item คืน ไม่งั้น
      // item จะค้างสถานะ 'pending_borrow' ตลอดไปโดยไม่มี transaction คู่กัน
      await supabase.from("room_items").update({ status: "available" }).eq("id", roomItemId);
      throw insertError;
    }

    // สร้าง transaction สำเร็จแล้ว -> คืนสถานะ item กลับเป็น 'available'
    // (item ยังไม่ถือว่าถูกยืมจริงจนกว่าจะมีครู approve; 'pending_borrow'
    // มีไว้แค่ระหว่างกันชนตอน claim เท่านั้น ไม่ใช่สถานะที่ persist ยาว)
    const { error: releaseError } = await supabase
      .from("room_items")
      .update({ status: "available" })
      .eq("id", roomItemId);

    if (releaseError) {
      // ไม่ throw เพราะ transaction สร้างสำเร็จแล้ว แค่ log ไว้เฉยๆ
      console.error("Release item lock after borrow request failed:", releaseError.message);
    }

    return res.json({ ok: true, transaction: created });
  } catch (err) {
    console.error("Borrow request error:", err.message);
    return res.status(500).json({ ok: false, message: "ขอยืมของไม่สำเร็จ" });
  }
});

// -------------------------------------------------------------
// POST /api/return
// body: { roomItemId }
// นักเรียนหรือครู กดขอคืนของชิ้นนี้ -> สร้าง transaction สถานะ pending
// เช็คว่าคนขอคืนต้องเป็นคนที่ถืออยู่จริง (borrowed_by ตรงกับ req.user)
//
// FIX: เดิมเช็ค existingPending แยกจาก insert เป็นคนละคำสั่ง เหมือน
// borrow — ใช้วิธีเดียวกัน คือ atomic-claim ผ่าน conditional update
// room_items.status: 'borrowed' -> 'pending_return' ก่อน insert
// transaction แล้วค่อยคืนกลับเป็น 'borrowed' (ของยังถือว่าถูกยืมอยู่
// จนกว่าจะ approve คืนจริง)
// -------------------------------------------------------------
router.post("/return", requireAuth, async (req, res) => {
  const { roomItemId } = req.body;
  const requesterType = req.user.role;
  const requesterId = req.user.id;

  if (requesterType !== "student" && requesterType !== "teacher") {
    return res.status(403).json({ ok: false, message: "เฉพาะนักเรียนและครูเท่านั้นที่ขอคืนของได้" });
  }

  if (!roomItemId) {
    return res.status(400).json({ ok: false, message: "กรุณาเลือกของที่ต้องการคืน" });
  }

  try {
    const { data: item, error: itemFindError } = await supabase
      .from("room_items")
      .select("id, status, borrowed_by_type, borrowed_by_student_id, borrowed_by_teacher_id")
      .eq("id", roomItemId)
      .maybeSingle();

    if (itemFindError) throw itemFindError;

    if (!item) {
      await logViolation({
        eventType: "invalid_target",
        actorType: requesterType,
        actorId: requesterId,
        roomItemId,
        detail: "พยายามขอคืน room_item ที่ไม่มีอยู่จริง",
      });
      return res.status(404).json({ ok: false, message: "ไม่พบของชิ้นนี้" });
    }

    if (item.status !== "borrowed") {
      return res.status(409).json({ ok: false, message: "ของชิ้นนี้ไม่ได้อยู่ระหว่างถูกยืม" });
    }

    const isBorrower =
      item.borrowed_by_type === requesterType &&
      ((requesterType === "student" && item.borrowed_by_student_id === requesterId) ||
        (requesterType === "teacher" && item.borrowed_by_teacher_id === requesterId));

    if (!isBorrower) {
      await logViolation({
        eventType: "invalid_return_attempt",
        actorType: requesterType,
        actorId: requesterId,
        roomItemId,
        detail: "พยายามคืนของที่ตัวเองไม่ได้เป็นคนยืม",
      });
      return res.status(403).json({
        ok: false,
        message: "คุณไม่ใช่ผู้ยืมของชิ้นนี้ ไม่สามารถขอคืนแทนได้",
      });
    }

    // --- จุดกันชน (atomic claim) ---
    // ยึดสิทธิ์ของชิ้นนี้เพื่อขอคืน ต้องยังเป็น 'borrowed' อยู่ตอน update
    // เท่านั้นถึงจะสำเร็จ (กันกดคืนซ้ำพร้อมกันจากแท็บ/อุปกรณ์คนละตัว)
    const { data: claimedItem, error: claimError } = await supabase
      .from("room_items")
      .update({ status: "pending_return" })
      .eq("id", roomItemId)
      .eq("status", "borrowed")
      .select("id")
      .maybeSingle();

    if (claimError) throw claimError;

    if (!claimedItem) {
      return res.status(409).json({
        ok: false,
        message: "ของชิ้นนี้เพิ่งมีคำขอคืนพอดี กรุณาลองใหม่อีกครั้ง",
      });
    }

    const insertPayload = {
      room_item_id: roomItemId,
      action: "return",
      status: "pending",
      requested_by_type: requesterType,
      requested_by_student_id: requesterType === "student" ? requesterId : null,
      requested_by_teacher_id: requesterType === "teacher" ? requesterId : null,
    };

    const { data: created, error: insertError } = await supabase
      .from("transactions")
      .insert(insertPayload)
      .select("*, room_items(id, item_name, status, room_tags(id, room_name))")
      .single();

    if (insertError) {
      // insert ล้มเหลว -> ปล่อย lock คืนกลับเป็น 'borrowed' เหมือนเดิม
      await supabase.from("room_items").update({ status: "borrowed" }).eq("id", roomItemId);
      throw insertError;
    }

    // สร้าง transaction สำเร็จแล้ว -> คืนสถานะ item กลับเป็น 'borrowed'
    // (ของยังถือว่าถูกยืมอยู่จริงจนกว่าครูจะ approve การคืน)
    const { error: releaseError } = await supabase
      .from("room_items")
      .update({ status: "borrowed" })
      .eq("id", roomItemId);

    if (releaseError) {
      console.error("Release item lock after return request failed:", releaseError.message);
    }

    return res.json({ ok: true, transaction: created });
  } catch (err) {
    console.error("Return request error:", err.message);
    return res.status(500).json({ ok: false, message: "ขอคืนของไม่สำเร็จ" });
  }
});

// -------------------------------------------------------------
// POST /api/transactions/:id/approve
// เฉพาะครูเท่านั้น (requireRole("teacher")) และต้องเป็นครูที่มีสิทธิ์
// ดูแลห้องของ item ตัวนั้นจริง (teacher_room_assignments) เท่านั้น
// อนุมัติแล้ว: ปิด transaction เป็น approved + อัปเดต room_items.status จริง
//
// FIX: เดิมเช็ค txn.status === 'pending' แยกจาก update เป็นคนละคำสั่ง
// ทำให้ครู 2 คน (หรือดับเบิลคลิก) กด approve/reject รายการเดียวกัน
// พร้อมกันได้ ทั้งคู่ผ่านเช็คแล้วแก้ room_items ซ้ำสองรอบ — ตอนนี้ใช้
// conditional update บน transactions.status: 'pending' -> 'approved'
// เป็นคำสั่งเดียวก่อน (atomic) ถ้าไม่มีแถวกลับมาแปลว่ามีคนอื่นจัดการ
// ไปแล้ว ให้ตอบ 409 ทันทีโดยไม่แตะ room_items เลย
// -------------------------------------------------------------
router.post("/transactions/:id/approve", requireAuth, requireRole("teacher"), async (req, res) => {
  const { id } = req.params;
  const teacherId = req.user.id;

  try {
    const { data: txn, error: txnFindError } = await supabase
      .from("transactions")
      .select("*, room_items(id, status, room_tag_id)")
      .eq("id", id)
      .maybeSingle();

    if (txnFindError) throw txnFindError;

    if (!txn) {
      return res.status(404).json({ ok: false, message: "ไม่พบรายการนี้" });
    }

    if (txn.status !== "pending") {
      return res.status(409).json({ ok: false, message: "รายการนี้ถูกดำเนินการไปแล้ว" });
    }

    const roomTagId = txn.room_items && txn.room_items.room_tag_id;

    // เช็คสิทธิ์: ครูคนนี้ต้องมีชื่ออยู่ใน teacher_room_assignments ของห้องนี้
    const { data: hasAccess, error: accessError } = await supabase
      .from("teacher_room_assignments")
      .select("id")
      .eq("teacher_id", teacherId)
      .eq("room_tag_id", roomTagId)
      .maybeSingle();

    if (accessError) throw accessError;

    if (!hasAccess) {
      await logViolation({
        eventType: "unauthorized_approval",
        actorType: "teacher",
        actorId: teacherId,
        roomItemId: txn.room_item_id,
        transactionId: txn.id,
        detail: "ครูพยายามอนุมัติห้องที่ตัวเองไม่ได้ดูแล",
      });
      return res.status(403).json({
        ok: false,
        message: "คุณไม่มีสิทธิ์อนุมัติรายการของห้อง/กุญแจนี้",
      });
    }

    // --- จุดกันชน (atomic claim) ---
    // "จอง" การอนุมัติรายการนี้ด้วย conditional update เดียว: ต้องยังเป็น
    // 'pending' อยู่ตอน update เท่านั้นถึงจะสำเร็จ กันครู 2 คน/ดับเบิลคลิก
    // approve พร้อมกันแล้วแตะ room_items ซ้ำสองรอบ
    const { data: claimedTxn, error: claimError } = await supabase
      .from("transactions")
      .update({
        status: "approved",
        approved_by_teacher_id: teacherId,
        approved_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "pending")
      .select("*, room_items(id, item_name, status, room_tags(id, room_name))")
      .maybeSingle();

    if (claimError) throw claimError;

    if (!claimedTxn) {
      // แพ้ race — มีคนอื่น approve/reject ไปก่อนแล้วในช่วงเสี้ยววินาทีนี้
      return res.status(409).json({ ok: false, message: "รายการนี้ถูกดำเนินการไปแล้ว" });
    }

    // อัปเดต room_items.status ตาม action ของ transaction
    let itemUpdatePayload;
    if (txn.action === "borrow") {
      itemUpdatePayload = {
        status: "borrowed",
        borrowed_by_type: txn.requested_by_type,
        borrowed_by_student_id: txn.requested_by_student_id,
        borrowed_by_teacher_id: txn.requested_by_teacher_id,
        borrowed_at: new Date().toISOString(),
      };
    } else {
      // return
      itemUpdatePayload = {
        status: "available",
        borrowed_by_type: null,
        borrowed_by_student_id: null,
        borrowed_by_teacher_id: null,
        borrowed_at: null,
      };
    }

    const { error: itemUpdateError } = await supabase
      .from("room_items")
      .update(itemUpdatePayload)
      .eq("id", txn.room_item_id);

    if (itemUpdateError) throw itemUpdateError;

    return res.json({ ok: true, transaction: claimedTxn });
  } catch (err) {
    console.error("Approve transaction error:", err.message);
    return res.status(500).json({ ok: false, message: "อนุมัติรายการไม่สำเร็จ" });
  }
});

// -------------------------------------------------------------
// POST /api/transactions/:id/reject
// เฉพาะครูที่มีสิทธิ์ดูแลห้องนั้น — ปฏิเสธคำขอ (ไม่แตะ room_items.status)
//
// FIX: เช่นเดียวกับ approve — ใช้ conditional update แทน select-แล้ว-
// update แยกกัน กันครู 2 คนกด reject/approve พร้อมกันบนรายการเดียวกัน
// -------------------------------------------------------------
router.post("/transactions/:id/reject", requireAuth, requireRole("teacher"), async (req, res) => {
  const { id } = req.params;
  const teacherId = req.user.id;

  try {
    const { data: txn, error: txnFindError } = await supabase
      .from("transactions")
      .select("*, room_items(id, room_tag_id)")
      .eq("id", id)
      .maybeSingle();

    if (txnFindError) throw txnFindError;

    if (!txn) {
      return res.status(404).json({ ok: false, message: "ไม่พบรายการนี้" });
    }

    if (txn.status !== "pending") {
      return res.status(409).json({ ok: false, message: "รายการนี้ถูกดำเนินการไปแล้ว" });
    }

    const roomTagId = txn.room_items && txn.room_items.room_tag_id;

    const { data: hasAccess, error: accessError } = await supabase
      .from("teacher_room_assignments")
      .select("id")
      .eq("teacher_id", teacherId)
      .eq("room_tag_id", roomTagId)
      .maybeSingle();

    if (accessError) throw accessError;

    if (!hasAccess) {
      await logViolation({
        eventType: "unauthorized_approval",
        actorType: "teacher",
        actorId: teacherId,
        roomItemId: txn.room_item_id,
        transactionId: txn.id,
        detail: "ครูพยายามปฏิเสธรายการของห้องที่ตัวเองไม่ได้ดูแล",
      });
      return res.status(403).json({
        ok: false,
        message: "คุณไม่มีสิทธิ์ดำเนินการรายการของห้อง/กุญแจนี้",
      });
    }

    // --- จุดกันชน (atomic claim) ---
    const { data: claimedTxn, error: claimError } = await supabase
      .from("transactions")
      .update({
        status: "rejected",
        approved_by_teacher_id: teacherId,
        approved_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "pending")
      .select("*, room_items(id, item_name, status, room_tags(id, room_name))")
      .maybeSingle();

    if (claimError) throw claimError;

    if (!claimedTxn) {
      return res.status(409).json({ ok: false, message: "รายการนี้ถูกดำเนินการไปแล้ว" });
    }

    return res.json({ ok: true, transaction: claimedTxn });
  } catch (err) {
    console.error("Reject transaction error:", err.message);
    return res.status(500).json({ ok: false, message: "ปฏิเสธรายการไม่สำเร็จ" });
  }
});

// -------------------------------------------------------------
// POST /api/transactions/:id/cancel
// ผู้ขอเองยกเลิกคำขอ pending ของตัวเอง (เผื่อกดผิดหรือเปลี่ยนใจ)
//
// FIX: เดิมเช็ค txn.status === 'pending' แยกจาก update เป็นคนละคำสั่ง —
// ใช้ conditional update เดียวกันแบบเดียวกับ approve/reject รวมถึง
// ต้อง "ปลดล็อก" room_items กลับสู่สถานะปกติด้วย เพราะตอนสร้างคำขอ
// borrow/return จะมีช่วงสั้นๆ ที่ item ถูก claim เป็น pending_borrow/
// pending_return ก่อนจะถูกปล่อยกลับ (ดู POST /borrow, /return ด้านบน)
// ปกติแล้ว item ควรกลับสู่สถานะ available/borrowed แล้วเสมอตอนที่ผู้ใช้
// มาถึงหน้าเห็นปุ่มยกเลิก จึงไม่ต้องแตะ room_items ในจุดนี้เพิ่มเติม
// -------------------------------------------------------------
router.post("/transactions/:id/cancel", requireAuth, async (req, res) => {
  const { id } = req.params;
  const requesterType = req.user.role;
  const requesterId = req.user.id;

  try {
    const { data: txn, error: txnFindError } = await supabase
      .from("transactions")
      .select("id, status, requested_by_type, requested_by_student_id, requested_by_teacher_id")
      .eq("id", id)
      .maybeSingle();

    if (txnFindError) throw txnFindError;

    if (!txn) {
      return res.status(404).json({ ok: false, message: "ไม่พบรายการนี้" });
    }

    if (txn.status !== "pending") {
      return res.status(409).json({ ok: false, message: "รายการนี้ถูกดำเนินการไปแล้ว ยกเลิกไม่ได้" });
    }

    const isOwner =
      txn.requested_by_type === requesterType &&
      ((requesterType === "student" && txn.requested_by_student_id === requesterId) ||
        (requesterType === "teacher" && txn.requested_by_teacher_id === requesterId));

    if (!isOwner) {
      return res.status(403).json({ ok: false, message: "คุณไม่ใช่เจ้าของคำขอนี้ ยกเลิกแทนไม่ได้" });
    }

    // --- จุดกันชน (atomic claim) ---
    const { data: updatedTxn, error: updateError } = await supabase
      .from("transactions")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("status", "pending")
      .select()
      .maybeSingle();

    if (updateError) throw updateError;

    if (!updatedTxn) {
      return res.status(409).json({ ok: false, message: "รายการนี้ถูกดำเนินการไปแล้ว ยกเลิกไม่ได้" });
    }

    return res.json({ ok: true, transaction: updatedTxn });
  } catch (err) {
    console.error("Cancel transaction error:", err.message);
    return res.status(500).json({ ok: false, message: "ยกเลิกคำขอไม่สำเร็จ" });
  }
});

module.exports = router;