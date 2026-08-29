// services/line_notify.js
// -----------------------------------------------------------------
// รวมฟังก์ชันที่คุยกับ LINE Messaging API ทั้งหมดไว้ที่เดียว:
//   - sendGroupMessage(text)   ส่งข้อความ (push) เข้ากลุ่มเป้าหมาย
//   - replyMessage(replyToken, text)  ตอบกลับข้อความที่มีคนพิมพ์มา
//        (ใช้กับฟีเจอร์ "/quota" พิมพ์ในกลุ่มแล้วบอทตอบกลับ)
//   - getMessageQuota()        เช็คโควต้าข้อความรายเดือน + ใช้ไปแล้วเท่าไร
//   - buildBorrowedMessage(...) / buildOverdueMessage(...) /
//     buildServerReadyMessage(...) / buildQuotaReplyMessage(...)
//         ฟังก์ชันช่วยประกอบข้อความให้ข้อความหน้าตาตรงกันทุกจุดที่เรียก
//
// วิธีหา LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET (ครั้งแรก):
//   1. เข้า https://developers.line.biz/console/ (ผูกกับ LINE OA ที่
//      สมัครไว้แล้ว)
//   2. เลือก Provider -> เลือก Channel (ประเภท Messaging API) ถ้ายังไม่มี
//      ให้สร้างใหม่จาก LINE Official Account Manager -> Settings ->
//      Messaging API -> Enable
//   3. แท็บ "Basic settings" จะมี Channel secret -> เอาไปใส่
//      LINE_CHANNEL_SECRET
//   4. แท็บ "Messaging API" เลื่อนลงไปที่ "Channel access token"
//      กด Issue -> เอาไปใส่ LINE_CHANNEL_ACCESS_TOKEN (เป็น long-lived
//      token ใช้ได้ยาวๆ ไม่หมดอายุเร็ว)
//   5. LINE_GROUP_ID ไม่ต้องกรอกมือ — ให้เชิญบอทเข้ากลุ่มแล้วดู log จาก
//      Render (ดู routes/line_webhook.js) ระบบจะ log Group ID ออกมาให้
//      ก็อปไปตั้งเป็น env var นี้ (หรือปล่อยว่างแล้วให้ระบบ auto-save
//      ลงตาราง line_targets ก็ได้ ดูคอมเมนต์ใน line_webhook.js)
//
// หมายเหตุสำคัญ: บอทต้อง "join กลุ่มได้" ก่อน — เปิดที่ LINE Developers
// Console -> Messaging API -> "Allow bot to join group chats" ต้องเป็น
// Enable ไม่งั้นเชิญบอทเข้ากลุ่มไม่ติด (จะถูกเตะออกเองทันที)
// -----------------------------------------------------------------

const LINE_API_BASE = "https://api.line.me/v2/bot";

function getAccessToken() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "ไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN ใน environment variables"
    );
  }
  return token;
}

// -------------------------------------------------------------
// resolveTargetId() -> string | null
// ลำดับความสำคัญ: env LINE_GROUP_ID ก่อน (ตั้งมือ ชัดเจนที่สุด) ถ้าไม่มี
// ค่อย fallback ไปหาแถว is_active=1 ล่าสุดในตาราง line_targets (จาก
// webhook auto-save) — เผื่อกรณีตั้ง env ไม่ทันหรือกลุ่มถูกเปลี่ยน
// -------------------------------------------------------------
async function resolveTargetId() {
  if (process.env.LINE_GROUP_ID && process.env.LINE_GROUP_ID.trim()) {
    return process.env.LINE_GROUP_ID.trim();
  }

  try {
    const { query } = require("../config/db");
    const [rows] = await query(
      `SELECT target_id FROM line_targets WHERE is_active = 1 ORDER BY id DESC LIMIT 1`
    );
    if (rows.length > 0) return rows[0].target_id;
  } catch (err) {
    console.error("resolveTargetId: query line_targets ไม่สำเร็จ:", err.message);
  }

  return null;
}

// -------------------------------------------------------------
// sendGroupMessage(text) -> Promise<{ ok: boolean, message?: string }>
// ส่ง push message ไปยังกลุ่มเป้าหมาย (LINE_GROUP_ID หรือจาก DB)
// ออกแบบให้ "ไม่ throw" ออกไปทำลาย flow หลัก (ยืม/คืน/server start) —
// เรียกแบบ fire-and-forget แล้ว log error เองถ้าพัง
// -------------------------------------------------------------
async function sendGroupMessage(text) {
  try {
    const targetId = await resolveTargetId();
    if (!targetId) {
      console.warn(
        "sendGroupMessage: ยังไม่มี LINE target (LINE_GROUP_ID หรือ line_targets) — ข้ามการส่ง"
      );
      return { ok: false, message: "ยังไม่ได้ตั้งค่ากลุ่มปลายทาง" };
    }

    const token = getAccessToken();

    const resp = await fetch(`${LINE_API_BASE}/message/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: targetId,
        messages: [{ type: "text", text }],
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      console.error(
        `sendGroupMessage: LINE API ตอบ ${resp.status} — ${errBody}`
      );
      return { ok: false, message: `LINE API error ${resp.status}` };
    }

    return { ok: true };
  } catch (err) {
    console.error("sendGroupMessage error:", err.message);
    return { ok: false, message: err.message };
  }
}

// -------------------------------------------------------------
// replyMessage(replyToken, text) -> Promise<{ ok, message? }>
// ตอบกลับข้อความที่มีคนพิมพ์มาในกลุ่ม (ใช้ Reply API ไม่ใช่ Push API)
// ต่างจาก sendGroupMessage ตรงที่ "ไม่เสียโควต้ารายเดือน" (LINE ไม่นับ
// reply message เข้าโควต้า push/broadcast) และต้องใช้ภายใน 1 นาทีนับ
// จากได้รับ event เท่านั้น (replyToken หมดอายุเร็ว) — ใช้กับฟีเจอร์
// พิมพ์ "/quota" ในกลุ่มแล้วบอทตอบกลับทันที
// -------------------------------------------------------------
async function replyMessage(replyToken, text) {
  try {
    const token = getAccessToken();

    const resp = await fetch(`${LINE_API_BASE}/message/reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        replyToken,
        messages: [{ type: "text", text }],
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      console.error(`replyMessage: LINE API ตอบ ${resp.status} — ${errBody}`);
      return { ok: false, message: `LINE API error ${resp.status}` };
    }

    return { ok: true };
  } catch (err) {
    console.error("replyMessage error:", err.message);
    return { ok: false, message: err.message };
  }
}

// -------------------------------------------------------------
// getMessageQuota() -> Promise<{ ok, type?, limit?, used?, remaining? }>
// เช็คโควต้าข้อความรายเดือนของ LINE OA (แผนฟรีจำกัดจำนวนข้อความ push/
// broadcast ต่อเดือน — ปกติ 300 ข้อความ/เดือน) รวม 2 เรียก:
//   GET /message/quota        -> โควต้าทั้งหมดที่ได้ (type, value)
//   GET /message/quota/consumption -> ใช้ไปแล้วเท่าไรในเดือนนี้
// -------------------------------------------------------------
async function getMessageQuota() {
  try {
    const token = getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };

    const [quotaResp, usageResp] = await Promise.all([
      fetch(`${LINE_API_BASE}/message/quota`, { headers }),
      fetch(`${LINE_API_BASE}/message/quota/consumption`, { headers }),
    ]);

    if (!quotaResp.ok || !usageResp.ok) {
      return {
        ok: false,
        message: `LINE API error (quota: ${quotaResp.status}, usage: ${usageResp.status})`,
      };
    }

    const quota = await quotaResp.json(); // { type: "limited"|"none", value?: number }
    const usage = await usageResp.json(); // { totalUsage: number }

    return {
      ok: true,
      type: quota.type,
      limit: quota.value ?? null, // null ถ้า type === "none" (ไม่จำกัด)
      used: usage.totalUsage,
      remaining:
        quota.type === "limited" && typeof quota.value === "number"
          ? Math.max(quota.value - usage.totalUsage, 0)
          : null,
    };
  } catch (err) {
    console.error("getMessageQuota error:", err.message);
    return { ok: false, message: err.message };
  }
}

// -------------------------------------------------------------
// ฟังก์ชันช่วยประกอบข้อความ — แยกออกมาให้แก้ข้อความง่าย ไม่ต้องไปหา
// ในไฟล์ route
// -------------------------------------------------------------
function buildBorrowedMessage({ teacherName, roomName, time }) {
  return (
    `🔑 แจ้งเตือนการยืมกุญแจ\n` +
    `คุณครู ${teacherName} ยืมกุญแจห้อง "${roomName}"\n` +
    `เวลา ${time}`
  );
}

function buildOverdueMessage({ teacherName, roomName, dueTime }) {
  return (
    `⏰ แจ้งเตือนเกินเวลาคืนกุญแจ\n` +
    `คุณครู ${teacherName} ยังไม่ได้คืนกุญแจห้อง "${roomName}"\n` +
    `(กำหนดคืนภายใน ${dueTime} น.) กรุณาอย่าลืมนำมาคืนด้วยครับ/ค่ะ`
  );
}

// -------------------------------------------------------------
// buildServerReadyMessage() — ข้อความแจ้งตอน server เริ่มทำงานสำเร็จ
// เรียกจาก server.js ตอน app.listen(...) callback
// -------------------------------------------------------------
function buildServerReadyMessage({ time } = {}) {
  const t = time || new Date().toLocaleString("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
  });
  return `✅ ระบบยืม-คืนกุญแจพร้อมทำงานแล้ว\nเวลาเริ่มทำงาน: ${t}`;
}

// -------------------------------------------------------------
// buildQuotaReplyMessage(quotaResult) — ประกอบข้อความตอบกลับ "/quota"
// รับผลลัพธ์จาก getMessageQuota() มาแปลงเป็นข้อความอ่านง่ายส่งกลับกลุ่ม
// -------------------------------------------------------------
function buildQuotaReplyMessage(quotaResult) {
  if (!quotaResult.ok) {
    return `⚠️ เช็คโควต้า LINE ไม่สำเร็จ: ${quotaResult.message || "ไม่ทราบสาเหตุ"}`;
  }

  if (quotaResult.type === "none" || quotaResult.limit == null) {
    return `📊 โควต้าข้อความ LINE: ไม่จำกัด (ใช้ไปแล้ว ${quotaResult.used} ข้อความเดือนนี้)`;
  }

  return (
    `📊 โควต้าข้อความ LINE เดือนนี้\n` +
    `ใช้ไปแล้ว: ${quotaResult.used} / ${quotaResult.limit} ข้อความ\n` +
    `คงเหลือ: ${quotaResult.remaining} ข้อความ`
  );
}

module.exports = {
  sendGroupMessage,
  replyMessage,
  getMessageQuota,
  buildBorrowedMessage,
  buildOverdueMessage,
  buildServerReadyMessage,
  buildQuotaReplyMessage,
  resolveTargetId,
};