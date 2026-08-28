# ระบบยืม–คืนกุญแจด้วยแท็ก RFID

ระบบยืม-คืนกุญแจห้อง สำหรับครู โดยใช้เครื่องอ่านแท็ก RFID (Keyboard Emulation)
ที่ห้องทะเบียน — แตะแท็กครู แล้วแตะแท็กกุญแจ ระบบจะยืม/คืนให้อัตโนมัติ
ไม่ต้องมีขั้นตอนอนุมัติ

**สแต็กที่ใช้จริง:** Node.js (Express) + MySQL/MariaDB (รันบนเครื่อง local
ผ่าน XAMPP) + JWT + Render (hosting เว็บ/API)

> ⚠️ **อัปเดตล่าสุด: HTTP bridge (config/mysql-pool.js, bridge-server.js,
> config/db-bridge-client.js, config/db.js โหมดสลับ local/bridge) และ
> route files ทั้งหมด (routes/*.js) เขียนเสร็จและทดสอบผ่านแล้วทุกไฟล์**
> (ทดสอบด้วยการจำลอง MySQL pool แบบ end-to-end ผ่าน HTTP จริง ไม่ใช่แค่
> อ่านโค้ดเฉยๆ — ดูรายละเอียดผลทดสอบใน **section 14** ท้ายไฟล์นี้)
> ระหว่างตรวจพบบั๊ก 1 จุดใน `admin_rooms.js` (ใช้ `pool.query()` ตรงๆ ซึ่ง
> พังตอนโหมด bridge) แก้และทดสอบซ้ำผ่านแล้ว — ดู section 14.2
>
> Section 7 (deploy แบบ TCP tunnel เดิม) ยังคงเป็นแผนที่ถูกแทนที่แล้ว
> ไม่ต้องอ้างอิง ใช้ section 11 (HTTP bridge) แทนเสมอ — ตอนนี้ section 11
> ไม่ใช่แค่แผนแล้ว แต่เป็นของที่เขียนและทดสอบเสร็จจริง (ดู section 14.2)

---

## 1. ภาพรวมการทำงาน

**Flow หลัก (ที่เครื่องอ่านแท็ก ห้องทะเบียน)**

1. ครูแตะแท็กประจำตัว 1 ครั้ง → ระบบเปิด "session" ชั่วคราวผูกกับครูคนนั้น
2. แตะแท็กกุญแจ (ยืมได้หลายดอกต่อเนื่องในรอบเดียว) → ระบบเช็คสถานะกุญแจ:
   - ว่างอยู่ (`available`) → บันทึกเป็นการ **ยืม**
   - ถูกยืมอยู่โดยครูคนเดียวกับ session → บันทึกเป็นการ **คืน**
   - ถูกยืมอยู่โดยครูคนอื่น → แจ้ง error ไม่ทำอะไร
3. Session หมดอายุอัตโนมัติถ้าไม่แตะกุญแจต่อภายใน 20 วินาที (แตะแท็กครูใหม่เพื่อเริ่ม session ใหม่ได้เสมอ)

**สถาปัตยกรรมระบบ (ฝั่งเครื่องอ่าน RFID — ไม่เปลี่ยนจากเดิม)**

```
[แท็ก RFID] --แตะ--> [เครื่องอ่าน RFID (USB, HID Keyboard)]
                              |
                    พิมพ์เลขแท็กลง <input> อัตโนมัติ
                              |
                              v
                 [หน้าเว็บ public/ (Browser)]
                              |
                    ยิง POST /api/tap
                              |
                              v
              [Express Server (server.js + routes/)]
                              |
                              v
                  [MySQL/MariaDB (localhost:3306)]
```

**การเข้าถึงสองทาง — สถาปัตยกรรมนี้เปลี่ยนไปจากแผนเดิม ดู section 11**
ก่อนอ้างอิงไดอะแกรมนี้ เวอร์ชันล่าสุด (HTTP bridge แทน TCP tunnel) อยู่ใน
section 11.2

เครื่อง local ต้องเปิดค้างไว้ตลอดเวลา (Node.js/MySQL/XAMPP + ตัวเชื่อมต่อ
ไปหา Render ไม่ว่าจะเป็นแบบไหน) เพราะเป็นที่เก็บฐานข้อมูลจริงเพียงชุดเดียว
ของทั้งระบบ ไม่ว่าจะเลือกสถาปัตยกรรมเชื่อมต่อแบบใดก็ตาม — **นี่คือ
trade-off ที่ยืนยันแล้วและไม่เปลี่ยน ไม่ว่าจะใช้ TCP tunnel หรือ HTTP
bridge**

---

## 2. โครงสร้างโปรเจกต์

```
webapp/
├─ server.js                   # entry point, mount ทุก route — ตรวจแล้ว require path ถูกต้องครบ
├─ package.json
├─ .env                        # ค่าจริง (ไม่ commit ขึ้น git)
├─ .env.example                # อัปเดตครบแล้ว รวมตัวแปร bridge (DB_MODE, BRIDGE_*, DB_BRIDGE_*)
├─ config/
│  ├─ db.js                    # สลับโหมด local/bridge ตาม DB_MODE — เขียน+ทดสอบผ่านแล้ว ดู section 14.2
│  ├─ mysql-pool.js             # pool กลาง (โหมด local + ที่ bridge-server.js เรียกใช้) — เขียน+ทดสอบผ่านแล้ว
│  └─ db-bridge-client.js       # HTTP client ฝั่ง Render (โหมด bridge) — เขียน+ทดสอบผ่านแล้ว
├─ routes/
│  ├─ auth.js                  # สมัคร/ล็อกอินครู, ล็อกอินแอดมิน, /me — ทดสอบผ่านแล้ว
│  ├─ middleware_auth.js       # JWT: signToken, requireAuth, requireRole — ตรวจแล้ว
│  ├─ tap.js                   # POST /api/tap (endpoint หลักของเครื่องอ่าน) — ทดสอบผ่านแล้ว
│  ├─ keys.js                  # ครูดูสถานะกุญแจ + ประวัติของตัวเอง — ทดสอบผ่านแล้ว
│  ├─ admin_rooms.js           # แอดมิน CRUD ห้อง/กุญแจ — แก้บั๊ก pool→query/withTransaction แล้ว ทดสอบผ่าน
│  ├─ admin_teachers.js        # แอดมิน assign แท็กให้ครู — ทดสอบผ่านแล้ว
│  ├─ admin_keys.js            # แอดมินดูสถานะ/ประวัติกุญแจทั้งหมด — ทดสอบผ่านแล้ว
│  ├─ export.js                # export CSV/DOCX ประวัติยืม-คืน — ทดสอบผ่านแล้ว (CSV+DOCX จริง)
│  └─ register_session.js      # pending registration session in-memory — ตรวจแล้ว
├─ bridge-server.js             # รันที่เครื่อง local คู่กับ MySQL รับคำสั่งจาก Render ผ่าน HTTP — เขียน+ทดสอบผ่านแล้ว ดู section 14.2
├─ public/                     # frontend (static files)
└─ sql/
   └─ schema.sql                # ตรวจสอบแล้วว่ารันได้จริงบน MariaDB 10.11 — ดู section 12
```

> **หมายเหตุ:** `middleware_auth.js` อยู่ใน `routes/` ไม่ใช่โฟลเดอร์ `middleware/`
> แยกต่างหาก ดังนั้นไฟล์อื่นใน `routes/` ที่จะ import ต้องใช้
> `require("./middleware_auth")` (ไม่ใช่ `require("../middleware/auth")`)

---

## 3. Database Schema (MySQL / MariaDB — รันผ่าน XAMPP บนเครื่อง local)

```
teachers
├─ id, name, department, teacher_code, created_at, last_login_at

teacher_tags                  -- 1:1 ครู <-> แท็กประจำตัว
├─ id, teacher_id (unique, FK -> teachers), tag_uid (unique), assigned_at

room_tags                     -- "กุญแจ" แต่ละดอก (1 แท็ก = 1 กุญแจ/ห้อง)
├─ id, room_name, tag_uid (unique), description, is_active, created_at
├─ status ('available' | 'borrowed')
├─ borrowed_by_teacher_id (FK -> teachers, nullable)
├─ borrowed_at (nullable)
├─ borrow_window_days (JSON, nullable), borrow_window_start/end (TIME)
├─ image_url (TEXT, nullable — backward-compat, ดู section 3.1)

key_logs                      -- ประวัติยืม-คืนทั้งหมด
├─ id, room_tag_id (FK -> room_tags), teacher_id (FK -> teachers)
├─ action ('borrow' | 'return')
├─ acted_at

room_images                   -- หลายรูปต่อห้อง/กุญแจ 1 ดอก
├─ id, room_tag_id (FK -> room_tags), image_url, sort_order, created_at
```

ระบบนี้**ไม่มี**นักเรียน, ไม่มี `room_items`, ไม่มีขั้นตอน pending/approve,
และไม่มีการมอบหมายครูดูแลห้องเฉพาะ (ครูคนไหนมีแท็กก็ยืมกุญแจดอกไหนก็ได้)

### 3.1 เรื่องรูปภาพห้อง

เก็บเป็นไฟล์จริงบนดิสก์ที่ `public/uploads/room-images/` (ไม่ใช้ Supabase
Storage แล้ว) คอลัมน์ `image_url` เก็บ path สัมพัทธ์ เช่น
`/uploads/room-images/room-12-xxx.jpg` — schema เต็มอยู่ที่ `sql/schema.sql`

`multer` เปลี่ยนจาก `memoryStorage()` → `diskStorage()` เขียนตรงไป
`public/uploads/room-images/` ด้วยชื่อไฟล์แบบเดิม
(`room-<id>-<timestamp>.<ext>`) ฟังก์ชัน "ลบไฟล์เก่า"
(`supabase.storage.remove([oldPath])` เดิม) เปลี่ยนเป็น `fs.unlink()` แบบ
best-effort (catch error แล้ว log เฉยๆ ไม่ throw)

ต้องสร้างโฟลเดอร์ `public/uploads/room-images/` เองไว้ก่อนรัน (git ไม่
track โฟลเดอร์ว่าง — ใส่ `.gitkeep` หรือให้โค้ด `fs.mkdirSync(...,
{ recursive: true })` ตอน startup กันพลาด "ENOENT: no such directory"
ตอนอัปโหลดรูปแรก)

---

## 4. Auth

ใช้ JWT แบบ stateless (ไม่มี session store ฝั่ง server) — token เก็บ
`{ role, id, name }`

| Role | id ใน token | วิธี login |
|---|---|---|
| `teacher` | `teachers.id` จริงจาก DB | รหัสครู (ตัวเลข 6-12 หลัก) |
| `admin` | `null` | เทียบกับ `ADMIN_USERNAME` / `ADMIN_PASSWORD` ใน env เท่านั้น ไม่มีแถวใน DB |

**การใช้ middleware ในไฟล์ route:**
```js
const { requireAuth, requireRole } = require("./middleware_auth");

router.get("/x", requireAuth, handler);
router.post("/y", requireAuth, requireRole("teacher"), handler);
router.delete("/z", requireAuth, requireRole("admin"), handler);
```

`POST /api/tap` เป็นข้อยกเว้น — **ไม่ผ่าน requireAuth** เพราะเครื่องอ่านที่
ห้องทะเบียนเป็นจุดที่ต้องเชื่อถือได้ทางกายภาพอยู่แล้ว (ต้องมีบัตรแท็กจริง
ถึงจะแตะได้) ไม่ใช่ "ผู้ใช้ที่ login" ผ่านหน้าเว็บ

---

## 5. API Routes

```
POST   /api/login/admin               ล็อกอินแอดมิน
GET    /api/me                        ข้อมูลผู้ใช้ปัจจุบัน (requireAuth)

POST   /api/tap                       รับการแตะแท็กจากเครื่องอ่าน (public)
GET    /api/tap/session               poll เช็คสถานะ session ปัจจุบัน
POST   /api/tap/session/clear         ปิด session ทันที

GET    /api/keys/status               สถานะกุญแจทั้งหมด (public — ไม่ผ่าน requireAuth)

GET    /api/admin/rooms               รายการห้อง/กุญแจ (admin)
POST   /api/admin/rooms               สร้างห้อง/กุญแจใหม่ (admin)
PATCH  /api/admin/rooms/:id           แก้ไขห้อง/กุญแจ (admin)
DELETE /api/admin/rooms/:id           ลบห้อง/กุญแจ (admin)

GET    /api/admin/teacher-tags        รายการครู + สถานะแท็ก (admin)
POST   /api/admin/teacher-tags        ผูกแท็กให้ครู (admin)
PATCH  /api/admin/teacher-tags/:id    เปลี่ยนแท็กครู (admin)
DELETE /api/admin/teacher-tags/:id    ถอดแท็กครู (admin)

GET    /api/admin/keys/status         สถานะกุญแจทั้งหมด แบบละเอียด (admin)
GET    /api/admin/keys/history        ประวัติยืม-คืนทั้งหมด, filter ได้ (admin)
```

ทุก `/api/admin/*` ถูกป้องกันด้วย `requireAuth + requireRole("admin")`
ที่จุด mount ใน `server.js` เพียงจุดเดียว ไม่ต้องใส่ middleware ซ้ำในแต่ละไฟล์ route

> **หมายเหตุ:** `POST /api/register/teacher`, `POST /api/login/teacher`,
> และ `GET /api/keys/history/mine` ของเวอร์ชันเดิมถูกตัดออกจากระบบแล้ว
> (ครูไม่ login ผ่านเว็บอีกต่อไป) ดูแผนการเปลี่ยนขั้นตอนสมัครครูแบบใหม่ใน
> section 10

---

## 6. การตั้งค่าและรันในเครื่อง (Local Development)

### 6.1 ติดตั้ง dependencies
```bash
cd webapp
npm install
```

### 6.2 ตั้งค่า Environment Variables
คัดลอก `.env.example` เป็น `.env` แล้วกรอกค่าจริง:

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=key_borrow_db
DB_PORT=3306

JWT_SECRET=สุ่มยาวๆ-เปลี่ยนก่อนใช้งานจริง
JWT_EXPIRES_IN=7d
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-password-here
```

> ค่า `DB_USER=root` / `DB_PASSWORD=` (ว่าง) คือค่า default ของ XAMPP —
> ใช้ได้ตอน dev บนเครื่อง local เฉยๆ **แต่ทดสอบจริงแล้วพบว่ามีปัญหา (ดู
> section 12.2) ถ้าจะให้ Node.js (mysql2) ต่อผ่าน TCP ต้องสร้าง MySQL
> user แยกที่ไม่ใช่ `root` เสมอ — ไม่ใช่แค่เรื่องความปลอดภัย แต่ `root`
> เดิมของ XAMPP มักต่อผ่าน TCP ไม่ได้เลยด้วยซ้ำ**

### 6.3 รันเซิร์ฟเวอร์
```bash
npm start
```
เปิดที่ `http://localhost:3000`

> ก่อนรัน ต้องเปิด **XAMPP Control Panel → Start MySQL** ไว้ก่อนเสมอ
> ดูรายละเอียดการติดตั้ง XAMPP + import schema ใน `FOR_ME.md`

---

## 7. Deploy ขึ้น Render — ⚠️ แผนเดิม (TCP Tunnel) — ถูกแทนที่แล้ว ดู section 11

> **เอกสารส่วนนี้เป็นแผนเดิมที่คุยกันไว้ก่อนพบว่า Cloudflare Quick Tunnel
> (แบบฟรี ไม่ผูกโดเมน) ไม่รองรับการเปิด TCP tunnel ตรงๆ ได้เลย — รองรับ
> เฉพาะ HTTP/HTTPS เท่านั้น การเปิด TCP tunnel ฟรีแบบไม่ผูกโดเมนไม่มีให้ใช้
> จึงต้องเปลี่ยนสถาปัตยกรรมทั้งหมดเป็น HTTP bridge แทน (section 11) เก็บ
> เนื้อหาเดิมไว้ด้านล่างนี้เพื่ออ้างอิงเหตุผลที่เปลี่ยน ไม่ใช่แผนที่จะใช้
> จริงแล้ว**

**แนวคิดเดิม:** ฐานข้อมูล MySQL มีอยู่ชุดเดียวบนเครื่อง local (เครื่องที่รัน
XAMPP) เว็บที่ deploy บน Render เป็นโค้ดชุดเดียวกับที่รันบนเครื่อง local
เพียงแต่ `DB_HOST` ชี้ไปที่ **Cloudflare Tunnel** แทน `localhost` — ทำให้
Render คุยกับ MySQL เครื่องเดียวกับที่เครื่อง local ใช้อยู่ได้ตรงๆ ผ่าน
`mysql2` เหมือนเดิมทุกอย่าง ไม่ต้องมีฐานข้อมูลแยกอีกชุด (**ปัญหา: TCP
tunnel แบบฟรีไม่มีให้ใช้ — ดู section 11.1**)

### 7.1 เปิด Cloudflare Tunnel บนเครื่อง local (แผนเดิม — ใช้ไม่ได้)

~~ติดตั้ง `cloudflared` และรัน tunnel ชี้ไปที่พอร์ต MySQL~~ — ใช้ไม่ได้กับ
Quick Tunnel ฟรี ดู section 11.1 สำหรับสถาปัตยกรรมทดแทน

### 7.2 เตรียม repo (ยังใช้ได้เหมือนเดิม ไม่เปลี่ยน)
- Push โค้ดขึ้น GitHub (branch `main`) — โฟลเดอร์โปรเจกต์บนเครื่อง local
  กับที่ push ขึ้น GitHub คือชุดเดียวกัน (Render deploy จาก repo นี้ตรงๆ)
- **ห้าม** commit ไฟล์ `.env` จริง — เก็บแค่ `.env.example` ที่เป็น placeholder เท่านั้น

### 7.3 สร้าง Web Service บน Render (ยังใช้ได้เหมือนเดิม ไม่เปลี่ยน)
1. เข้า [render.com](https://render.com) → Sign in ด้วย GitHub
2. **New +** → **Web Service** → เลือก repo นี้
3. ตั้งค่า Build:

| ช่อง | ค่า |
|---|---|
| Branch | `main` |
| Root Directory | `webapp` |
| Runtime | `Node` |
| Build Command | `npm install` |
| Start Command | `npm start` |

### 7.4 ตั้งค่า Environment Variables บน Render — ⚠️ เปลี่ยนไปตาม section 11

~~`DB_HOST` = URL ของ tunnel~~ → ดู section 11.4 สำหรับตัวแปร env ชุดใหม่
ที่ต้องตั้งแทน (`DB_BRIDGE_URL`, `DB_BRIDGE_KEY` แทนที่จะเป็น
`DB_HOST`/`DB_USER`/`DB_PASSWORD` ตรงๆ)

### 7.5 Deploy (ยังใช้ได้เหมือนเดิม ไม่เปลี่ยน)
กด **Create Web Service** — Render จะ build และ deploy อัตโนมัติทุกครั้งที่
push ขึ้น `main` (เว็บจะใช้งานได้จริงก็ต่อเมื่อเครื่อง local เปิดฐานข้อมูล +
ตัวเชื่อมต่อไปหา Render ค้างไว้ตาม section 11 ด้วย)

---

## 8. ข้อควรระวังด้านความปลอดภัย

- `JWT_SECRET`, `DB_PASSWORD` ต้องอยู่ใน environment variables เท่านั้น ห้ามฝังในโค้ดหรือ commit ขึ้น git
- `.env.example` ต้องมีแต่ค่า placeholder (เช่น `your-password-here`) ไม่ใช่ค่าที่หน้าตาเหมือนรหัสผ่านจริง เพราะ GitHub secret scanning จะบล็อกการ push ถ้าตรวจพบ pattern คล้ายคีย์จริง
- ตั้ง `JWT_SECRET` เป็นค่าที่ตั้งเองแบบสุ่มยาวๆ เสมอในสภาพแวดล้อม production — ไม่พึ่งค่า fallback ที่ตั้งไว้ในโค้ด
- `POST /api/tap` เปิดสาธารณะโดยตั้งใจ (ไม่มี JWT) — ความปลอดภัยของ endpoint นี้ขึ้นกับการควบคุมทางกายภาพว่าใครเข้าถึงเครื่องอ่านที่ห้องทะเบียนได้บ้าง
- **เรื่อง MySQL เปิดออกอินเทอร์เน็ต:** สถาปัตยกรรมใหม่ (section 11) ไม่เปิดพอร์ต MySQL ออกอินเทอร์เน็ตเลยแม้แต่จุดเดียว (bridge คุย MySQL ผ่าน `localhost` เท่านั้น) ซึ่งปลอดภัยกว่าแผนเดิมที่จะเปิด TCP tunnel ตรงไปที่พอร์ต 3306 — ข้อควรระวังเรื่อง "ห้ามใช้ user root" ยังคงอยู่เหมือนเดิม แต่ตอนนี้ใช้กับ user ที่ **bridge-server.js** ใช้เชื่อมต่อ MySQL local แทน (ดู section 11.3)
- ค่า URL ของ bridge (`DB_BRIDGE_URL`) และคีย์ auth ของมัน (`DB_BRIDGE_KEY`) ควรถือเป็นความลับเทียบเท่ารหัสผ่าน — ไม่โพสต์ในที่สาธารณะ, ไม่ commit ขึ้น git

---

## 9. สิ่งที่ยังต้องตัดสินใจเพิ่มเติม

- [ ] ต้องการแจ้งเตือน (เสียง/ไลน์/อีเมล) เมื่อยืมเกินเวลาที่กำหนดหรือไม่
- [ ] ต้องการให้ปรับ `SESSION_TTL_MS` (ปัจจุบัน 20 วินาที ใน `routes/tap.js`) ให้นานขึ้นหรือไม่
- [ ] รองรับเครื่องอ่านหลายเครื่องพร้อมกัน (มี `readerId` รองรับไว้แล้วในโค้ด แต่ยังไม่ได้ใช้งานจริงหลายเครื่อง)

---

## 10. แผนปรับสถาปัตยกรรม RFID/สมัครครู (กำลังออกแบบ — ยังไม่ได้ลงมือแก้โค้ด)

> หมวดนี้สรุปจากบทสนทนาการออกแบบล่าสุด เพื่อให้เริ่มต่อได้ทันทีโดยไม่ต้องอธิบายซ้ำ
> **ยังไม่มีจุดไหนถูกเขียนเป็นโค้ดจริง** — ทุกอย่างด้านล่างคือข้อสรุปจากการคุยเพื่อ "ออกแบบก่อนโค้ด"
> เป็นคนละเรื่องกับ section 11 (สถาปัตยกรรมเชื่อมต่อ Render↔MySQL) — อย่าสับสนกัน

### 10.1 สิ่งที่จะเปลี่ยน (ยืนยันแล้ว)

- **ตัดหน้า teacher login ออกทั้งหมด** — ครูไม่ต้อง login ผ่านเว็บอีกต่อไป
- **หน้าเว็บ public ใหม่ (ไม่ต้อง login)** รวม 2 อย่างไว้หน้าเดียว โดยปรับจาก `login.html` เดิม:
  1. ดูสถานะกุญแจโดยรวมแบบสาธารณะ (เดิมอยู่ใน `teacher.html` — จะถูกยุบเข้ามารวม ไม่แยกหน้าแล้ว)
  2. ปุ่ม/ฟอร์มสมัครครู
- **Admin login (`admin.html`) ไม่เปลี่ยน** — ยังคง login ตามเดิมทุกอย่าง
- **การสมัครครูเปลี่ยนวิธีผูกแท็ก:**
  - เดิม: สมัครด้วยรหัสครูที่ตั้งเอง → แอดมินมาผูก `tag_uid` ให้ทีหลัง (คนละขั้นตอน)
  - ใหม่: กรอกแค่ชื่อ-แผนกในฟอร์ม → กด "เริ่มสมัคร" → หน้าเว็บบอกให้ไปแตะบัตรครูที่เครื่องอ่านที่ห้องทะเบียน → หน้าเว็บ poll backend (คล้าย `/api/tap/session` เดิม) รอจนกว่าจะมีการแตะเข้ามาจับคู่กับ session สมัครนี้ → ผูก `tag_uid` เข้ากับครูคนนั้นทันที จบในขั้นตอนเดียว ไม่ต้องกรอกรหัสครูเองอีก
  - ไม่มีช่อง input ให้เครื่องอ่านพิมพ์ค่าใส่ในหน้าเว็บแบบ keyboard emulation ตรงๆ แล้ว (ต่างจาก `rfid_reader_keyboard.py` เดิม) — เครื่องอ่านที่ห้องทะเบียนจะยิงค่าขึ้น backend เอง ไม่ผ่านหน้าเว็บ
- **เครื่องอ่านที่ห้องทะเบียนมีเครื่องเดียว** ใช้ได้ทั้งอ่านแท็กกุญแจและบัตรครู (คนละชนิดของเลขที่อ่านได้ — ต้องดูตัวอย่างค่าจริงจากทั้งสองแบบก่อนถึงจะแยกได้แน่ชัดว่าอ่านออกมาต่างกันยังไง)
- **โปรแกรม Python ที่ห้องทะเบียนต้องเปิดค้างไว้ตลอดเวลา** เป็นตัวขยายจาก `rfid_reader_keyboard.py` เดิม โดยเปลี่ยนพฤติกรรมจาก "พิมพ์ค่าลง input บนเว็บ" เป็น "ส่งค่าที่อ่านได้ขึ้น backend (Express) ผ่าน HTTP POST ทันทีที่แตะ"
- **Backend เป็นผู้ตัดสินใจ** ว่าเลขที่ส่งเข้ามาคือ "บัตรครู" หรือ "แท็กกุญแจ" แล้วค่อยแยก flow:
  - ถ้าอยู่ใน "โหมดรอสมัคร" (มีคนกรอกฟอร์มสมัครค้างอยู่และรอแตะบัตร) → ผูก `tag_uid` เข้ากับครูที่กำลังสมัคร
  - ถ้าไม่ใช่ → ประมวลผลยืม/คืนตาม flow เดิม (section 1)
- **กรณีแตะบัตรที่มีคนใช้อยู่แล้วตอนสมัคร (`tag_uid` ซ้ำ):** ต้องขึ้นแจ้งว่าบัตรนี้มีคนใช้แล้ว เพราะแนวคิดคือแท็กที่เคยเป็นแท็กแบนๆ พวงกุญแจ ตอนนี้เปลี่ยนเป็น **บัตรประจำตัวครูที่โรงเรียนออกให้ (มีชิปภายใน)** แทน — เป็นแท็กประจำตัวครู 1 ใบต่อ 1 คนเหมือนเดิม เพียงแต่รูปแบบบัตรเปลี่ยนไป
- **หน้าเว็บสมัครครูกับโปรแกรม Python ที่เครื่องอ่าน เป็นคนละหน้า/คนละโปรแกรมกัน** — หน้าเว็บดูสถานะออนไลน์ได้จากที่ไหนก็ได้ ส่วนโปรแกรม Python ที่ห้องทะเบียนต้องเปิดค้างไว้ตลอดเพื่อรับค่าจากเครื่องอ่านแล้วส่งขึ้นเซิร์ฟเวอร์

### 10.2 สิ่งที่ต้องตัดออกจากระบบเดิม

- หน้า teacher login tab ใน `login.html`
- `teacher.html` เป็นไฟล์แยก (เนื้อหาย้ายไปรวมในหน้า public หน้าเดียว)
- `POST /api/register/teacher` แบบกรอกรหัสครูเอง
- `POST /api/login/teacher`
- ขั้นตอน "แอดมินผูกแท็กให้ครูทีหลัง" ใน flow ปกติ (ผูกตอนสมัครทันทีแทน — แต่ต้องคุยเพิ่มว่าหน้าจัดการ `admin_teachers.js` / `POST /api/admin/teacher-tags` เดิมยังจะเก็บไว้เป็นทางแก้ไข/เคส exception ให้แอดมินหรือไม่)

### 10.3 คำถามค้าง — ต้องตอบก่อนเริ่มเขียนโค้ดจริง

ณ จุดที่บทสนทนาถูกตัดไว้ (ข้อความฟรีหมด) มีคำถาม 2 ข้อที่ถามไปแล้วแต่ยังไม่ได้รับคำตอบ:

1. **รูปแบบ session การสมัครที่รอแตะบัตร** ควรผูกกับอะไร — เช่น ต้องมีคนกำลังกรอกฟอร์มสมัครอยู่หน้าเว็บพร้อมกันแค่ 1 คนในเวลาเดียวกันทั้งระบบ หรือรองรับหลายคนกรอกพร้อมกันได้ (ต้องมี session id ส่งไปมาระหว่างหน้าเว็บกับเครื่องอ่านด้วยวิธีไหน เพราะเครื่องอ่านไม่รู้ว่าใครกำลังกรอกฟอร์มอยู่ นอกจากจะมีการส่ง session ไปเปิดรอไว้ที่ backend ก่อน)
2. **ระยะเวลารอแตะบัตรตอนสมัคร (timeout)** ควรตั้งไว้นานแค่ไหน และถ้าไม่มีใครแตะบัตรภายในเวลานั้น หน้าเว็บควรแจ้งเตือนหรือ reset ฟอร์มยังไง (คล้ายๆ concept `SESSION_TTL_MS` ที่มีอยู่แล้วใน `routes/tap.js` สำหรับ flow ยืม-คืน แต่คนละ session กัน ต้องตัดสินใจว่าจะใช้ค่าเดียวกันหรือแยกเป็นตัวแปรใหม่)

**หมายเหตุ:** ยังมีจุดที่ไม่ชัดเจนเพิ่มเติมที่ควรตัดสินใจไปพร้อมกัน (ไม่ได้ถูกถามตรงๆ ในบทสนทนา แต่กระทบการออกแบบ schema):
- ตาราง `teacher_tags` เดิมออกแบบเป็น `tag_uid` unique ผูกกับครู 1:1 — ต้องยืนยันว่ายังใช้ตารางเดิมได้ หรือควรเปลี่ยนชื่อ/โครงสร้างให้สื่อว่าเป็น "บัตรประจำตัวครู" แทน "แท็กกุญแจแบบเดิม"
- `POST /api/tap` เดิมออกแบบไว้สำหรับ flow ยืม-คืนอย่างเดียว (ไม่ผ่าน `requireAuth`) — ต้องตัดสินใจว่าจะเพิ่ม endpoint ใหม่แยกสำหรับ "แตะบัตรตอนสมัคร" (เช่น `POST /api/tap/register`) หรือให้ `/api/tap` เดิมรับทั้งสองเคสแล้วแยก logic ข้างในตามว่ามี session สมัครค้างอยู่หรือไม่

---

## 11. สถาปัตยกรรมเชื่อมต่อ Render ↔ MySQL local — เวอร์ชันล่าสุด (แทนที่ section 7)

> **อัปเดต: หัวข้อนี้เขียนโค้ดและทดสอบเสร็จครบแล้วทุกส่วน** (ต่างจากตอน
> เขียนหัวข้อนี้ครั้งแรกที่ยังเป็นแค่แผน) — ดูผลทดสอบจริงใน **section 14**
> ท้ายไฟล์ ไม่ใช่แค่แผนอีกต่อไปเหมือน section 10 (ที่ยังรอคำตอบคำถามค้าง)

### 11.1 ทำไมต้องเปลี่ยนจากแผนเดิม (TCP Tunnel)

แผนเดิม (section 7 เดิม) คือให้ Render ต่อ MySQL local ตรงๆ ผ่าน `mysql2`
โดยชี้ `DB_HOST` ไปที่ Cloudflare Tunnel — **แต่ Cloudflare Quick Tunnel
(แบบฟรี ไม่ต้องผูกโดเมน) รองรับเฉพาะ HTTP/HTTPS เท่านั้น ไม่รองรับการเปิด
TCP tunnel ตรงๆ** การจะเปิด TCP tunnel ได้ต้องผูกโดเมนกับ Cloudflare Zero
Trust ซึ่งมีขั้นตอนเพิ่มและไม่ใช่ "ฟรีแบบเสียบปุ๊บใช้ปั๊บ" แบบที่ตั้งใจไว้
— จึงตัดสินใจเปลี่ยนสถาปัตยกรรมทั้งหมด

**ข้อดีเพิ่มเติมที่ได้มาโดยไม่ได้ตั้งใจ:** วิธีใหม่นี้ปลอดภัยกว่าด้วย
เพราะไม่มีพอร์ต MySQL (3306) เปิดออกสู่อินเทอร์เน็ตเลยแม้แต่วินาทีเดียว
ต่างจากแผนเดิมที่ต้องเปิดพอร์ตฐานข้อมูลออกเน็ตจริง (แม้จะผ่าน tunnel ที่
URL เดายากก็ตาม)

### 11.2 สถาปัตยกรรมใหม่: HTTP Bridge

```
[Render: server.js + routes/*.js]
        |
        |  HTTPS POST https://xxxxx.trycloudflare.com/query
        |  (Cloudflare Quick Tunnel ห่อ HTTP ให้ฟรี — จุดนี้รองรับแน่นอน
        |   ต่างจาก TCP ที่ไม่รองรับ)
        v
[เครื่อง local: bridge-server.js]   <-- Express server ตัวเล็กๆ รันคู่กับ XAMPP
        |
        |  mysql2 ผ่าน localhost:3306 (ไม่เปิดออกอินเทอร์เน็ตเลย)
        v
[MySQL/MariaDB (XAMPP)]
```

**หลักการสำคัญ:** `config/db.js` (ไฟล์ที่ route ทุกไฟล์ import ไปใช้) ต้อง
คง **interface เดิมไว้ทุกจุด** (`query(sql, params)`,
`withTransaction(callback)`) — route files ที่จะเขียนกันต่อไปในลำดับ
MANIFEST (section 12) **ไม่ต้องรู้เลยว่าเบื้องหลังเป็น TCP ตรงหรือ HTTP
bridge** ตัว `db.js` จะสลับพฤติกรรมข้างในเองตาม env var:

- รันบนเครื่อง local ธรรมดา (`npm start` เพื่อ dev หรือใช้งานจริงที่
  เครื่องนั้นเอง) → `db.js` คุย MySQL ผ่าน `mysql2` ตรงๆ ผ่าน `localhost`
  เหมือนเดิมทุกประการ (เวอร์ชันที่ทดสอบผ่านแล้วใน section 12.1) — **ไม่ต้อง
  รัน bridge-server.js เลยในโหมดนี้**
- รันบน Render (มี env var บอกว่าเป็นโหมด bridge) → `db.js` ยิง HTTP ไปหา
  `bridge-server.js` แทน `pool.query()` ตรงๆ

### 11.3 ส่วนที่เขียนและทดสอบเสร็จแล้ว (เดิมเป็นงานค้าง ตอนนี้เสร็จหมดแล้ว)

ทั้ง 3 ส่วนนี้เขียนโค้ดจริงและทดสอบผ่านแล้ว (ดู section 14.2 สำหรับผลทดสอบ
ละเอียด) — เดิมหัวข้อนี้เคยเป็นรายการงานค้าง ตอนนี้เป็นบันทึกว่าทำอะไรไป
บ้างแทน:

1. **`bridge-server.js`** (รันที่เครื่อง local คู่กับ XAMPP) — เขียนเสร็จ
   - รับ HTTP POST: `/health`, `/query`, `/transaction/begin`,
     `/transaction/query`, `/transaction/commit`, `/transaction/rollback`
   - Auth ผ่าน header `X-Bridge-Key` เทียบกับ `BRIDGE_AUTH_KEY` แบบ
     timing-safe — ปฏิเสธทันทีถ้าไม่ตรง หรือถ้าไม่ได้ตั้งค่า
     `BRIDGE_AUTH_KEY` เลย server จะไม่ยอมสตาร์ท
   - Interactive transaction ที่ค้างข้าม HTTP request หลายครั้ง (เก็บ
     connection ไว้ใน Map ตาม txId) พร้อม auto-rollback ถ้าไม่มีการใช้งาน
     เกิน 30 วินาที (`TRANSACTION_TIMEOUT_MS`) กัน connection ค้าง
   - คุย MySQL ผ่าน `config/mysql-pool.js` เดียวกับที่โหมด local ใช้
     (ผ่าน `localhost` เท่านั้น ไม่เปิดพอร์ต MySQL ออกเน็ต)

2. **`config/db.js` เวอร์ชันสลับโหมด** — เขียนเสร็จ สลับตาม
   `DB_MODE=local|bridge` — `query()`/`withTransaction()`/`getConnection()`/
   `pool` มี signature เดิมทุกจุดไม่ว่าโหมดไหน (route files ไม่ต้องรู้เรื่อง
   bridge เลยตามที่ตั้งใจไว้) — ยกเว้น `pool` ที่โหมด bridge คืน `null`
   เสมอ (ไม่มี raw pool ให้ใช้ตรงๆ ในสถาปัตยกรรม HTTP) — **นี่คือจุดที่
   admin_rooms.js เคยพังเพราะเรียก `pool.query()` ตรงๆ แก้แล้ว ดู
   section 14.2**

3. **ทดสอบทั้งวงจรจริง** (จำลอง Render เรียก bridge เรียก MySQL) — ทำแล้ว
   ด้วยการปลอม (mock) `mysql2/promise` module และยิง HTTP จริงผ่าน
   `bridge-server.js` ที่รันขึ้นมาจริง ครบทั้ง query เดี่ยว, transaction
   commit/rollback, auth reject, และ route files จริง (`admin_rooms.js`)
   คุยผ่าน chain เต็ม: route → `db.js` (bridge) → `db-bridge-client.js` →
   HTTP → `bridge-server.js` → `mysql-pool.js` — ดูผลละเอียดใน section 14.2

### 11.4 Environment Variables — ยืนยันชื่อตัวแปรแล้ว (ตรงกับ `.env.example`)

**เครื่อง local (รัน `bridge-server.js`):**
```
DB_HOST=localhost         # เหมือนเดิม — bridge คุย MySQL ผ่าน localhost
DB_USER=...                # เหมือนเดิม — ต้องไม่ใช่ root ดู section 12.3
DB_PASSWORD=...
DB_NAME=key_borrow_db
DB_PORT=3306
BRIDGE_PORT=4001           # ค่า default ถ้าไม่ตั้ง — ยืนยันแล้วตรงกับ bridge-server.js
BRIDGE_AUTH_KEY=...        # ต้องตั้งเสมอ ไม่มี default — bridge-server.js ไม่ยอมสตาร์ทถ้าไม่ตั้ง
```

**Render (`DB_MODE=bridge`):**
```
DB_MODE=bridge
DB_BRIDGE_URL=https://xxxxx.trycloudflare.com   # ยืนยันชื่อแล้ว ตรงกับ db-bridge-client.js
DB_BRIDGE_KEY=...                                # ต้องตรงกับ BRIDGE_AUTH_KEY ฝั่ง local เป๊ะ
```

ชื่อตัวแปรทั้งหมดด้านบนยืนยันตรงกับโค้ดจริงแล้ว (`config/mysql-pool.js`,
`bridge-server.js`, `config/db-bridge-client.js`) และอัปเดตลง
`.env.example` ครบแล้ว — ไม่ใช่แผนที่ยังไม่ยืนยันอีกต่อไป

> Quick Tunnel จะได้ URL ใหม่ทุกครั้งที่รันคำสั่งใหม่ — ถ้า URL เปลี่ยน
> ต้องเข้าไปแก้ `DB_BRIDGE_URL` บน Render ใหม่ทุกครั้งเหมือนปัญหาเดิมที่
> เคยพูดถึงตอนวางแผน TCP tunnel (section 7.1 เดิม) — ปัญหานี้ยังอยู่
> เหมือนกันไม่ว่าจะ tunnel แบบ HTTP หรือ TCP ถ้าต้องการ URL คงที่ถาวร
> ต้องผูกโดเมนกับ Cloudflare เหมือนเดิม

### 11.5 Trade-off ที่ยังอยู่เหมือนเดิม (ไม่เปลี่ยนจากแผนเดิม)

- เครื่อง local ต้องเปิดค้างไว้ตลอดเวลาที่ต้องการให้เว็บ Render ใช้งานได้
  — ถ้าเครื่องปิด, MySQL ไม่ได้ Start, หรือ `bridge-server.js` /
  Cloudflare Tunnel ไม่ได้รันอยู่ → **เว็บที่ Render จะใช้งานไม่ได้ทันที**
  ไม่ต่างจากแผนเดิมเลย เพียงแค่เปลี่ยนว่า "อะไรต้องรันค้างไว้" จาก
  (MySQL + cloudflared tunnel ไปพอร์ต 3306) เป็น
  (MySQL + bridge-server.js + cloudflared tunnel ไปพอร์ต bridge)
- ยังเป็นสถาปัตยกรรม "ฐานข้อมูลชุดเดียว อยู่หลังเครื่อง local เครื่องเดียว"
  เหมือนเดิมทุกประการ — แค่เปลี่ยนโปรโตคอลที่ใช้คุยกันเท่านั้น

---

## 12. บันทึกการตรวจสอบจริง (ทดสอบแล้ว ไม่ใช่แค่แผน)

หัวข้อนี้ต่างจาก section 10 และ 11 ตรงที่ **ทุกอย่างในนี้ทดสอบรันจริงแล้ว**
(ติดตั้ง MariaDB ในสภาพแวดล้อมทดสอบ รัน schema.sql จริง ยิง query ผ่าน
db.js จริง) ไม่ใช่แค่แผนที่ยังไม่ได้ลงมือ

### 12.1 `config/db.js` (เวอร์ชันคุย MySQL ตรงผ่าน TCP — เวอร์ชันปัจจุบัน)

ทดสอบผ่านทั้งหมด ไม่ต้องแก้โค้ด:
- `query()` ยิง SELECT/INSERT/UPDATE ได้ถูกต้อง
- `dateStrings: true` คืนค่า DATETIME เป็น string จริง (เช่น
  `"2026-08-28 11:01:29"`) ไม่ใช่ JS Date object ตามที่ตั้งใจไว้ในคอมเมนต์
- `namedPlaceholders: true` ทำงานถูกต้อง
- `withTransaction()` **commit สำเร็จจริง** เมื่อทุก query ในนั้นผ่าน — ทดสอบ
  ด้วยการ insert `teachers` + `teacher_tags` สองคำสั่งในธุรกรรมเดียว
- `withTransaction()` **rollback สำเร็จจริง** เมื่อ query กลางทางล้มเหลว —
  ทดสอบด้วยการจงใจ insert `teacher_tags` ที่ `tag_uid` ซ้ำ (unique
  constraint violation) แล้วยืนยันว่าแถว `teachers` ที่ insert ไปก่อนหน้า
  ในธุรกรรมเดียวกัน**ไม่หลงเหลืออยู่จริง** (ไม่มีข้อมูลครึ่งๆ กลางๆ ค้าง)

**หมายเหตุสำคัญ:** นี่คือเวอร์ชันที่คุย MySQL ตรงๆ (`DB_HOST`/`DB_USER`
ตรงไป pool) — เมื่อเปลี่ยนไปใช้สถาปัตยกรรม bridge (section 11) ไฟล์นี้จะ
ต้องถูกแก้เพิ่ม logic สลับโหมด แต่การทดสอบทั้งหมดข้างต้นยังใช้ยืนยันโหมด
"local ตรงๆ" ได้อยู่ (โหมดที่ `bridge-server.js` เองก็จะใช้คุย MySQL
เหมือนกัน เพียงแต่ bridge-server.js เป็นคนเรียก ไม่ใช่ route files
โดยตรง)

### 12.2 `sql/schema.sql` — พบบั๊กจริง 1 จุด แก้แล้ว

ทดสอบรันจริงบน **MariaDB 10.11.14** (เวอร์ชันที่ตรงกับที่ XAMPP รุ่นใหม่ๆ
ให้มา) พบปัญหาและแก้ไปแล้ว:

**ปัญหา:** `chk_room_tags_borrower` (CHECK constraint ที่คุมว่า `status`
ต้องสอดคล้องกับ `borrowed_by_teacher_id`/`borrowed_at` เสมอ) รันไม่ผ่าน
บน MariaDB 10.11.14 จริง — error `1901`:
```
Function or expression 'borrowed_by_teacher_id' cannot be used in the
CHECK clause of `chk_room_tags_borrower`
```

**สาเหตุที่แท้จริง (ยืนยันด้วยการทดสอบแยก):** MariaDB (InnoDB) ไม่ยอมให้
คอลัมน์เดียวกันถูกใช้ทั้งใน `CHECK` constraint และใน
`FOREIGN KEY ... ON DELETE SET NULL` พร้อมกันในตารางเดียวกัน — **ไม่ใช่
เรื่องเวอร์ชันเก่า/ใหม่** แบบที่ comment เดิมในไฟล์ตั้งข้อสังเกตไว้ตอนแรก
(สมมติว่า "ถ้าเวอร์ชันต่ำกว่า 10.2 ให้ตัดออก") — แม้แต่ 10.11.14 ที่ใหม่
กว่าเกณฑ์มากก็ยัง error เหมือนกัน ทดสอบแยกยืนยันแล้วว่า:
- CHECK เดี่ยวๆ (ไม่มี FK ประกบคอลัมน์เดียวกัน) → ผ่าน
- CHECK + FK บนคอลัมน์เดียวกัน → error 1901 เสมอ

**การแก้ไข:** ตัด `chk_room_tags_borrower` ออกจาก `schema.sql` แล้ว (มี
comment อธิบายไว้ในไฟล์ตรงจุดที่ตัดออก) — `chk_room_tags_status` และ
`chk_key_logs_action` ไม่กระทบเพราะคอลัมน์ที่ใช้ไม่มี FK ประกบ ทดสอบแล้ว
ว่าทั้งสองอันนี้รันผ่านปกติ

**ความเสี่ยงที่เหลือ (ทดสอบยืนยันแล้วว่ามีจริง ไม่ใช่แค่ทฤษฎี):** เมื่อไม่มี
`chk_room_tags_borrower` แล้ว ข้อมูลแบบ `status='available'` แต่
`borrowed_by_teacher_id` ไม่ใช่ NULL **insert เข้าไปได้จริงโดยไม่มี error
ใดๆ** ทดสอบยืนยันแล้ว — ตอนเขียน `routes/tap.js` (และทุกจุดที่ update
`status`) **ต้องเซ็ต `status`/`borrowed_by_teacher_id`/`borrowed_at`
พร้อมกันเสมอทุกครั้ง** (ตรงกับที่ MANIFEST เดิม/section 10 อ้างไว้ว่าโค้ด
เดิมบน Postgres ก็ทำแบบนี้อยู่แล้ว — ไม่ใช่ requirement ใหม่ แต่ตอนนี้
สำคัญกว่าเดิมเพราะไม่มี DB constraint คอยกันไว้อีกชั้นแล้ว)

**ทดสอบอื่นๆ ที่ผ่านครบ:**
- Conditional update กัน race condition (ตามที่ MANIFEST ข้อ 2 อธิบาย):
  ทดสอบยืมห้องเดียวกันสองครั้งติดกันด้วย
  `UPDATE ... WHERE id=? AND status='available'` — ครั้งแรก
  `affectedRows=1` (สำเร็จ), ครั้งที่สอง `affectedRows=0` (กันซ้ำได้จริง)
- `borrow_window_days` เก็บ/อ่านเป็น JSON array (`[1,2,3,4,5]`) ได้ถูกต้อง
- `ON DELETE SET NULL` (`room_tags.borrowed_by_teacher_id` → `teachers`):
  ลบครูที่ยืมอยู่ → คอลัมน์ที่เกี่ยวข้องเป็น NULL จริงตามที่ควร
- `ON DELETE CASCADE` (`room_images.room_tag_id` → `room_tags`): ลบห้อง →
  รูปภาพที่ผูกกับห้องนั้นถูกลบตามจริง
- ภาษาไทยใน `TEXT`/`VARCHAR` (utf8mb4) เก็บและอ่านออกมาถูกต้อง ไม่มีปัญหา
  encoding
- Foreign key ครบทั้ง 5 จุดตามที่ MANIFEST ระบุ (`room_tags.borrowed_by →
  teachers`, `room_images.room_tag_id → room_tags`,
  `teacher_tags.teacher_id → teachers`, `key_logs.room_tag_id →
  room_tags`, `key_logs.teacher_id → teachers`)

### 12.3 เรื่องสำคัญที่เพิ่งเจอ — `root` ของ XAMPP มักต่อผ่าน TCP ไม่ได้

**ไม่เกี่ยวกับไฟล์ `db.js`/`schema.sql` โดยตรง แต่เป็นเรื่องที่จะเจอแน่นอน
ตอน setup จริงบนเครื่อง local:**

XAMPP MySQL/MariaDB ปกติมี `root@localhost` ที่ไม่มี password และ auth
ผ่าน unix socket ได้เท่านั้น แต่ **Node.js (mysql2) ต่อผ่าน TCP เสมอ** แม้
`DB_HOST` จะตั้งเป็น `localhost` หรือ `127.0.0.1` ก็ตาม — ถ้า `root` ไม่มี
host entry ที่รองรับ TCP (`root@127.0.0.1` หรือ `root@%` แบบมี password)
จะเจอ error ทันที:
```
Access denied for user 'root'@'localhost'
```
(error message จะโชว์ `'localhost'` แม้จะต่อผ่าน `127.0.0.1` จริง เพราะ
MariaDB มองสองชื่อนี้เป็นตัวเดียวกันตอนเช็คสิทธิ์ — ยืนยันด้วยการทดสอบแยก
แล้วว่าเกิดจากตรงนี้จริง ไม่ใช่ปัญหาที่ `db.js`)

**วิธีแก้ที่ทดสอบแล้วว่าใช้ได้จริง:** สร้าง MySQL user ใหม่ที่ host เป็น
`%` และมี password จริง (ไม่ใช่ `root`, ไม่ใช่ host `localhost` เฉยๆ) แล้ว
จำกัดสิทธิ์เฉพาะ database ที่ใช้งาน:
```sql
CREATE USER 'app_user'@'%' IDENTIFIED BY 'รหัสผ่านจริง';
GRANT ALL PRIVILEGES ON key_borrow_db.* TO 'app_user'@'%';
FLUSH PRIVILEGES;
```
ใช้ user ตัวนี้ทั้งใน `.env` ตอน dev local (section 6.2) และใน
`bridge-server.js` ตอน deploy จริง (section 11.4) — **ตรงกับคำเตือนเรื่อง
ห้ามใช้ root ที่มีอยู่แล้วใน section 8 พอดี เพียงแต่ตอนนี้มีเหตุผลเพิ่มอีก
ข้อว่า root เดิมอาจต่อผ่าน TCP ไม่ได้เลยด้วยซ้ำ ไม่ใช่แค่เรื่องความ
ปลอดภัยอย่างเดียว**

---

## 13. ลำดับงานที่แนะนำ (อัปเดตจาก MANIFEST เดิม)

> ⚠️ **section 13.1/13.4 ด้านล่างเป็นสถานะเก่าตอนเริ่มงาน (ทุกอย่างยัง 🔲)
> ตอนนี้ทำเสร็จและทดสอบผ่านครบทุกไฟล์แล้ว — ดูสถานะจริงล่าสุดใน section 14
> แทน ตารางด้านล่างนี้เก็บไว้เพื่อดูว่าตอนเริ่มงานวางแผนไว้อย่างไร**

### 13.1 ไฟล์ที่ต้องแก้ทั้งหมด (10 ไฟล์ + schema) — สถานะตอนเริ่มงาน (ล้าสมัยแล้ว ดู section 14.1)

| ไฟล์ | งานหลัก | สถานะ (ตอนเริ่ม) |
|---|---|---|
| `schema.sql` | เขียนใหม่ทั้งหมดเป็น MySQL DDL | ✅ เขียนแล้ว + ทดสอบแล้ว (section 12.2) |
| `config/db.js` | แทนที่ `config/supabaseClient.js` ด้วย mysql2 pool | ✅ เขียนแล้ว + ทดสอบแล้ว (section 12.1) — **จะต้องแก้เพิ่มอีกรอบสำหรับ bridge mode (section 11.3)** |
| `bridge-server.js` | ไฟล์ใหม่ (ไม่มีใน MANIFEST เดิม) รับ HTTP จาก Render ส่งต่อ MySQL local | 🔲 ยังไม่ได้เขียน — ดู section 11.3 |
| `server.js` | แก้แค่จุด require ไฟล์ config ใหม่ | 🔲 ยังไม่ได้แก้ |
| `routes/tap.js` | query หลักของระบบ — เขียนใหม่ทั้งหมด (มี conditional update กัน race) | 🔲 ยังไม่ได้แก้ |
| `routes/auth.js` | เขียนใหม่เฉพาะส่วนสร้างครู (ผ่าน `register_session.js` flow เดิม) | 🔲 ยังไม่ได้แก้ |
| `routes/keys.js` | เขียนใหม่ทั้งหมด (JOIN + pagination) | 🔲 ยังไม่ได้แก้ |
| `routes/admin_keys.js` | เขียนใหม่ทั้งหมด (JOIN + batch query) | 🔲 ยังไม่ได้แก้ |
| `routes/admin_teachers.js` | เขียนใหม่ทั้งหมด (CRUD ธรรมดา) | 🔲 ยังไม่ได้แก้ — **ควรเริ่มจากไฟล์นี้ต่อ (ง่ายสุด)** |
| `routes/admin_rooms.js` | เขียนใหม่ทั้งหมด + เปลี่ยนการอัปโหลดรูปเป็น disk storage | 🔲 ยังไม่ได้แก้ |
| `routes/export.js` | แก้แค่ query ดึงข้อมูล (`fetchHistoryForExport`) ส่วน CSV/DOCX generation เดิมไม่ต้องแตะ | 🔲 ยังไม่ได้แก้ |
| `routes/middleware_auth.js` | **ไม่ต้องแก้เลย** — เป็น JWT ล้วนๆ ไม่แตะ DB | ✅ ไม่ต้องแก้ |
| `routes/register_session.js` | **ไม่ต้องแก้เลย** — เก็บ state ใน memory ไม่แตะ DB | ✅ ไม่ต้องแก้ |
| `.env` | เปลี่ยนจาก `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` → `DB_HOST`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` (+ ตัวแปร bridge ใหม่ ดู section 11.4) | 🔲 ยังไม่ได้แก้ |
| `package.json` | ถอด `@supabase/supabase-js` ออก เพิ่ม `mysql2` + `multer` (ถ้ายังไม่มี) | 🔲 ยังไม่ได้แก้ |

### 13.2 จุดที่ไม่ใช่แค่แปล syntax ต้องคิด logic ใหม่ (จาก MANIFEST เดิม — ยังใช้ได้ทั้งหมด)

**1. `borrow_window_days` — Postgres array → MySQL:** เก็บเป็น **`JSON`
column** เก็บเป็น `[1,2,3,4,5]` แล้ว parse/stringify เองในโค้ด — ทดสอบแล้ว
ว่าใช้งานได้จริง (section 12.2)

**2. Conditional update กัน race condition (`tap.js`):** ของเดิม
`.update({...}).eq("id", roomTag.id).eq("status", "available").select().maybeSingle()`
MySQL ทำแบบเดียวกันด้วย `UPDATE ... WHERE id = ? AND status = 'available'`
แล้วเช็ค `result.affectedRows === 0` แทนการเช็ค `null` — ต้อง `SELECT`
แถวใหม่อีกทีหลัง update สำเร็จ — **ทดสอบแล้วว่าทำงานถูกต้องจริง (section
12.2)**

**3. Nested/embedded select ทั้งหมดต้องเขียนเป็น `JOIN`:** ตัวอย่างที่ใช้
เยอะสุด — `borrowed_by:borrowed_by_teacher_id(id, name, department)`:
```sql
SELECT rt.*, t.id AS borrowed_by_id, t.name AS borrowed_by_name, t.department AS borrowed_by_department
FROM room_tags rt
LEFT JOIN teachers t ON t.id = rt.borrowed_by_teacher_id
```
แล้ว map ผลลัพธ์กลับเป็น shape เดิม
`{ ...room, borrowed_by: { id, name, department } | null }` ในโค้ด JS
ก่อนส่ง response — ทำจุดนี้ให้ตรงทุก endpoint ที่มี nested select เดิม
(`keys.js`, `admin_keys.js`, `export.js` ล้วนมี pattern นี้)

**4. `room_images` join แบบ array (`keys.js` GET /keys/status):** ของเดิม
ใช้ PostgREST embed ดึง `room_images(...)` เป็น array ซ้อนในแถวเดียวของ
`room_tags` เลย MySQL ต้อง query 2 รอบ (ห้องทั้งหมด → รูปทั้งหมดของห้อง
เหล่านั้นด้วย `WHERE room_tag_id IN (...)`) แล้ว group เข้าด้วยกันเองใน
โค้ด JS — ห้ามลืม sort ตาม `sort_order` ตอน group

**5. Pagination แบบ count คู่กับ range (`keys.js` GET /keys/history/all):**
ของเดิม `{ count: "exact" }` + `.range(from, to)` คืน count มาพร้อมกันใน
query เดียว MySQL ต้องแยกเป็น 2 query ชัดเจน: `SELECT COUNT(*) ...` กับ
`SELECT ... LIMIT ? OFFSET ?` (`admin_keys.js` history และ `export.js`
ไม่ต้องกังวลจุดนี้เพราะไม่มี count)

**6. CHECK constraint (`chk_room_tags_borrower`):** ⚠️ **อัปเดตจาก MANIFEST
เดิม** — เดิมคาดว่าปัญหาจะเกิดเฉพาะเวอร์ชันเก่า แต่ทดสอบจริงแล้วพบว่า
constraint นี้รันไม่ผ่านบน MariaDB **ทุกเวอร์ชัน** (แม้แต่ 10.11.14 ที่
ใหม่มาก) เมื่อผสมกับ FK บนคอลัมน์เดียวกัน — **ตัดออกจาก schema แล้วจริง**
(ดู section 12.2) พึ่ง logic ฝั่งแอป (`tap.js`) คุมแทนทั้งหมด (ของเดิมก็
เขียนแบบ set ทั้งคู่พร้อมกันอยู่แล้วในทุกจุดที่ update สถานะ)

**7. `on delete cascade` / `on delete set null`:** MySQL รองรับเหมือน
Postgres แต่ทั้งสอง table ต้องเป็น **InnoDB** engine — ระบุ
`ENGINE=InnoDB` ชัดเจนในทุก `CREATE TABLE` แล้ว — **ทดสอบแล้วว่าทำงานถูก
ต้องจริง (section 12.2)**

**8. รูปภาพ: Supabase Storage → ไฟล์บนดิสก์:** ดู section 3.1

**9. Transaction สำหรับ multi-step insert:** จุดที่ Supabase ทำหลาย
insert/update ต่อกันแบบไม่มี transaction จริง (เช่น `tap.js` สร้างครูใหม่
+ insert `teacher_tags` สองคำสั่งแยกกัน, `admin_rooms.js` insert หลายรูป
พร้อมกัน) ตอนย้ายมา MySQL ห่อด้วย `connection.beginTransaction()` /
`commit()` / `rollback()` ผ่าน `withTransaction()` helper ใน `db.js` —
**ทดสอบแล้วว่า commit และ rollback ทำงานถูกต้องจริงทั้งคู่ (section
12.1)**

### 13.3 สิ่งที่ไม่ต้องเปลี่ยนเลย (จาก MANIFEST เดิม)

- Business logic ทั้งหมดใน `tap.js` (session, toggle borrow/return,
  isWithinBorrowWindow) — เปลี่ยนแค่การเรียก DB ข้างใน ไม่แตะเงื่อนไข
- `middleware_auth.js` — JWT ล้วนๆ ไม่แตะ DB เลย
- `register_session.js` — เก็บ state ใน memory ไม่แตะ DB เลย
- CSV/DOCX generation logic ใน `export.js` (`buildCsv`, `buildDocx`,
  `csvEscapeField`, ฯลฯ) — แก้แค่ query ที่ป้อนข้อมูลเข้าไป
- Response shape (`{ ok, message, ... }`) ของทุก endpoint — frontend
  พึ่งชื่อ field พวกนี้อยู่ ต้องคงเดิมเป๊ะแม้ query เบื้องหลังเปลี่ยน

### 13.4 ลำดับการทำที่แนะนำ (อัปเดต — เพิ่มขั้นตอน bridge) — แผนตอนเริ่มงาน (ทำเสร็จหมดแล้ว ดู section 14)

1. ✅ ติดตั้ง MySQL ผ่าน XAMPP + เปิด phpMyAdmin สร้าง database เปล่าไว้ก่อน
2. ✅ เขียน `schema.sql` เวอร์ชัน MySQL — ทดสอบผ่านแล้ว (section 12.2)
3. ✅ เขียน `config/db.js` (connection pool โหมด local ตรง) — ทดสอบผ่าน
   แล้ว (section 12.1)
4. ✅ เขียน `bridge-server.js` + แก้ `config/db.js` ให้สลับโหมด
   local/bridge ได้ (section 11.3) — เสร็จและทดสอบแล้ว ดู section 14.2
5. ✅ ไล่แก้ทุก route ไฟล์ครบแล้ว (`admin_teachers.js`, `keys.js`,
   `admin_keys.js`, `export.js`, `admin_rooms.js`, `tap.js`, `auth.js`,
   `middleware_auth.js`, `register_session.js`) — ทดสอบผ่านทุกไฟล์ ดู
   section 14.1
6. 🔲 แก้ `.env` จริงบนเครื่อง (`.env.example` อัปเดตครบแล้ว พร้อมใช้อ้างอิง)
   — `server.js` ตรวจแล้วว่า require path ถูกต้อง ไม่ต้องแก้
7. 🔲 ทดสอบทีละ endpoint ด้วย flow จริงบนเครื่อง + MySQL จริง (XAMPP):
   สมัครครู (แตะบัตร) → ยืมกุญแจ → คืนกุญแจ → ดูประวัติ → export →
   อัปโหลดรูปห้อง — **ยังไม่ได้ทำ เพราะแซนด์บ็อกซ์ที่ตรวจโค้ดไม่มี MySQL/
   XAMPP จริงให้ต่อ ต้องทำบนเครื่อง local จริงเท่านั้น**
8. 🔲 ทดสอบสถาปัตยกรรม bridge แบบครบวงจรด้วย Cloudflare Tunnel จริง (จำลอง
   Render เรียกจริงผ่าน tunnel จริง ไม่ใช่แค่ mock) ก่อน deploy ขึ้น
   Render จริง — **ยังไม่ได้ทำเหมือนกัน ด้วยเหตุผลเดียวกับข้อ 7**

### 13.5 คำแนะนำเรื่องอัปไฟล์รอบต่อไป

อัปไฟล์ตามลำดับที่จะลงมือแก้จริง (จากข้อ 13.4 ด้านบน) ไม่ต้องอัปทั้งชุด
พร้อมกัน — `schema.sql`/`db.js` ทำเสร็จและทดสอบแล้ว (ไม่ต้องอัปซ้ำ) ขั้น
ต่อไปคือ **`bridge-server.js`** (ไฟล์ใหม่ ยังไม่มีต้นฉบับ เขียนจากศูนย์
ตาม section 11.3) หรือถ้าอยากข้ามไปทำ routes ก่อนก็ได้ เพราะ routes ไม่
ต้องพึ่ง bridge เลย — ถ้าจะเริ่ม routes ให้อัป `routes/admin_teachers.js`
เวอร์ชัน Supabase เดิม (ไฟล์ต้นฉบับที่ยังไม่มีให้ในเซสชันนี้เลย) มาก่อน
เพื่อใช้เทียบตอนเขียนเวอร์ชัน MySQL