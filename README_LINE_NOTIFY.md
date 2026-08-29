# คู่มือติดตั้งฟีเจอร์แจ้งเตือนผ่าน LINE OA

สรุปสิ่งที่เพิ่ม: แจ้งเตือนเข้า **กลุ่ม LINE เดียว** 2 เหตุการณ์
1. **ยืมกุญแจสำเร็จ** — แจ้งทันที
2. **เกินเวลาคืน** — เช็คทุก 15 นาที (ปรับได้), ถือ `borrow_window_end`
   ของห้องเป็นเวลาที่ต้องคืนภายใน, แจ้ง **1 ครั้งต่อการยืม 1 ครั้ง ต่อวัน**
   เท่านั้น (ถ้าเลยมาอีกวันแล้วยังไม่คืน จะแจ้งได้อีกครั้งของวันใหม่)

ห้องที่ไม่ได้ตั้งช่วงเวลายืม (`borrow_window_end` เป็น NULL) จะไม่มีการ
แจ้งเตือนเกินเวลาเลย เพราะไม่มี "เวลาที่ต้องคืน" ให้อ้างอิง

---

## ไฟล์ที่ให้มาในชุดนี้ (ก็อปไปวางที่ path เดียวกันในโปรเจกต์จริง)

| ไฟล์ | สถานะ | หมายเหตุ |
|---|---|---|
| `sql/notif_migration.sql` | ใหม่ | รันต่อจาก schema.sql เดิม |
| `services/line_notify.js` | ใหม่ | คุยกับ LINE API ทั้งหมด |
| `services/overdue_checker.js` | ใหม่ | ตรรกะเช็คเกินเวลา |
| `routes/line_webhook.js` | ใหม่ | รับ webhook, log group ID |
| `routes/admin_line.js` | ใหม่ | endpoint เช็ค quota/targets |
| `routes/tap.js` | **แทนที่ของเดิม** | เพิ่ม hook แจ้งเตือนตอนยืม |
| `server.js` | **แทนที่ของเดิม** | mount route ใหม่ + ตั้ง cron |
| `.env.line.example` | ใหม่ (เสริม) | เอาไปต่อท้าย `.env` และ `.env.example` เดิม |
| `PACKAGE_JSON_เพิ่มเติม.json` | ใหม่ (เสริม) | เอา `node-cron` ไปเพิ่มใน `dependencies` ของ `package.json` เดิม |

**ไฟล์ที่ "แทนที่ของเดิม" (`tap.js`, `server.js`)** ผมแก้จากไฟล์ที่คุณ
อัปโหลดมาโดยตรง เพิ่มเฉพาะส่วนที่เกี่ยวกับ LINE เข้าไป ไม่ได้แตะ logic
เดิมจุดอื่นเลย — แต่ถ้าคุณแก้ไฟล์เหล่านี้เพิ่มเติมหลังจากอัปโหลดมาให้ผม
ควรเทียบ diff อีกรอบก่อนแทนที่จริง

---

## ขั้นตอนติดตั้ง

### 1. เตรียม LINE Official Account ให้พร้อมใช้ Messaging API

คุณสมัคร LINE OA ไว้แล้ว ให้ทำต่อ:

1. เข้า [LINE Official Account Manager](https://manager.line.biz/)
   เลือก OA ของคุณ → **Settings → Messaging API** → กด **Enable**
   (ถ้ายังไม่เคยเปิด จะมีให้เลือก/สร้าง Provider ก่อน)
2. ในหน้าเดียวกันนี้ เลื่อนลงไปเปิด **"เข้าร่วมกลุ่มแชท" (Allow bot to
   join group chats) = อนุญาต** ไม่งั้นเชิญบอทเข้ากลุ่มไม่ติด
3. ไปที่ [LINE Developers Console](https://developers.line.biz/console/)
   เลือก Provider/Channel เดียวกันที่เพิ่ง Enable
   - แท็บ **Basic settings** → คัดลอก **Channel secret**
   - แท็บ **Messaging API** → เลื่อนหา **Channel access token** → กด
     **Issue** → คัดลอก token (แบบ long-lived อายุยาว)

### 2. ตั้งค่า Environment Variables

เอาเนื้อหาใน `.env.line.example` ไปต่อท้ายไฟล์ `.env` (local) และ
`.env.example` (เก็บ placeholder) — กรอก:

```env
LINE_CHANNEL_SECRET=<จากขั้นตอน 1>
LINE_CHANNEL_ACCESS_TOKEN=<จากขั้นตอน 1>
LINE_GROUP_ID=            # เว้นว่างไว้ก่อน ทำขั้นตอน 5 ก่อนค่อยกรอก
OVERDUE_CHECK_CRON=*/15 * * * *
```

ตั้งค่าเดียวกันนี้ใน **Render → Environment** ด้วย (ตัวแปรชุดนี้ต้องมี
ทั้งบน local และบน Render เพราะทั้งสองที่รันโค้ดชุดเดียวกัน)

### 3. รัน SQL migration

เปิด phpMyAdmin (หรือ mysql client) เชื่อมกับ database เดิม แล้วรัน
`sql/notif_migration.sql` (รันครั้งเดียว เพิ่มตาราง `line_targets` +
คอลัมน์ `key_logs.overdue_notified_date`)

### 4. เพิ่ม dependency และก็อปไฟล์

```bash
npm install node-cron
```

จากนั้นก็อปไฟล์ตามตารางด้านบนไปวางที่ path เดียวกันในโปรเจกต์จริง —
`tap.js` กับ `server.js` ให้ **แทนที่** ไฟล์เดิมไปเลย (ผมแก้จากต้นฉบับ
ที่คุณส่งมาโดยตรงแล้ว)

### 5. Deploy ขึ้น Render แล้วตั้งค่า Webhook URL

1. Push โค้ด + deploy ตามขั้นตอนเดิมของโปรเจกต์
2. กลับไปที่ LINE Developers Console → **Messaging API** →
   **Webhook settings** → ใส่ Webhook URL:
   ```
   https://<โดเมน-render-ของคุณ>/api/line/webhook
   ```
   กด **Verify** (ควรได้ Success) แล้วเปิด **Use webhook = Enabled**

### 6. เชิญบอทเข้ากลุ่ม แล้วดู Group ID จาก Render Logs

1. เพิ่มบอท LINE OA เป็นเพื่อน (QR code จาก LINE Official Account
   Manager) แล้วเชิญเข้ากลุ่มที่ต้องการให้แจ้งเตือน (เช่น กลุ่มแอดมิน/
   ห้องทะเบียน)
2. เปิด **Render → Logs** จะเห็นข้อความแบบนี้ทันทีหลังเชิญเข้ากลุ่ม:
   ```
   [LINE webhook] บอทถูกเชิญเข้ากลุ่มใหม่
   [LINE webhook] Group ID: Cxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
3. ก็อป Group ID นั้นไปใส่ `LINE_GROUP_ID` ใน Render Environment แล้ว
   **Manual Deploy** ใหม่อีกครั้งให้ env มีผล (ระบบ auto-save กลุ่มนี้ลง
   ตาราง `line_targets` ให้ด้วยอยู่แล้ว เผื่อลืมตั้ง env — แต่แนะนำให้
   ตั้ง env ไว้ชัดเจนกว่า)

### 7. ทดสอบ

ยิงคำสั่งทดสอบผ่าน admin token (ต้อง login admin ก่อนเพื่อได้ JWT):

```bash
curl -X POST https://<โดเมน-render>/api/admin/line/test \
  -H "Authorization: Bearer <admin_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{"text":"ทดสอบระบบแจ้งเตือน"}'
```

ควรเห็นข้อความเข้ากลุ่มทันที จากนั้นลองแตะแท็กครู → แท็กกุญแจ (ยืมจริง)
ควรมีข้อความ "🔑 แจ้งเตือนการยืมกุญแจ" เข้ากลุ่มด้วย

---

## คำสั่งเช็ค LINE Quota

```bash
curl https://<โดเมน-render>/api/admin/line/quota \
  -H "Authorization: Bearer <admin_jwt_token>"
```

ตอบกลับตัวอย่าง:
```json
{
  "ok": true,
  "type": "limited",
  "limit": 500,
  "used": 42,
  "remaining": 458
}
```

ดูรายการกลุ่มที่ระบบรู้จัก:
```bash
curl https://<โดเมน-render>/api/admin/line/targets \
  -H "Authorization: Bearer <admin_jwt_token>"
```

---

## หมายเหตุสำคัญ

- **LINE OA แผนฟรี** จำกัดจำนวนข้อความ push/broadcast ต่อเดือน (ปกติ
  500 ข้อความ/เดือน) — ใช้ `/api/admin/line/quota` เช็คเป็นระยะ ถ้า
  ระบบมีครู/ห้องเยอะ อาจต้องอัปเกรดแผนหรือลดความถี่ cron
- ถ้า `bridge-server.js` (เครื่อง local) ปิดอยู่ cron บน Render จะ query
  ฐานข้อมูลไม่ได้ — จะเห็น error log ทุก 15 นาทีแต่ไม่ทำให้เว็บล่ม
- ข้อความยืม/เกินเวลาถูกเขียนแยกไว้ใน `buildBorrowedMessage` /
  `buildOverdueMessage` ใน `services/line_notify.js` — แก้ข้อความตรงนั้น
  จุดเดียวพอ ไม่ต้องไปหาในไฟล์ route
