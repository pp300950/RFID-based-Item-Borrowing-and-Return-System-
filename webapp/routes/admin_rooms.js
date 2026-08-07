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
const multer = require("multer");
const router = express.Router();
const supabase = require("../config/supabaseClient");

// -------------------------------------------------------------
// multer: เก็บไฟล์ไว้ใน memory (buffer) แล้วค่อยส่งต่อให้ Supabase
// Storage เอง ไม่เขียนลงดิสก์ของ server ก่อน — เหมาะกับไฟล์เล็กๆ
// แบบรูปห้อง ไม่ต้องพึ่ง disk storage ชั่วคราว
// จำกัดขนาด 5MB และรับเฉพาะไฟล์ที่ mimetype เป็นรูปภาพเท่านั้น
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

const ROOM_IMAGES_BUCKET = "room-images";

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
        ...windowResult.value,
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
// POST /api/admin/rooms/:id/image
// multipart/form-data field name: "image"
// อัปโหลดรูปห้องไป Supabase Storage bucket "room-images" แล้วบันทึก
// public URL กลับเข้า room_tags.image_url ของห้องนั้น
//
// ตั้งชื่อไฟล์แบบ room-<id>-<timestamp>.<ext> กันชื่อไฟล์ชนกันเวลา
// อัปโหลดซ้ำ/แก้ไขรูปทีหลัง (ไม่ upsert ทับชื่อเดิม เพื่อไม่ให้ต้อง
// worry เรื่อง cache ของ public URL เดิมค้างที่ฝั่ง browser)
// -------------------------------------------------------------
router.post("/rooms/:id/image", upload.single("image"), async (req, res) => {
  const { id } = req.params;

  if (!req.file) {
    return res.status(400).json({ ok: false, message: "กรุณาเลือกไฟล์รูปภาพ" });
  }

  try {
    // เช็คก่อนว่าห้องนี้มีจริง กัน orphan ไฟล์ใน storage ถ้า id ผิด
    const { data: room, error: findError } = await supabase
      .from("room_tags")
      .select("id, image_url")
      .eq("id", id)
      .maybeSingle();

    if (findError) throw findError;

    if (!room) {
      return res.status(404).json({ ok: false, message: "ไม่พบห้อง/กุญแจนี้" });
    }

    const ext = (req.file.originalname.split(".").pop() || "jpg").toLowerCase();
    const filePath = `room-${id}-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(ROOM_IMAGES_BUCKET)
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage
      .from(ROOM_IMAGES_BUCKET)
      .getPublicUrl(filePath);

    const imageUrl = publicUrlData.publicUrl;

    const { data: updated, error: updateError } = await supabase
      .from("room_tags")
      .update({ image_url: imageUrl })
      .eq("id", id)
      .select()
      .single();

    if (updateError) throw updateError;

    // ลบรูปเก่าทิ้งถ้ามี (best-effort — ไม่ throw ถ้าลบไม่สำเร็จ เพราะ
    // รูปใหม่บันทึกสำเร็จไปแล้ว ไม่อยากให้ request ทั้งเส้นล้มเพราะเรื่องนี้)
    if (room.image_url) {
      const oldPath = room.image_url.split(`${ROOM_IMAGES_BUCKET}/`).pop();
      if (oldPath) {
        supabase.storage
          .from(ROOM_IMAGES_BUCKET)
          .remove([oldPath])
          .catch((cleanupErr) => {
            console.error("Cleanup old room image warning:", cleanupErr.message);
          });
      }
    }

    return res.json({ ok: true, room: updated });
  } catch (err) {
    console.error("Admin upload room image error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "อัปโหลดรูปภาพไม่สำเร็จ",
    });
  }
});

// -------------------------------------------------------------
// POST /api/admin/rooms/:id/images
// multipart/form-data field name: "images" (รับได้หลายไฟล์พร้อมกัน)
// อัปโหลดรูปเข้า Supabase Storage bucket เดียวกับ endpoint เดี่ยวเดิม
// (ROOM_IMAGES_BUCKET) แล้วบันทึกแต่ละไฟล์เป็น 1 แถวใน room_images
// (ตาราง multi-image ใหม่จาก Task 1) แทนที่จะทับ room_tags.image_url
// เดี่ยวเหมือน endpoint เก่า — endpoint เก่ายังอยู่เพื่อ backward compat
// (ดู MANIFEST Task 2b note)
//
// sort_order: ต่อจากรูปที่มากสุดที่มีอยู่แล้วของห้องนั้น (ไม่ใช่เริ่ม
// จาก 0 ใหม่ทุกครั้ง) เพื่อให้รูปที่อัปโหลดใหม่ต่อท้ายลำดับเดิมเสมอ
// จำกัดสูงสุด 10 ไฟล์ต่อ request กันแอดมินลากไฟล์เยอะเกินไปพร้อมกัน
// จนกิน memory ของ server (multer เก็บ buffer ทั้งไฟล์ไว้ใน RAM)
// -------------------------------------------------------------
const MAX_IMAGES_PER_UPLOAD = 10;

router.post("/rooms/:id/images", upload.array("images", MAX_IMAGES_PER_UPLOAD), async (req, res) => {
  const { id } = req.params;

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ ok: false, message: "กรุณาเลือกไฟล์รูปภาพอย่างน้อย 1 ไฟล์" });
  }

  try {
    // เช็คก่อนว่าห้องนี้มีจริง กัน orphan ไฟล์ใน storage ถ้า id ผิด
    const { data: room, error: findError } = await supabase
      .from("room_tags")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (findError) throw findError;

    if (!room) {
      return res.status(404).json({ ok: false, message: "ไม่พบห้อง/กุญแจนี้" });
    }

    // หา sort_order สูงสุดปัจจุบันของห้องนี้ เพื่อต่อท้ายลำดับเดิม
    const { data: maxRow, error: maxError } = await supabase
      .from("room_images")
      .select("sort_order")
      .eq("room_tag_id", id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (maxError) throw maxError;

    let nextSortOrder = maxRow ? maxRow.sort_order + 1 : 0;

    // อัปโหลดไฟล์ทั้งหมดขึ้น Storage ก่อน (เรียงตามลำดับที่ส่งมา ไม่ใช้
    // Promise.all แบบขนาน เพื่อให้ sort_order ที่ได้ตรงกับลำดับไฟล์จริง
    // ที่แอดมินเลือก/ลากมา ไม่สลับกันเพราะ race condition ของการอัปโหลด)
    const uploadedPaths = [];
    const insertedRows = [];

    for (const file of req.files) {
      const ext = (file.originalname.split(".").pop() || "jpg").toLowerCase();
      const filePath = `room-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(ROOM_IMAGES_BUCKET)
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      uploadedPaths.push(filePath);

      const { data: publicUrlData } = supabase.storage
        .from(ROOM_IMAGES_BUCKET)
        .getPublicUrl(filePath);

      insertedRows.push({
        room_tag_id: id,
        image_url: publicUrlData.publicUrl,
        sort_order: nextSortOrder,
      });
      nextSortOrder += 1;
    }

    const { data: created, error: insertError } = await supabase
      .from("room_images")
      .insert(insertedRows)
      .select();

    if (insertError) {
      // insert ลง DB ล้มเหลวหลังอัปโหลดไฟล์สำเร็จไปแล้ว — ลบไฟล์ที่เพิ่ง
      // อัปโหลดทั้งหมดทิ้ง (best-effort) กัน orphan ไฟล์ค้างใน storage
      // โดยไม่มี record อ้างอิงเลย
      supabase.storage
        .from(ROOM_IMAGES_BUCKET)
        .remove(uploadedPaths)
        .catch((cleanupErr) => {
          console.error("Cleanup orphaned room images warning:", cleanupErr.message);
        });
      throw insertError;
    }

    return res.json({ ok: true, images: created });
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
// ลบรูปภาพ 1 รูปออกจาก room_images (และไฟล์จริงใน Storage)
// ไม่แตะ sort_order ของรูปอื่นที่เหลือ — เว้นช่องว่างในลำดับไว้ได้ ฝั่ง
// แสดงผล (frontend) ใช้ ORDER BY sort_order เฉยๆ ไม่ต้องเลขต่อเนื่อง
// -------------------------------------------------------------
router.delete("/rooms/:id/images/:imageId", async (req, res) => {
  const { id, imageId } = req.params;

  try {
    const { data: image, error: findError } = await supabase
      .from("room_images")
      .select("id, image_url")
      .eq("id", imageId)
      .eq("room_tag_id", id)
      .maybeSingle();

    if (findError) throw findError;

    if (!image) {
      return res.status(404).json({ ok: false, message: "ไม่พบรูปภาพนี้" });
    }

    const { error: deleteError } = await supabase
      .from("room_images")
      .delete()
      .eq("id", imageId);

    if (deleteError) throw deleteError;

    // ลบไฟล์จริงออกจาก Storage ด้วย (best-effort — record ใน DB ลบไป
    // แล้วสำเร็จ ไม่อยากให้ request ทั้งเส้นล้มเพราะลบไฟล์ storage ไม่ผ่าน)
    const oldPath = image.image_url.split(`${ROOM_IMAGES_BUCKET}/`).pop();
    if (oldPath) {
      supabase.storage
        .from(ROOM_IMAGES_BUCKET)
        .remove([oldPath])
        .catch((cleanupErr) => {
          console.error("Cleanup deleted room image warning:", cleanupErr.message);
        });
    }

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
    const { data: existingImages, error: findError } = await supabase
      .from("room_images")
      .select("id")
      .eq("room_tag_id", id);

    if (findError) throw findError;

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
      const { data: updated, error: updateError } = await supabase
        .from("room_images")
        .update({ sort_order: index })
        .eq("id", orderIds[index])
        .select()
        .single();

      if (updateError) throw updateError;
      updatedRows.push(updated);
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