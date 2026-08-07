// routes/export.js
// -----------------------------------------------------------------
// Export endpoints สำหรับหน้าแอดมิน (ประวัติยืม-คืน) — เอาไว้ให้แอดมิน
// กดดาวน์โหลดรายงานเป็นไฟล์ ไม่ใช่ดูในตารางบนเว็บอย่างเดียว
//
// Task 7a: route wiring + CSV (ไม่มี dependency เพิ่ม)
// Task 7b: DOCX export (ไฟล์นี้ — ใช้ `docx` npm package, ต้อง
// `npm install docx` ก่อนรัน) — ใช้ query logic เดียวกับ CSV ผ่าน
// fetchHistoryForExport() ร่วมกัน ไม่ duplicate การดึงข้อมูล
//
// Auth: mount แบบเดียวกับ admin_keys.js/admin_rooms.js (requireAuth +
// requireRole("admin") ที่จุด mount ใน server.js) — ไฟล์นี้เองไม่เช็ค
// auth ซ้ำ เหมือนไฟล์ route แอดมินอื่นๆ ทั้งหมดในระบบนี้
//
// Query params รองรับ (ใช้ชุดเดียวกับ GET /api/admin/keys/history ใน
// admin_keys.js เพื่อให้ปุ่ม export บนหน้าแอดมินส่ง filter ปัจจุบันของ
// ตารางที่กำลังดูอยู่ตรงๆ ได้เลย ไม่ต้อง map ชื่อ param ใหม่):
//   roomTagId, teacherId, action ("borrow"|"return"), limit (default 100, max 500)
//   format ("csv" | "docx", default "csv")
// -----------------------------------------------------------------

const express = require("express");
const router = express.Router();
const supabase = require("../config/supabaseClient");
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  HeadingLevel,
} = require("docx");

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
// formatDateTimeTh(iso) -> string
// จัดรูปแบบวันเวลาแบบไทยสำหรับ DOCX (CSV ปล่อยเป็น ISO ดิบๆ ไว้ให้
// Excel/สเปรดชีตแปลงเอง แต่ DOCX เป็นเอกสารอ่านเลย จึงจัดให้อ่านง่าย
// ตรงนี้แทน) — ถ้า parse ไม่ได้ (ค่าว่าง/ผิดรูปแบบ) คืนสตริงเดิมไว้
// เฉยๆ ไม่ throw เพื่อไม่ให้แถวเดียวที่ข้อมูลเพี้ยนทำให้ export ทั้งไฟล์พัง
// -------------------------------------------------------------
function formatDateTimeTh(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("th-TH", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch (e) {
    return String(iso);
  }
}

// -------------------------------------------------------------
// docxHeaderCell(text) / docxBodyCell(text) -> TableCell
// สร้าง cell ของตาราง DOCX — แยกฟังก์ชัน header/body เพราะ header
// ต้องตัวหนา + พื้นหลังเทาอ่อน ส่วน body เป็นข้อความปกติ ใช้ร่วมกันทุก
// แถวเพื่อไม่ให้ style ของแต่ละ cell เพี้ยนไปมาระหว่างแถว
// -------------------------------------------------------------
function docxHeaderCell(text) {
  return new TableCell({
    width: { size: 20, type: WidthType.PERCENTAGE },
    shading: { fill: "E8E8E8" },
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: true, size: 20 })],
      }),
    ],
  });
}

function docxBodyCell(text) {
  return new TableCell({
    width: { size: 20, type: WidthType.PERCENTAGE },
    children: [
      new Paragraph({
        children: [new TextRun({ text: text || "-", size: 20 })],
      }),
    ],
  });
}

// -------------------------------------------------------------
// buildDocx(rows) -> Promise<Buffer>
// เอกสาร Word: หัวเรื่อง + วันที่สร้างรายงาน + ตาราง 5 คอลัมน์เดียวกับ
// CSV (วันเวลา, ห้อง/กุญแจ, ครู, แผนก, การกระทำ) คืนเป็น Buffer พร้อม
// ส่งเป็น response body ตรงๆ (Packer.toBuffer ทำงานฝั่ง Node ได้เลย
// ไม่ต้องผ่าน Blob/browser API)
// -------------------------------------------------------------
async function buildDocx(rows) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: CSV_HEADERS.map(docxHeaderCell),
  });

  const bodyRows = rows.map((row) => {
    const roomName = row.room_tags ? row.room_tags.room_name : "";
    const teacherName = row.teachers ? row.teachers.name : "";
    const teacherDept = row.teachers ? row.teachers.department || "" : "";

    return new TableRow({
      children: [
        docxBodyCell(formatDateTimeTh(row.acted_at)),
        docxBodyCell(roomName),
        docxBodyCell(teacherName),
        docxBodyCell(teacherDept),
        docxBodyCell(actionLabelTh(row.action)),
      ],
    });
  });

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...bodyRows],
  });

  const generatedAtLine = new Paragraph({
    children: [
      new TextRun({
        text: `สร้างรายงานเมื่อ: ${formatDateTimeTh(new Date().toISOString())}`,
        size: 20,
        color: "666666",
      }),
    ],
    spacing: { after: 200 },
  });

  const emptyNote =
    rows.length === 0
      ? [
          new Paragraph({
            children: [
              new TextRun({ text: "ไม่พบข้อมูลตามเงื่อนไขที่เลือก", italics: true }),
            ],
            spacing: { before: 200 },
          }),
        ]
      : [];

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.LEFT,
            children: [new TextRun({ text: "ประวัติการยืม-คืนกุญแจ" })],
            spacing: { after: 100 },
          }),
          generatedAtLine,
          table,
          ...emptyNote,
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

// -------------------------------------------------------------
// GET /api/admin/keys/history/export?format=csv|docx
// query params: roomTagId, teacherId, action, limit (เหมือน
// /api/admin/keys/history) + format ("csv" default, หรือ "docx")
// -------------------------------------------------------------
router.get("/keys/history/export", async (req, res) => {
  const { format, roomTagId, teacherId, action, limit } = req.query;

  const fmt = (format || "csv").toString().toLowerCase();

  if (fmt !== "csv" && fmt !== "docx") {
    return res.status(400).json({
      ok: false,
      message: `รูปแบบไฟล์ "${fmt}" ยังไม่รองรับ (รองรับ: csv, docx)`,
    });
  }

  try {
    const rows = await fetchHistoryForExport({ roomTagId, teacherId, action, limit });
    const dateStamp = new Date().toISOString().slice(0, 10);

    if (fmt === "docx") {
      const buffer = await buildDocx(rows);
      const filename = `key-history-${dateStamp}.docx`;

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(buffer);
    }

    const csv = buildCsv(rows);
    const filename = `key-history-${dateStamp}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (err) {
    console.error(`Export history ${fmt.toUpperCase()} error:`, err.message);
    return res.status(500).json({
      ok: false,
      message: "ส่งออกประวัติยืม-คืนไม่สำเร็จ",
    });
  }
});

module.exports = router;