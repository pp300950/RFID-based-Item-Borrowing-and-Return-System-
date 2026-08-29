// services/overdue_checker.js
// -----------------------------------------------------------------
// ฟังก์ชันหลักที่ cron (ตั้งใน server.js) เรียกทุก 15-30 นาที เพื่อหา
// กุญแจที่ "เกินเวลาคืน" แล้วยังไม่เคยแจ้งเตือนของวันนี้ -> ส่ง LINE
// เข้ากลุ่ม ทีละคน/ทีละดอก แล้ว mark ว่าแจ้งของวันนี้ไปแล้ว
//
// กติกา "เกินเวลาคืน" (ตามที่ตกลงกัน):
//   - ใช้ room_tags.borrow_window_end เป็นเวลาที่ต้อง "คืนภายใน" ของ
//     วันนั้น — ห้องไหนไม่ได้ตั้ง borrow_window_end ไว้ (NULL) = ไม่มี
//     แนวคิดเรื่อง "เกินเวลา" เลย ข้ามห้องนั้นไปเสมอ ไม่ต้องเช็ค/แจ้ง
//   - ห้องที่ status = 'borrowed' อยู่ และเวลาปัจจุบัน (เทียบเป็น
//     "HH:MM:SS" แบบเดียวกับ isWithinBorrowWindow ใน tap.js) มากกว่า
//     borrow_window_end ของห้องนั้น = ถือว่าเกินเวลาแล้ว
//   - แจ้งได้ "1 ครั้งต่อการยืม 1 ครั้ง ต่อวัน" เท่านั้น — เช็คจาก
//     key_logs แถว action='borrow' ล่าสุดของห้องนั้นที่ยังไม่มีคู่
//     'return' ตามมา (แถวการยืมที่ "ยังเปิดอยู่") ถ้า
//     overdue_notified_date ของแถวนั้น = วันนี้ (CURDATE()) แล้ว ให้ข้าม
//     ไม่แจ้งซ้ำ ถ้าเป็นวันอื่น (หรือ NULL) แจ้งได้แล้วอัปเดตเป็นวันนี้
//
// หมายเหตุเรื่องข้ามเที่ยงคืน: ฟังก์ชันนี้ไม่จัดการกรณี
// borrow_window_end ข้ามเที่ยงคืน (เช่น 22:00 ของแผน "อนุญาตยืมข้ามคืน")
// เพราะแนวคิด "เกินเวลาคืนภายในวันนี้" กับ "ช่วงเวลาที่อนุญาตยืมข้ามคืน"
// เป็นคนละเรื่องกัน — ถ้าห้องไหนตั้ง window แบบข้ามเที่ยงคืนจริงๆ และ
// อยากได้พฤติกรรม due-time ที่ต่างจากนี้ ต้องออกแบบเพิ่มเป็นกรณีพิเศษ
// ในอนาคต (ตอนนี้ยังไม่มีการ์ดเคสนี้ในระบบเดิม)
// -----------------------------------------------------------------

const { query } = require("../config/db");
const { sendGroupMessage, buildOverdueMessage } = require("./line_notify");

function pad2(n) {
  return String(n).padStart(2, "0");
}

function currentTimeStr() {
  const now = new Date();
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
}

// -------------------------------------------------------------
// findOverdueBorrows() -> Promise<Array<{ logId, roomTagId, roomName,
//   teacherName, borrowWindowEnd }>>
//
// ดึงห้องที่ status='borrowed' + มี borrow_window_end + เวลาปัจจุบัน
// เกินไปแล้ว พร้อม JOIN เอาแถว key_logs (การยืมล่าสุดที่ยังไม่มีคืน)
// และชื่อครูผู้ยืมมาด้วยในคำสั่งเดียว
//
// เงื่อนไข "แถวการยืมที่ยังเปิดอยู่" ใช้วิธีหาแถว key_logs ล่าสุด
// (สูงสุด ตาม id) ของห้องนั้นที่ action='borrow' — เพราะ room_tags
// รับประกันอยู่แล้วว่าถ้า status='borrowed' แปลว่าแถว borrow ล่าสุด
// ของห้องนั้นคือแถวที่ "ยังไม่ถูกคืน" (ตรรกะเดียวกับที่ tap.js ใช้คุม
// สถานะอยู่แล้ว ไม่มีทางมีแถว borrow ค้างซ้อนกันสองแถวโดยไม่มี return
// คั่นกลาง เพราะ tap.js บล็อกการยืมซ้ำห้องที่ borrowed อยู่แล้ว)
// -------------------------------------------------------------
async function findOverdueBorrows() {
  const nowTimeStr = currentTimeStr();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(
    today.getDate()
  )}`;

  const [rows] = await query(
    `
    SELECT
      kl.id AS log_id,
      kl.overdue_notified_date,
      rt.id AS room_tag_id,
      rt.room_name,
      rt.borrow_window_end,
      t.name AS teacher_name
    FROM room_tags rt
    INNER JOIN teachers t ON t.id = rt.borrowed_by_teacher_id
    INNER JOIN key_logs kl ON kl.id = (
      SELECT kl2.id
      FROM key_logs kl2
      WHERE kl2.room_tag_id = rt.id AND kl2.action = 'borrow'
      ORDER BY kl2.id DESC
      LIMIT 1
    )
    WHERE rt.status = 'borrowed'
      AND rt.borrow_window_end IS NOT NULL
      AND ? > rt.borrow_window_end
      AND (kl.overdue_notified_date IS NULL OR kl.overdue_notified_date <> ?)
    `,
    [nowTimeStr, todayStr]
  );

  return rows.map((row) => ({
    logId: row.log_id,
    roomTagId: row.room_tag_id,
    roomName: row.room_name,
    teacherName: row.teacher_name,
    borrowWindowEnd: row.borrow_window_end,
  }));
}

// -------------------------------------------------------------
// markNotifiedToday(logId) — mark ว่าแถวการยืมนี้แจ้งเตือนของวันนี้
// ไปแล้ว กันไม่ให้รอบ cron ถัดไป (อีก 15-30 นาที) แจ้งซ้ำวันเดียวกัน
// -------------------------------------------------------------
async function markNotifiedToday(logId) {
  await query(
    `UPDATE key_logs SET overdue_notified_date = CURDATE() WHERE id = ?`,
    [logId]
  );
}

// -------------------------------------------------------------
// runOverdueCheck() — entry point ที่ cron เรียก
// ส่งทีละข้อความต่อกุญแจ 1 ดอก (ไม่รวมหลายห้องเป็นข้อความเดียว) ตามที่
// ตกลงกันว่าอยากได้ "อาจารย์ท่านนี้...ห้องนี้..." แยกทีละรายการชัดเจน
// -------------------------------------------------------------
async function runOverdueCheck() {
  let overdueList;
  try {
    overdueList = await findOverdueBorrows();
  } catch (err) {
    console.error("runOverdueCheck: query หากุญแจเกินเวลาไม่สำเร็จ:", err.message);
    return;
  }

  if (overdueList.length === 0) {
    return; // ไม่มีอะไรต้องแจ้ง — เงียบๆ ไม่ต้อง log ทุกรอบให้ log รก
  }

  console.log(`[overdue_checker] พบกุญแจเกินเวลาคืน ${overdueList.length} รายการ`);

  for (const item of overdueList) {
    const text = buildOverdueMessage({
      teacherName: item.teacherName,
      roomName: item.roomName,
      dueTime: item.borrowWindowEnd,
    });

    const result = await sendGroupMessage(text);

    if (result.ok) {
      // mark แจ้งแล้วเฉพาะตอนส่งสำเร็จ — ถ้าส่งไม่สำเร็จ (เช่น LINE
      // ล่มชั่วคราว) ปล่อยให้ overdue_notified_date เป็น NULL/วันเก่า
      // ต่อไป เพื่อให้รอบ cron ถัดไปลองส่งใหม่อีกครั้งแทนที่จะเงียบไปเลย
      await markNotifiedToday(item.logId).catch((err) =>
        console.error(
          `runOverdueCheck: mark overdue_notified_date ไม่สำเร็จ (log_id=${item.logId}):`,
          err.message
        )
      );
      console.log(
        `[overdue_checker] แจ้งเตือนแล้ว: ครู ${item.teacherName} / ห้อง "${item.roomName}"`
      );
    } else {
      console.error(
        `[overdue_checker] ส่งแจ้งเตือนไม่สำเร็จ (ครู ${item.teacherName} / ห้อง "${item.roomName}"): ${result.message}`
      );
    }
  }
}

module.exports = { runOverdueCheck, findOverdueBorrows };
