// routes/line_webhook.js
// -----------------------------------------------------------------
// รับ Webhook events จาก LINE Messaging API
//
// ใช้งานหลักในระบบนี้ (ตามที่ตกลงกัน):
//   - event "join" (บอทถูกเชิญเข้ากลุ่ม) -> log Group ID ออก console
//     (จะไปโผล่ใน Render Logs) ให้ก็อปมาตั้งเป็น env LINE_GROUP_ID
//     และ "auto-save" ลงตาราง line_targets ให้อัตโนมัติด้วย (กันลืมตั้ง
//     env — ถ้าตั้ง env ไว้ระบบจะใช้ env ก่อนเสมอ ดู line_notify.js)
//   - event "leave" (บอทถูกเตะ/ออกจากกลุ่ม) -> mark is_active = 0 ใน
//     line_targets กันยิงข้อความไปกลุ่มที่บอทไม่ได้อยู่แล้ว
//   - event "message" ที่เป็นข้อความ "/quota" -> ตอบกลับโควต้าข้อความ
//     LINE OA เดือนนี้ทันทีในกลุ่ม (ผ่าน Reply API ไม่เสียโควต้า push)
//     ข้อความอื่นนอกจากนี้แค่ log ไว้เฉยๆ ไม่ตอบกลับ
//
// ตั้งค่าที่ต้องทำใน LINE Developers Console:
//   Messaging API -> Webhook settings -> Webhook URL ใส่
//   https://<โดเมน render ของคุณ>/api/line/webhook แล้วกด "Verify" +
//   เปิด "Use webhook" เป็น Enabled
//
// การ verify signature: LINE จะแนบ header "x-line-signature" มาด้วย
// เป็น HMAC-SHA256 ของ raw body เซ็นด้วย Channel Secret — ต้อง verify
// ก่อนเชื่อ payload เสมอ กัน endpoint นี้ถูกยิงปลอมจากที่อื่น
// -----------------------------------------------------------------

const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const { query } = require("../config/db");
const {
  replyMessage,
  getMessageQuota,
  buildQuotaReplyMessage,
} = require("../services/line_notify");

// -------------------------------------------------------------
// ต้องใช้ raw body (ไม่ใช่ JSON ที่ parse แล้ว) ในการคำนวณ signature
// server.js ใช้ express.json() แบบ global อยู่แล้ว ดังนั้น mount route
// นี้ "ก่อน" express.json() ใน server.js หรือใช้ express.raw() เฉพาะ
// path นี้แทน — ดูคอมเมนต์ตอน mount ใน server.js
// -------------------------------------------------------------
function verifySignature(req) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  if (!channelSecret) {
    console.warn(
      "verifySignature: ไม่ได้ตั้งค่า LINE_CHANNEL_SECRET — ข้ามการ verify (ไม่ควรใช้ใน production)"
    );
    return true;
  }

  const signature = req.headers["x-line-signature"];
  if (!signature) return false;

  const expected = crypto
    .createHmac("SHA256", channelSecret)
    .update(req.rawBody || Buffer.from(""))
    .digest("base64");

  return signature === expected;
}

router.post("/line/webhook", async (req, res) => {
  // ตอบ 200 กลับให้ LINE ไวที่สุดเสมอ (LINE จะ retry ถ้าไม่ได้ 200 ภายใน
  // เวลาที่กำหนด) แล้วค่อยประมวลผล event ต่อแบบไม่บล็อก response
  res.status(200).end();

  if (!verifySignature(req)) {
    console.error("LINE webhook: signature ไม่ตรง — ข้าม payload นี้");
    return;
  }

  const events = req.body?.events || [];

  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (err) {
      console.error("LINE webhook: handleEvent error:", err.message);
    }
  }
});

async function handleEvent(event) {
  const source = event.source || {};

  if (event.type === "join" && source.type === "group") {
    const groupId = source.groupId;

    // -----------------------------------------------------------
    // *** จุดสำคัญที่ขอไว้: log group ID ให้เห็นชัดๆ ใน Render Logs ***
    // -----------------------------------------------------------
    console.log("=======================================================");
    console.log("[LINE webhook] บอทถูกเชิญเข้ากลุ่มใหม่");
    console.log(`[LINE webhook] Group ID: ${groupId}`);
    console.log(
      "[LINE webhook] ก็อป Group ID นี้ไปตั้งเป็น env LINE_GROUP_ID บน Render ได้เลย"
    );
    console.log("=======================================================");

    // auto-save กันลืมตั้ง env — ถ้ามี LINE_GROUP_ID ตั้งไว้แล้ว
    // line_notify.js จะเลือกใช้ env ก่อนเสมออยู่ดี แถวนี้เป็นแค่ fallback
    try {
      await query(
        `INSERT INTO line_targets (target_type, target_id, label, is_active)
         VALUES ('group', ?, ?, 1)
         ON DUPLICATE KEY UPDATE is_active = 1, label = VALUES(label)`,
        [groupId, "กลุ่มที่เชิญบอทเข้าล่าสุด (auto-saved จาก webhook)"]
      );
    } catch (err) {
      console.error("LINE webhook: บันทึก line_targets ไม่สำเร็จ:", err.message);
    }
    return;
  }

  if (event.type === "leave" && source.type === "group") {
    const groupId = source.groupId;
    console.log(`[LINE webhook] บอทออกจากกลุ่ม (หรือถูกเตะ): ${groupId}`);
    try {
      await query(
        `UPDATE line_targets SET is_active = 0 WHERE target_id = ?`,
        [groupId]
      );
    } catch (err) {
      console.error("LINE webhook: อัปเดต line_targets ไม่สำเร็จ:", err.message);
    }
    return;
  }

  // -----------------------------------------------------------
  // event "message" ประเภทข้อความตัวหนังสือ — ใช้กับคำสั่ง "/quota"
  // พิมพ์ในกลุ่มแล้วบอทตอบโควต้ากลับทันที (ใช้ Reply API ไม่เสียโควต้า
  // push รายเดือน) คำสั่งอื่นนอกจากนี้ไม่ตอบอะไร ปล่อยผ่านเฉยๆ
  // -----------------------------------------------------------
  if (event.type === "message" && event.message?.type === "text") {
    const text = (event.message.text || "").trim().toLowerCase();

    if (text === "/quota") {
      const quotaResult = await getMessageQuota();
      const replyText = buildQuotaReplyMessage(quotaResult);
      const result = await replyMessage(event.replyToken, replyText);
      if (!result.ok) {
        console.error("LINE webhook: ตอบ /quota ไม่สำเร็จ:", result.message);
      }
      return;
    }

    // ข้อความอื่นๆ — log ไว้เฉยๆ ไม่ตอบกลับ (ระบบนี้ไม่มี flow ให้ครูคุย
    // กับบอทแบบอื่น)
    console.log(`[LINE webhook] ข้อความในกลุ่ม/แชท: "${event.message.text}"`);
    return;
  }

  // event ประเภทอื่น (memberJoined, memberLeft ฯลฯ) — แค่ log ไว้เผื่อ
  // debug ไม่ต้องทำอะไรต่อ
  console.log(`[LINE webhook] event: ${event.type} จาก source: ${source.type}`);
}

module.exports = router;