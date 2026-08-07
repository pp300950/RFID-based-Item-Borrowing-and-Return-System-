# สถานะงาน — ระบบยืม-คืนกุญแจด้วย RFID (อัปเดตรอบ 2)

หลังไล่อ่าน backend ครบ + frontend ครบ (`tap.js`, `admin_rooms.js`,
`admin.js`, `teacher.js`, `login.js`, `*.html`, `*.css`)

---

## ✅ เสร็จสมบูรณ์ ทั้ง backend + frontend

- **Auth ใหม่แบบแตะบัตรสมัครครู** — `auth.js` + `register_session.js` +
  `tap.js` (ฝั่งเซิร์ฟเวอร์) + `login.html`/`login.js` (ฝั่งเว็บ, มีหน้า
  "รอแตะบัตร" + countdown + cancel) ครบวงจร
- **`/api/tap` flow ยืม-คืนจริง** — session ครู, toggle borrow/return,
  บังคับ `borrow_window` ตอนยืม (ไม่บังคับตอนคืน), auto-register ตอนแตะ
  บัตรใหม่ระหว่าง pending registration — ครบและตรงกับที่ comment อธิบายไว้
- **Task 3** — จัดการครู + แท็กครู (`admin_teachers.js` ↔ `admin.js`
  section 02) ครบ
- **Task 4** — `isCurrentlyBorrowed` (`admin_keys.js` ↔ `admin.js`
  section 03 ตาราง keys)
- **Task 9a** — modal รายละเอียดห้อง + ประวัติ 10 รายการล่าสุด
  (`keys.js` ↔ `teacher.js`) ครบ
- **Task 9b** — Lightbox ดูรูปเต็มจอ (คลิก/Enter, ลูกศรซ้าย-ขวา, Escape
  แยกชั้นกับ modal) — ทำเสร็จเรียบร้อยดีมาก
- หน้าแอดมิน CRUD ห้อง (สร้าง/แก้ inline/เปิด-ปิดใช้งาน/ลบ/อัปโหลดรูป
  เดี่ยว) ต่อกับ `admin_rooms.js` ครบ

---

## 🔴 Backend เสร็จแล้ว แต่ frontend ยังไม่เรียกใช้เลย (จุดที่ควรทำต่อ)

นี่คือของที่ "ทำไปแล้วฝั่งเซิร์ฟเวอร์ แต่ยังไม่มีใครกดใช้ได้จากหน้าเว็บ" — ไล่เช็คด้วย `grep` ใน `admin.js` แล้วไม่เจอเลย:

1. **ตั้งช่วงเวลาที่อนุญาตยืม (`borrow_window_days/start/end`)**
   - Backend พร้อม 100%: `admin_rooms.js` มี `validateBorrowWindow()`
     รองรับทั้ง POST/PATCH `/rooms`, และ `tap.js` บังคับใช้จริงตอนยืม
   - **แต่ฟอร์ม "เพิ่มห้อง" และตาราง "แก้ไขห้อง" ใน `admin.html`/`admin.js`
     ไม่มีช่องให้กรอกเลย** — ตอนนี้แอดมินตั้งค่านี้ผ่านหน้าเว็บไม่ได้จริง
     ต้องยิง API ตรงๆ เอง
   - **ทำต่อ:** เพิ่ม field ในฟอร์ม/แถวตาราง (เช่น multi-select วันในสัปดาห์
     + time picker เริ่ม-สิ้นสุด) แล้วส่งเป็น `borrowWindowDays`/
     `borrowWindowStart`/`borrowWindowEnd` ใน payload ของ `apiPost`/
     `apiPatch` ที่มีอยู่แล้ว

2. **Export ประวัติยืม-คืน (CSV/DOCX)**
   - Backend พร้อม 100%: `export.js` → `GET /api/admin/keys/history/export?format=csv|docx`
   - **แต่ section 04 "ประวัติยืม-คืน" ใน `admin.html` ไม่มีปุ่ม export
     เลย** และ `admin.js` ไม่มีโค้ดเรียก endpoint นี้เลย
   - **ทำต่อ:** เพิ่มปุ่ม/dropdown เลือกรูปแบบข้างๆ filter การกระทำใน
     section 04 แล้วเปิดลิงก์ดาวน์โหลดตรงๆ (ไม่ต้องผ่าน `apiFetch` เพราะ
     เป็น file download — ต้องคิดเรื่องแนบ JWT token ด้วย เพราะ endpoint
     นี้ต้อง auth และ `<a href>` ธรรมดาไม่แนบ header ได้ อาจต้อง fetch
     แบบ blob แล้ว trigger download แทน)

3. **อัปโหลด/จัดการรูปหลายรูปต่อห้อง + reorder**
   - Backend พร้อม 100%: `admin_rooms.js` มี `POST /rooms/:id/images`
     (หลายไฟล์), `DELETE /rooms/:id/images/:imageId`,
     `PATCH /rooms/:id/images/reorder`
   - **แต่ตารางห้องใน `admin.js` ยังผูกกับ endpoint เดี่ยวเก่า
     (`/rooms/:id/image` — เอกพจน์) เท่านั้น** ไม่มี UI จัดการหลายรูป/ลบ/
     ลากจัดลำดับเลย — แอดมินอัปโหลดได้แค่รูปเดียวต่อห้องผ่านหน้าเว็บ
   - **ทำต่อ:** เพิ่ม UI แยก (อาจเป็น modal คล้าย room detail ของฝั่ง
     teacher) สำหรับห้องแต่ละห้อง ให้อัปโหลดหลายไฟล์ ลบทีละรูป
     และลาก-วางจัดลำดับ

4. **Task 9c — badge ช่วงเวลาที่ยืมได้ ฝั่ง teacher.js**
   - Backend ส่งข้อมูลมาอยู่แล้วใน `/api/keys/status` (`borrow_window_*`)
   - **`teacher.js` ไม่มีโค้ดอ่านหรือแสดงค่านี้เลย** แม้แต่ในบล็อก
     `renderRoomDetailShell()` — comment ในไฟล์ (บรรทัด ~254-257) ยืนยัน
     ตรงๆ ว่ายังไม่ทำ ("ยังไม่มีไอคอนนาฬิกา/ปฏิทินตามสเปค")
   - **ทำต่อ:** เพิ่ม badge/บรรทัดในการ์ดห้อง + modal แปลง
     `borrow_window_days` (array ตัวเลข 0-6) และ `_start`/`_end` (HH:MM:SS)
     เป็นข้อความอ่านง่าย เช่น "ยืมได้: จ-ศ 08:00-16:00" — เขียน helper
     function แปลงวันเป็นภาษาไทยแบบย่อ (จ,อ,พ,พฤ,ศ,ส,อา)

---

## 🟡 ยังไม่มีไฟล์เลย (ยืนยันจากรอบก่อน — ยังไม่เห็นมาเลย)

- **`history.html`** — หน้า "ดูทั้งหมด" ที่ `teacher.js` ลิงก์ไปหา
  (`/history.html?roomId=X`) เมื่อประวัติในห้องมีเกิน 10 รายการ
  Backend (`GET /api/keys/history/all` ใน `keys.js`) พร้อมรองรับ
  pagination อยู่แล้ว รอแค่หน้านี้

---

## 📌 สรุปคร่าวๆ: ระบบไปถึงไหนแล้ว

**Backend เกือบสมบูรณ์แล้วจริงๆ** — endpoint ที่ MANIFEST พูดถึงแทบทุกจุด
มี code รองรับครบ รวมถึงเคสยากๆ (race condition ตอนแตะแท็กรัว, ช่วงเวลา
ข้ามเที่ยงคืน, cleanup ไฟล์กำพร้าใน storage)

**Frontend ตามหลังอยู่ 4 จุด** ตามที่ระบุด้านบน (ข้อ 1-4) ซึ่งทั้งหมดเป็น
"ต่อสาย UI เข้ากับ API ที่มีอยู่แล้ว" ไม่ใช่งานออกแบบ backend ใหม่ —
น่าจะเป็นงานที่เหลือเร็วที่สุดในบรรดาที่ค้างทั้งหมด

**ยังไม่มีเลย:** `history.html` เท่านั้น

---

## 📎 คำแนะนำเรื่องอัพไฟล์รอบต่อไป

อย่าอัพทั้ง 20 ไฟล์ซ้ำ — เลือกตามงานที่จะทำ:

| จะทำอะไรต่อ | อัพไฟล์ |
|---|---|
| เพิ่ม UI ตั้ง borrow window ในหน้าแอดมิน | `admin.html`, `admin.js`, `admin.css` (ไม่ต้อง backend ซ้ำ) |
| เพิ่มปุ่ม export ในหน้าแอดมิน | `admin.html`, `admin.js` |
| ทำ UI จัดการหลายรูป + reorder | `admin.html`, `admin.js`, `admin.css`, อาจอ้างอิง `teacher.js` เพื่อดู pattern lightbox ที่ทำไว้แล้ว |
| ทำ badge borrow window ฝั่งครู (9c) | `teacher.js`, `teacher.css`, `teacher.html` |
| ทำ `history.html` ใหม่ | `keys.js` (ดู shape ของ `/history/all`), `teacher.html`/`teacher.css`/`style.css` (ใช้ pattern เดิม) |

ไม่ต้องอัพไฟล์ backend (`tap.js`, `admin_rooms.js`, ฯลฯ) ซ้ำถ้าไม่ได้แก้
ฝั่งนั้น — งานที่เหลือทั้งหมดตอนนี้อยู่ฝั่ง frontend ล้วนๆ