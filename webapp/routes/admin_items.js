// routes/admin_items.js
// -----------------------------------------------------------------
// เฉพาะส่วน "ของที่ยืมได้ในแต่ละห้อง" (room_items) สำหรับหน้า admin
// แยกจาก admin_rooms.js (จัดการห้อง) เพื่อรีวิวทีละก้อนได้ง่าย
//
// หมายเหตุสำคัญ: route นี้ไม่อนุญาตให้แอดมินแก้ status/borrowed_by ตรงๆ
// เพราะสถานะ available/borrowed ต้องเปลี่ยนผ่าน flow ยืม-คืนจริง
// (transactions) เท่านั้น ไม่ใช่ให้แอดมินไปแก้มือ — กันข้อมูลเพี้ยน
// (เช่นตั้งเป็น borrowed แต่ไม่มี borrowed_by จริง)
// -----------------------------------------------------------------

const express = require("express");
const router = express.Router();
const supabase = require("../config/supabaseClient");

// -------------------------------------------------------------
// GET /api/admin/items
// ดึงของทั้งหมด พร้อมชื่อห้องที่สังกัด (join room_tags)
// query param ?roomTagId=xx กรองเฉพาะห้องเดียวได้ (ไม่บังคับ)
// -------------------------------------------------------------
router.get("/items", async (req, res) => {
  const { roomTagId } = req.query;

  try {
    let query = supabase
      .from("room_items")
      .select("*, room_tags(id, room_name)")
      .order("id", { ascending: true });

    if (roomTagId) {
      query = query.eq("room_tag_id", roomTagId);
    }

    const { data, error } = await query;

    if (error) throw error;

    return res.json({ ok: true, items: data });
  } catch (err) {
    console.error("Admin list items error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "ดึงรายการของไม่สำเร็จ",
    });
  }
});

// -------------------------------------------------------------
// POST /api/admin/items
// body: { roomTagId, itemName }
// สร้างของใหม่ในห้อง — สถานะเริ่มต้นเป็น available เสมอ
// -------------------------------------------------------------
router.post("/items", async (req, res) => {
  const { roomTagId, itemName } = req.body;

  if (!roomTagId || !itemName || !itemName.trim()) {
    return res.status(400).json({ ok: false, message: "กรุณาเลือกห้องและกรอกชื่อของ" });
  }

  try {
    // เช็คว่าห้องนี้มีอยู่จริงก่อน จะได้ error message ที่เข้าใจง่ายกว่าปล่อยให้ FK พังเฉยๆ
    const { data: roomExists, error: roomFindError } = await supabase
      .from("room_tags")
      .select("id")
      .eq("id", roomTagId)
      .maybeSingle();

    if (roomFindError) throw roomFindError;

    if (!roomExists) {
      return res.status(404).json({ ok: false, message: "ไม่พบห้อง/กุญแจที่เลือก" });
    }

    const { data: created, error: insertError } = await supabase
      .from("room_items")
      .insert({
        room_tag_id: roomTagId,
        item_name: itemName.trim(),
        status: "available",
      })
      .select("*, room_tags(id, room_name)")
      .single();

    if (insertError) throw insertError;

    return res.json({ ok: true, item: created });
  } catch (err) {
    console.error("Admin create item error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "เพิ่มของไม่สำเร็จ",
    });
  }
});

// -------------------------------------------------------------
// PATCH /api/admin/items/:id
// body: { itemName, roomTagId } — แก้ชื่อของ หรือย้ายของไปอีกห้องได้
// (ตั้งใจไม่รับ status/borrowed_by ตรงนี้ ดูเหตุผลด้านบนของไฟล์)
// -------------------------------------------------------------
router.patch("/items/:id", async (req, res) => {
  const { id } = req.params;
  const { itemName, roomTagId } = req.body;

  const updatePayload = {};
  if (itemName !== undefined) updatePayload.item_name = itemName.trim();
  if (roomTagId !== undefined) updatePayload.room_tag_id = roomTagId;

  if (Object.keys(updatePayload).length === 0) {
    return res.status(400).json({ ok: false, message: "ไม่มีข้อมูลให้แก้ไข" });
  }

  try {
    // เช็คก่อนว่าของชิ้นนี้ borrowed อยู่หรือเปล่า — ถ้ากำลังถูกยืมอยู่
    // ไม่ควรให้ย้ายห้องกลางคัน (จะทำให้ FK ห้อง กับสถานะยืมค้างขัดแย้งกัน)
    if (updatePayload.room_tag_id !== undefined) {
      const { data: currentItem, error: findError } = await supabase
        .from("room_items")
        .select("status")
        .eq("id", id)
        .maybeSingle();

      if (findError) throw findError;

      if (!currentItem) {
        return res.status(404).json({ ok: false, message: "ไม่พบของชิ้นนี้" });
      }

      if (currentItem.status === "borrowed") {
        return res.status(409).json({
          ok: false,
          message: "ของชิ้นนี้กำลังถูกยืมอยู่ ย้ายห้องไม่ได้จนกว่าจะคืนก่อน",
        });
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from("room_items")
      .update(updatePayload)
      .eq("id", id)
      .select("*, room_tags(id, room_name)")
      .single();

    if (updateError) throw updateError;

    if (!updated) {
      return res.status(404).json({ ok: false, message: "ไม่พบของชิ้นนี้" });
    }

    return res.json({ ok: true, item: updated });
  } catch (err) {
    console.error("Admin update item error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "แก้ไขของไม่สำเร็จ",
    });
  }
});

// -------------------------------------------------------------
// DELETE /api/admin/items/:id
// ลบของออกจากระบบ — กันไว้ไม่ให้ลบของที่กำลังถูกยืมอยู่ (ต้องคืนก่อน)
// -------------------------------------------------------------
router.delete("/items/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const { data: currentItem, error: findError } = await supabase
      .from("room_items")
      .select("status")
      .eq("id", id)
      .maybeSingle();

    if (findError) throw findError;

    if (!currentItem) {
      return res.status(404).json({ ok: false, message: "ไม่พบของชิ้นนี้" });
    }

    if (currentItem.status === "borrowed") {
      return res.status(409).json({
        ok: false,
        message: "ของชิ้นนี้กำลังถูกยืมอยู่ ลบไม่ได้จนกว่าจะคืนก่อน",
      });
    }

    const { error: deleteError } = await supabase.from("room_items").delete().eq("id", id);

    if (deleteError) throw deleteError;

    return res.json({ ok: true });
  } catch (err) {
    console.error("Admin delete item error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "ลบของไม่สำเร็จ",
    });
  }
});

module.exports = router;
