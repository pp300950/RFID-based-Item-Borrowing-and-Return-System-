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
// -----------------------------------------------------------------

const express = require("express");
const router = express.Router();
const supabase = require("../config/supabaseClient");

// -------------------------------------------------------------
// GET /api/admin/rooms
// ดึงรายการห้อง/กุญแจทั้งหมด เรียงตามชื่อห้อง
// -------------------------------------------------------------
router.get("/rooms", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("room_tags")
      .select("*")
      .order("room_name", { ascending: true });

    if (error) throw error;

    return res.json({ ok: true, rooms: data });
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
// body: { roomName, tagUid (ไม่บังคับ), description (ไม่บังคับ) }
// สร้างห้อง/กุญแจใหม่ — tagUid เว้นว่างได้ เผื่อยังไม่มีแท็กจริงมาผูก
// -------------------------------------------------------------
router.post("/rooms", async (req, res) => {
  const { roomName, tagUid, description } = req.body;

  if (!roomName || !roomName.trim()) {
    return res.status(400).json({ ok: false, message: "กรุณากรอกชื่อห้อง/กุญแจ" });
  }

  try {
    // ถ้ามีการกรอก tagUid มา เช็คซ้ำก่อน (เพราะ unique constraint จะ error
    // แบบไม่ friendly ถ้าไม่เช็คเอง)
    if (tagUid && tagUid.trim()) {
      const { data: existing, error: findError } = await supabase
        .from("room_tags")
        .select("id")
        .eq("tag_uid", tagUid.trim())
        .maybeSingle();

      if (findError) throw findError;

      if (existing) {
        return res.status(409).json({
          ok: false,
          message: "เลขแท็กนี้ถูกผูกกับห้อง/กุญแจอื่นไปแล้ว",
        });
      }
    }

    const { data: created, error: insertError } = await supabase
      .from("room_tags")
      .insert({
        room_name: roomName.trim(),
        tag_uid: tagUid && tagUid.trim() ? tagUid.trim() : null,
        description: description ? description.trim() : null,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return res.json({ ok: true, room: created });
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
// body: { roomName, tagUid, description, isActive } — ส่งเฉพาะฟิลด์ที่จะแก้ก็ได้
// ใช้แก้ข้อมูลห้อง หรือผูก/เปลี่ยนเลขแท็กจริงทีหลังได้จากจุดนี้
// -------------------------------------------------------------
router.patch("/rooms/:id", async (req, res) => {
  const { id } = req.params;
  const { roomName, tagUid, description, isActive } = req.body;

  const updatePayload = {};
  if (roomName !== undefined) updatePayload.room_name = roomName.trim();
  if (tagUid !== undefined) updatePayload.tag_uid = tagUid && tagUid.trim() ? tagUid.trim() : null;
  if (description !== undefined) updatePayload.description = description ? description.trim() : null;
  if (isActive !== undefined) updatePayload.is_active = !!isActive;

  if (Object.keys(updatePayload).length === 0) {
    return res.status(400).json({ ok: false, message: "ไม่มีข้อมูลให้แก้ไข" });
  }

  try {
    if (updatePayload.tag_uid) {
      const { data: existing, error: findError } = await supabase
        .from("room_tags")
        .select("id")
        .eq("tag_uid", updatePayload.tag_uid)
        .neq("id", id)
        .maybeSingle();

      if (findError) throw findError;

      if (existing) {
        return res.status(409).json({
          ok: false,
          message: "เลขแท็กนี้ถูกผูกกับห้อง/กุญแจอื่นไปแล้ว",
        });
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from("room_tags")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (updateError) throw updateError;

    if (!updated) {
      return res.status(404).json({ ok: false, message: "ไม่พบห้อง/กุญแจนี้" });
    }

    return res.json({ ok: true, room: updated });
  } catch (err) {
    console.error("Admin update room error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "แก้ไขห้อง/กุญแจไม่สำเร็จ",
    });
  }
});

// -------------------------------------------------------------
// DELETE /api/admin/rooms/:id
// ลบห้อง/กุญแจ — จะพ่วงลบ room_items และ teacher_room_assignments
// ของห้องนี้ไปด้วยอัตโนมัติ (on delete cascade ตาม schema)
// -------------------------------------------------------------
router.delete("/rooms/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const { error } = await supabase.from("room_tags").delete().eq("id", id);

    if (error) throw error;

    return res.json({ ok: true });
  } catch (err) {
    console.error("Admin delete room error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "ลบห้อง/กุญแจไม่สำเร็จ",
    });
  }
});

module.exports = router;