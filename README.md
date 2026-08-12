# ระบบยืม–คืนกุญแจด้วยแท็ก RFID

ระบบยืม-คืนกุญแจห้อง สำหรับครู โดยใช้เครื่องอ่านแท็ก RFID (Keyboard Emulation)
ที่ห้องทะเบียน — แตะแท็กครู แล้วแตะแท็กกุญแจ ระบบจะยืม/คืนให้อัตโนมัติ
ไม่ต้องมีขั้นตอนอนุมัติ

**สแต็กที่ใช้จริง:** Node.js (Express) + MySQL/MariaDB (รันบนเครื่อง local
ผ่าน XAMPP) + JWT + Render (hosting เว็บ/API) เชื่อมต่อฐานข้อมูลกลับมาที่
เครื่อง local ผ่าน Cloudflare Tunnel

> **สถาปัตยกรรมข้อมูล:** มีฐานข้อมูลชุดเดียว (MySQL บนเครื่อง local)
> ให้ทั้งสองทางใช้ร่วมกัน — เปิดจากเครื่อง local ต่อผ่าน `localhost` ตรงๆ
> (ใช้งานได้แม้ไม่มีเน็ต) ส่วนเปิดจากเว็บ Render (ออนไลน์) จะยิง query
> ผ่าน Cloudflare Tunnel กลับมาที่เครื่องเดียวกันนี้ — **ถ้าเครื่อง local
> ปิดหรือ MySQL/tunnel ไม่ได้รัน เว็บฝั่ง Render จะใช้งานไม่ได้ทันที**
> เพราะฐานข้อมูลจริงอยู่หลังเครื่องนี้เครื่องเดียว

---

## 1. ภาพรวมการทำงาน

**Flow หลัก (ที่เครื่องอ่านแท็ก ห้องทะเบียน)**

1. ครูแตะแท็กประจำตัว 1 ครั้ง → ระบบเปิด "session" ชั่วคราวผูกกับครูคนนั้น
2. แตะแท็กกุญแจ (ยืมได้หลายดอกต่อเนื่องในรอบเดียว) → ระบบเช็คสถานะกุญแจ:
   - ว่างอยู่ (`available`) → บันทึกเป็นการ **ยืม**
   - ถูกยืมอยู่โดยครูคนเดียวกับ session → บันทึกเป็นการ **คืน**
   - ถูกยืมอยู่โดยครูคนอื่น → แจ้ง error ไม่ทำอะไร
3. Session หมดอายุอัตโนมัติถ้าไม่แตะกุญแจต่อภายใน 20 วินาที (แตะแท็กครูใหม่เพื่อเริ่ม session ใหม่ได้เสมอ)

**สถาปัตยกรรมระบบ**

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

**การเข้าถึงสองทาง (ใช้ฐานข้อมูลชุดเดียวกัน):**

```
[ผู้ใช้ในเครื่อง local]
        |
        v
  http://localhost:3000  (npm start)
        |
        v
  MySQL localhost:3306  <-------------------+
                                             |
[ผู้ใช้ผ่านอินเทอร์เน็ต]                        | Cloudflare Tunnel
        |                                   |
        v                                   |
   เว็บ Render (โค้ดชุดเดียวกัน) -------------+
```

เครื่อง local ต้องเปิดค้างไว้ตลอดเวลา (Node.js/MySQL/XAMPP + Cloudflare
Tunnel) เพราะเป็นที่เก็บฐานข้อมูลจริงเพียงชุดเดียวของทั้งระบบ — ดูวิธี
ตั้งค่า tunnel ใน section 7

---

## 2. โครงสร้างโปรเจกต์

```
webapp/
├─ server.js                   # entry point, mount ทุก route
├─ package.json
├─ .env                        # ค่าจริง (ไม่ commit ขึ้น git)
├─ .env.example                # ตัวอย่าง placeholder เท่านั้น
├─ config/
│  └─ db.js                    # mysql2 connection pool จาก env
├─ routes/
│  ├─ auth.js                  # สมัคร/ล็อกอินครู, ล็อกอินแอดมิน, /me
│  ├─ middleware_auth.js       # JWT: signToken, requireAuth, requireRole
│  ├─ tap.js                   # POST /api/tap (endpoint หลักของเครื่องอ่าน)
│  ├─ keys.js                  # ครูดูสถานะกุญแจ + ประวัติของตัวเอง
│  ├─ admin_rooms.js           # แอดมิน CRUD ห้อง/กุญแจ
│  ├─ admin_teachers.js        # แอดมิน assign แท็กให้ครู
│  └─ admin_keys.js            # แอดมินดูสถานะ/ประวัติกุญแจทั้งหมด
├─ public/                     # frontend (static files)
└─ sql/                        # schema.sql
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

key_logs                      -- ประวัติยืม-คืนทั้งหมด
├─ id, room_tag_id (FK -> room_tags), teacher_id (FK -> teachers)
├─ action ('borrow' | 'return')
├─ acted_at

room_images                   -- หลายรูปต่อห้อง/กุญแจ 1 ดอก
├─ id, room_tag_id (FK -> room_tags), image_url, sort_order, created_at
```

ระบบนี้**ไม่มี**นักเรียน, ไม่มี `room_items`, ไม่มีขั้นตอน pending/approve,
และไม่มีการมอบหมายครูดูแลห้องเฉพาะ (ครูคนไหนมีแท็กก็ยืมกุญแจดอกไหนก็ได้)

**เรื่องรูปภาพห้อง:** เก็บเป็นไฟล์จริงบนดิสก์ที่
`public/uploads/room-images/` (ไม่ใช้ Supabase Storage แล้ว) คอลัมน์
`image_url` เก็บ path สัมพัทธ์ เช่น `/uploads/room-images/room-12-xxx.jpg`
— schema เต็มอยู่ที่ `sql/schema.sql` (เวอร์ชัน MySQL DDL)

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
> ใช้ได้ตอน dev บนเครื่อง local เฉยๆ **ถ้าจะเปิดให้ Render เข้าถึงผ่าน
> tunnel (section 7) ควรสร้าง MySQL user แยกที่ไม่ใช่ `root` และจำกัด
> สิทธิ์เฉพาะ database `key_borrow_db` เท่านั้น** ไม่ใช้ user เดียวกับที่
> phpMyAdmin ใช้เต็มสิทธิ์

### 6.3 รันเซิร์ฟเวอร์
```bash
npm start
```
เปิดที่ `http://localhost:3000`

> ก่อนรัน ต้องเปิด **XAMPP Control Panel → Start MySQL** ไว้ก่อนเสมอ
> ดูรายละเอียดการติดตั้ง XAMPP + import schema ใน `FOR_ME.md`

---

## 7. Deploy ขึ้น Render (เว็บออนไลน์ + ต่อกลับ MySQL บนเครื่อง local ผ่าน Cloudflare Tunnel)

**แนวคิด:** ฐานข้อมูล MySQL มีอยู่ชุดเดียวบนเครื่อง local (เครื่องที่รัน
XAMPP) เว็บที่ deploy บน Render เป็นโค้ดชุดเดียวกับที่รันบนเครื่อง local
เพียงแต่ `DB_HOST` ชี้ไปที่ **Cloudflare Tunnel** แทน `localhost` — ทำให้
Render คุยกับ MySQL เครื่องเดียวกับที่เครื่อง local ใช้อยู่ได้ ไม่ต้องมี
ฐานข้อมูลแยกอีกชุด

> ⚠️ **ข้อจำกัดสำคัญ:** เพราะฐานข้อมูลอยู่หลังเครื่อง local เครื่องเดียว
> — ถ้าเครื่องนั้นปิด, MySQL ไม่ได้ Start ไว้ใน XAMPP, หรือ Cloudflare
> Tunnel ไม่ได้รันอยู่ → **เว็บที่ Render จะใช้งานไม่ได้ทันที** (error
> ต่อฐานข้อมูลไม่ได้) เครื่อง local จึงต้องเปิดค้างไว้ตลอดเวลาที่ต้องการ
> ให้เว็บออนไลน์ใช้งานได้

### 7.1 เปิด Cloudflare Tunnel บนเครื่อง local (ทำก่อนเสมอ)

ติดตั้ง `cloudflared` และรัน tunnel ชี้ไปที่พอร์ต MySQL — ดูขั้นตอนติดตั้ง
แบบละเอียดทีละคำสั่งใน `FOR_ME.md` หัวข้อ "Cloudflare Tunnel" เมื่อรัน
สำเร็จจะได้ URL ชั่วคราวรูปแบบ `xxxxx.trycloudflare.com` มาใช้เป็นค่า
`DB_HOST` บน Render (ใน section 7.3)

> Quick Tunnel (แบบไม่ผูกโดเมน) จะได้ URL ใหม่ทุกครั้งที่รันคำสั่งใหม่ —
> ถ้า URL เปลี่ยน ต้องเข้าไปแก้ `DB_HOST` บน Render ใหม่ทุกครั้งด้วย ถ้า
> ต้องการ URL คงที่ถาวร ต้องผูกโดเมนกับ Cloudflare (ดูหมายเหตุท้าย
> `FOR_ME.md`)

### 7.2 เตรียม repo
- Push โค้ดขึ้น GitHub (branch `main`) — โฟลเดอร์โปรเจกต์บนเครื่อง local
  กับที่ push ขึ้น GitHub คือชุดเดียวกัน (Render deploy จาก repo นี้ตรงๆ)
- **ห้าม** commit ไฟล์ `.env` จริง — เก็บแค่ `.env.example` ที่เป็น placeholder เท่านั้น

### 7.3 สร้าง Web Service บน Render
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

### 7.4 ตั้งค่า Environment Variables บน Render
ไปที่ **Environment** แล้วเพิ่มตัวแปร (ค่าจริง ไม่ใช่ placeholder):

```
DB_HOST       = xxxxx.trycloudflare.com   (จาก section 7.1 ไม่ใช่ localhost)
DB_USER       = (MySQL user ที่จำกัดสิทธิ์เฉพาะ database นี้ — ไม่ใช้ root)
DB_PASSWORD   = (รหัสผ่านของ user ด้านบน)
DB_NAME       = key_borrow_db
DB_PORT       = 3306
JWT_SECRET
JWT_EXPIRES_IN
ADMIN_USERNAME
ADMIN_PASSWORD
```

> ไม่ต้องตั้ง `PORT` — Render กำหนดให้อัตโนมัติ และ `server.js`
> อ่านจาก `process.env.PORT || 3000` อยู่แล้ว

### 7.5 Deploy
กด **Create Web Service** — Render จะ build และ deploy อัตโนมัติทุกครั้งที่
push ขึ้น `main` (เว็บจะใช้งานได้จริงก็ต่อเมื่อเครื่อง local เปิด MySQL +
Cloudflare Tunnel ค้างไว้ตาม section 7.1 ด้วย)

---

## 8. ข้อควรระวังด้านความปลอดภัย

- `JWT_SECRET`, `DB_PASSWORD` ต้องอยู่ใน environment variables เท่านั้น ห้ามฝังในโค้ดหรือ commit ขึ้น git
- `.env.example` ต้องมีแต่ค่า placeholder (เช่น `your-password-here`) ไม่ใช่ค่าที่หน้าตาเหมือนรหัสผ่านจริง เพราะ GitHub secret scanning จะบล็อกการ push ถ้าตรวจพบ pattern คล้ายคีย์จริง
- ตั้ง `JWT_SECRET` เป็นค่าที่ตั้งเองแบบสุ่มยาวๆ เสมอในสภาพแวดล้อม production — ไม่พึ่งค่า fallback ที่ตั้งไว้ในโค้ด
- `POST /api/tap` เปิดสาธารณะโดยตั้งใจ (ไม่มี JWT) — ความปลอดภัยของ endpoint นี้ขึ้นกับการควบคุมทางกายภาพว่าใครเข้าถึงเครื่องอ่านที่ห้องทะเบียนได้บ้าง
- **MySQL ที่เปิดผ่าน Cloudflare Tunnel (section 7):** ห้ามใช้ user
  `root` เชื่อมต่อจาก Render เด็ดขาด — ต้องสร้าง MySQL user แยกที่มีสิทธิ์
  แค่ `SELECT/INSERT/UPDATE/DELETE` บน database `key_borrow_db` เท่านั้น
  เพราะ tunnel เปิดพอร์ตฐานข้อมูลออกสู่อินเทอร์เน็ตจริง แม้ URL จะเดายาก
  แต่ควรจำกัดสิทธิ์ user ไว้เป็นชั้นป้องกันเพิ่ม ไม่พึ่งแค่ "URL ลับ"
  อย่างเดียว
- ค่า `DB_HOST` ที่เป็น URL ของ tunnel ควรถือเป็นความลับเทียบเท่ารหัสผ่าน
  — ไม่โพสต์ในที่สาธารณะ, ไม่ commit ขึ้น git

---

## 9. สิ่งที่ยังต้องตัดสินใจเพิ่มเติม

- [ ] ต้องการแจ้งเตือน (เสียง/ไลน์/อีเมล) เมื่อยืมเกินเวลาที่กำหนดหรือไม่
- [ ] ต้องการให้ปรับ `SESSION_TTL_MS` (ปัจจุบัน 20 วินาที ใน `routes/tap.js`) ให้นานขึ้นหรือไม่
- [ ] รองรับเครื่องอ่านหลายเครื่องพร้อมกัน (มี `readerId` รองรับไว้แล้วในโค้ด แต่ยังไม่ได้ใช้งานจริงหลายเครื่อง)

---

## 10. แผนปรับสถาปัตยกรรม (กำลังออกแบบ — ยังไม่ได้ลงมือแก้โค้ด)

> หมวดนี้สรุปจากบทสนทนาการออกแบบล่าสุด เพื่อให้เริ่มต่อได้ทันทีโดยไม่ต้องอธิบายซ้ำ
> **ยังไม่มีจุดไหนถูกเขียนเป็นโค้ดจริง** — ทุกอย่างด้านล่างคือข้อสรุปจากการคุยเพื่อ "ออกแบบก่อนโค้ด"

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

### 10.4 Hosting/ฐานข้อมูล (ยืนยันแล้ว — แยกเรื่องจาก 10.1–10.3 ด้านบน)

หมวดนี้เป็นคนละประเด็นกับแผน RFID/สมัครครูใน 10.1–10.3 — เป็นการตัดสินใจ
เรื่อง **จะ deploy ระบบยังไง** จากบทสนทนาคนละรอบ สรุปผลแล้วดังนี้:

- ฐานข้อมูลมี **ชุดเดียว** คือ MySQL บนเครื่อง local (XAMPP) ไม่แยกเป็น
  cloud DB ต่างหาก
- เว็บ/API เดียวกันนี้ถูก deploy ขึ้น Render ด้วย (repo เดียวกัน) เพื่อให้
  เข้าใช้งานผ่านลิงก์ออนไลน์ได้จากที่ไหนก็ได้
- Render เชื่อมต่อกลับมาที่ MySQL บนเครื่อง local ผ่าน **Cloudflare
  Tunnel** (เลือกตัวนี้เพราะฟรี ไม่จำกัดเวลา และรันเป็น background service
  ยาวๆ ได้เสถียรกว่า ngrok เวอร์ชันฟรี) — รายละเอียดการตั้งค่าอยู่ที่
  section 7 ของไฟล์นี้ และขั้นตอนติดตั้งทีละคำสั่งอยู่ใน `FOR_ME.md`
- **Trade-off ที่ยอมรับแล้ว:** เครื่อง local ต้องเปิดค้างไว้ตลอดเวลาที่
  ต้องการให้เว็บ Render ใช้งานได้ ถ้าเครื่องปิดหรือ MySQL/tunnel ไม่ได้รัน
  เว็บออนไลน์จะ error ทันที — ยอมรับ trade-off นี้เพื่อแลกกับการไม่ต้อง
  เสียเงินเช่า cloud database แยก