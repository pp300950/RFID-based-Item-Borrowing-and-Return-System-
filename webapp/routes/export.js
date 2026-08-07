// routes/export.js
// -----------------------------------------------------------------
// Export endpoints สำหรับหน้าแอดมิน (ประวัติยืม-คืน) — เอาไว้ให้แอดมิน
// กดดาวน์โหลดรายงานเป็นไฟล์ ไม่ใช่ดูในตารางบนเว็บอย่างเดียว
//
// Task 7a (นี้): route wiring + CSV เท่านั้น ไม่มี dependency เพิ่ม
// Task 7b (ทีหลัง): เพิ่ม DOCX export ในไฟล์เดียวกันนี้ (ใช้ `docx` npm
// package) — โครง route/query ด้านล่างออกแบบให้ query logic ใช้ร่วมกัน
// ได้ระหว่างสอง format โดยไม่ต้อง duplicate
//
// Auth: mount แบบเดียวกับ admin_keys.js/admin_rooms.js (requireAuth +
// requireRole("admin") ที่จุด mount ใน server.js) — ไฟล์นี้เองไม่เช็ค
// auth ซ้ำ เหมือนไฟล์ route แอดมินอื่นๆ ทั้งหมดในระบบนี้
//
// Query params รองรับ (ใช้ชุดเดียวกับ GET /api/admin/keys/history ใน
// admin_keys.js เพื่อให้ปุ่ม export บนหน้าแอดมินส่ง filter ปัจจุบันของ
// ตารางที่กำลังดูอยู่ตรงๆ ได้เลย ไม่ต้อง map ชื่อ param ใหม่):
//   roomTagId, teacherId, action ("borrow"|"return"), limit (default 100, max 500)
// -----------------------------------------------------------------

const express = require("express");
const router = express.Router();
const supabase = require("../config/supabaseClient");

const EXPORT_LIMIT_DEFAULT = 100;
const EXPORT_LIMIT_MAX = 500;

// -------------------------------------------------------------
// fetchHistoryForExport(query) -> Promise<Array<row>>
// ดึงข้อมูล key_logs ตาม filter เดียวกับ GET /api/admin/keys/history
// (admin_keys.js) แยกออกมาเป็นฟังก์ชันกลางที่นี่ เพื่อให้ทั้ง CSV (7a)
// และ DOCX (7b) เรียกใช้ query เดียวกันได้ ไม่ต้อง copy-paste ซ้ำสอง
// รูปแบบ — ไม่ได้ import จาก admin_keys.js ตรงๆ เพราะไฟล์นั้น export
// แค่ router ไม่ได้ export ฟังก์ชัน query แยก และไม่อยากแก้ shape ของ
// ไฟล์นั้นแค่เพื่อ export ไฟล์นี้
// -------------------------------------------------------------
async function fetchHistoryForExport({ roomTagId, teacherId, action, limit }) {
  const parsedLimit = Math.min(parseInt(limit, 10) || EXPORT_LIMIT_DEFAULT, EXPORT_LIMIT_MAX);

  let query = supabase
    .from("key_logs")
    .select(
      "id, action, acted_at, room_tags(id, room_name), teachers(id, name, department)"
    )
    .order("acted_at", { ascending: false })
    .limit(parsedLimit);

  if (roomTagId) query = query.eq("room_tag_id", roomTagId);
  if (teacherId) query = query.eq("teacher_id", teacherId);
  if (action === "borrow" || action === "return") query = query.eq("action", action);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// -------------------------------------------------------------
// csvEscapeField(value) -> string
// ครอบ field ด้วย "..." เสมอถ้ามี comma / quote / newline อยู่ข้างใน
// (RFC 4180 แบบง่าย) — quote ตัวเองในสตริงต้อง escape เป็น "" คู่
// -------------------------------------------------------------
function csvEscapeField(value) {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function actionLabelTh(action) {
  return action === "borrow" ? "ยืม" : action === "return" ? "คืน" : action;
}

// -------------------------------------------------------------
// buildCsv(rows) -> string
// คอลัมน์: วันเวลา, ห้อง/กุญแจ, ครู, แผนก, การกระทำ
// ใส่ UTF-8 BOM นำหน้า เพื่อให้ Excel (โดยเฉพาะ Excel บน Windows ที่
// คนไทยส่วนใหญ่ใช้เปิดไฟล์นี้) แสดงภาษาไทยถูกต้อง ไม่กลายเป็นตัวอักษร
// เพี้ยนตอนเปิดไฟล์ตรงๆ โดยไม่ผ่าน import wizard
// -------------------------------------------------------------
const CSV_BOM = "\uFEFF";
const CSV_HEADERS = ["วันเวลา", "ห้อง/กุญแจ", "ครู", "แผนก", "การกระทำ"];

function buildCsv(rows) {
  const lines = [CSV_HEADERS.map(csvEscapeField).join(",")];

  for (const row of rows) {
    const roomName = row.room_tags ? row.room_tags.room_name : "";
    const teacherName = row.teachers ? row.teachers.name : "";
    const teacherDept = row.teachers ? row.teachers.department || "" : "";

    lines.push(
      [
        row.acted_at,
        roomName,
        teacherName,
        teacherDept,
        actionLabelTh(row.action),
      ]
        .map(csvEscapeField)
        .join(",")
    );
  }

  return CSV_BOM + lines.join("\r\n");
}

// -------------------------------------------------------------
// GET /api/admin/keys/history/export?format=csv
// query params: roomTagId, teacherId, action, limit (เหมือน
// /api/admin/keys/history) + format ("csv" เท่านั้นใน 7a — "docx" มา
// ใน 7b)
// -------------------------------------------------------------
router.get("/keys/history/export", async (req, res) => {
  const { format, roomTagId, teacherId, action, limit } = req.query;

  const fmt = (format || "csv").toString().toLowerCase();

  if (fmt !== "csv") {
    // 7b จะเพิ่ม case "docx" ตรงนี้ — ตอนนี้รองรับแค่ csv
    return res.status(400).json({
      ok: false,
      message: `รูปแบบไฟล์ "${fmt}" ยังไม่รองรับ (รองรับ: csv)`,
    });
  }

  try {
    const rows = await fetchHistoryForExport({ roomTagId, teacherId, action, limit });
    const csv = buildCsv(rows);

    const filename = `key-history-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (err) {
    console.error("Export history CSV error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "ส่งออกประวัติยืม-คืนไม่สำเร็จ",
    });
  }
});

module.exports = router;
