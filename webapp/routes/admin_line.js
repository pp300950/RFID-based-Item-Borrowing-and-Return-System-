// routes/admin_line.js
// -----------------------------------------------------------------
// Endpoint สำหรับแอดมินเช็คสถานะการแจ้งเตือน LINE — mount ผ่านกลุ่ม
// requireAuth + requireRole("admin") เดียวกับ route แอดมินอื่นๆ ใน
// server.js (ไม่ต้องเช็ค auth ซ้ำในไฟล์นี้)
//
// GET  /api/admin/line/quota    เช็คโควต้าข้อความ LINE OA เดือนนี้
// GET  /api/admin/line/targets  ดูรายการกลุ่มที่บันทึกไว้ (จาก webhook)
// POST /api/admin/line/test     ส่งข้อความทดสอบเข้ากลุ่มปัจจุบัน (debug)
// -----------------------------------------------------------------

const express = require("express");
const router = express.Router();
const { query } = require("../config/db");
const { getMessageQuota, sendGroupMessage, resolveTargetId } = require("../services/line_notify");

// -------------------------------------------------------------
// GET /api/admin/line/quota
// เช็คโควต้าข้อความ push/broadcast รายเดือนของ LINE OA (แผนฟรีจำกัด
// จำนวนข้อความ) — เอาไว้ดูก่อนว่าใกล้เต็มโควต้าหรือยัง
// -------------------------------------------------------------
router.get("/line/quota", async (req, res) => {
  const result = await getMessageQuota();
  if (!result.ok) {
    return res.status(502).json({ ok: false, message: result.message });
  }
  return res.json({
    ok: true,
    type: result.type, // "limited" | "none"
    limit: result.limit, // จำนวนเต็มที่ได้ต่อเดือน (null ถ้าไม่จำกัด)
    used: result.used, // ใช้ไปแล้วเดือนนี้
    remaining: result.remaining, // เหลือเท่าไร (null ถ้าไม่จำกัด)
  });
});

// -------------------------------------------------------------
// GET /api/admin/line/targets
// ดูรายการกลุ่ม LINE ที่ระบบรู้จัก (บันทึกจาก webhook ตอนเชิญบอทเข้า
// กลุ่ม) เพื่อเช็คว่ากลุ่มไหน active อยู่บ้าง
// -------------------------------------------------------------
router.get("/line/targets", async (req, res) => {
  try {
    const [rows] = await query(
      `SELECT id, target_type, target_id, label, is_active, created_at
       FROM line_targets ORDER BY id DESC`
    );
    const currentTargetId = await resolveTargetId();
    return res.json({ ok: true, targets: rows, currentTargetId });
  } catch (err) {
    console.error("GET /admin/line/targets error:", err.message);
    return res.status(500).json({ ok: false, message: "ดึงรายการกลุ่มไม่สำเร็จ" });
  }
});

// -------------------------------------------------------------
// POST /api/admin/line/test
// ส่งข้อความทดสอบเข้ากลุ่มเป้าหมายปัจจุบัน — ใช้ตอน setup ครั้งแรกเพื่อ
// เช็คว่า token/group id ถูกต้องจริง ก่อนไปรอ flow ยืม-คืนจริง
// -------------------------------------------------------------
router.post("/line/test", async (req, res) => {
  const text = (req.body && req.body.text) || "✅ ทดสอบการแจ้งเตือนจากระบบยืม-คืนกุญแจ";
  const result = await sendGroupMessage(text);
  if (!result.ok) {
    return res.status(502).json({ ok: false, message: result.message });
  }
  return res.json({ ok: true, message: "ส่งข้อความทดสอบสำเร็จ" });
});

module.exports = router;
