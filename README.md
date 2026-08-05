# ระบบยืม–คืนกุญแจด้วยแท็ก RFID

ระบบยืม-คืนกุญแจห้อง สำหรับครู โดยใช้เครื่องอ่านแท็ก RFID (Keyboard Emulation)
ที่ห้องทะเบียน — แตะแท็กครู แล้วแตะแท็กกุญแจ ระบบจะยืม/คืนให้อัตโนมัติ
ไม่ต้องมีขั้นตอนอนุมัติ

**สแต็กที่ใช้จริง:** Node.js (Express) + Supabase (Postgres) + JWT + Render (hosting)

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
                    [Supabase (Postgres)]
```

---

## 2. โครงสร้างโปรเจกต์

```
webapp/
├─ server.js                   # entry point, mount ทุก route
├─ package.json
├─ .env                        # ค่าจริง (ไม่ commit ขึ้น git)
├─ .env.example                # ตัวอย่าง placeholder เท่านั้น
├─ config/
│  └─ supabaseClient.js        # สร้าง Supabase client จาก env
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

## 3. Database Schema (Supabase / Postgres)

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
```

ระบบนี้**ไม่มี**นักเรียน, ไม่มี `room_items`, ไม่มีขั้นตอน pending/approve,
และไม่มีการมอบหมายครูดูแลห้องเฉพาะ (ครูคนไหนมีแท็กก็ยืมกุญแจดอกไหนก็ได้)

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
POST   /api/register/teacher          สมัครครู
POST   /api/login/teacher             ล็อกอินครู (ด้วยรหัสครู)
POST   /api/login/admin               ล็อกอินแอดมิน
GET    /api/me                        ข้อมูลผู้ใช้ปัจจุบัน (requireAuth)

POST   /api/tap                       รับการแตะแท็กจากเครื่องอ่าน (public)
GET    /api/tap/session               poll เช็คสถานะ session ปัจจุบัน
POST   /api/tap/session/clear         ปิด session ทันที

GET    /api/keys/status               สถานะกุญแจทั้งหมด (requireAuth)
GET    /api/keys/history/mine         ประวัติยืม-คืนของครูตัวเอง (requireAuth, teacher)

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
SUPABASE_URL=https://xxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
JWT_SECRET=สุ่มยาวๆ-เปลี่ยนก่อนใช้งานจริง
JWT_EXPIRES_IN=7d
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-password-here
```

> ⚠️ **`SUPABASE_SERVICE_ROLE_KEY`** เป็นคีย์สิทธิ์เต็ม (bypass RLS ทั้งหมด)
> ห้าม commit ขึ้น git หรือหลุดไปฝั่ง frontend เด็ดขาด — หาได้จาก
> Supabase Dashboard → Settings → API → **service_role** (ไม่ใช่ `anon public`)

### 6.3 รันเซิร์ฟเวอร์
```bash
npm start
```
เปิดที่ `http://localhost:3000`

---

## 7. Deploy ขึ้น Render

### 7.1 เตรียม repo
- Push โค้ดขึ้น GitHub (branch `main`)
- **ห้าม** commit ไฟล์ `.env` จริง — เก็บแค่ `.env.example` ที่เป็น placeholder เท่านั้น

### 7.2 สร้าง Web Service บน Render
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

### 7.3 ตั้งค่า Environment Variables บน Render
ไปที่ **Environment** แล้วเพิ่มตัวแปรเดียวกับข้อ 6.2 (ค่าจริง ไม่ใช่ placeholder):

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
JWT_SECRET
JWT_EXPIRES_IN
ADMIN_USERNAME
ADMIN_PASSWORD
```

> ไม่ต้องตั้ง `PORT` — Render กำหนดให้อัตโนมัติ และ `server.js`
> อ่านจาก `process.env.PORT || 3000` อยู่แล้ว

### 7.4 Deploy
กด **Create Web Service** — Render จะ build และ deploy อัตโนมัติทุกครั้งที่ push ขึ้น `main`

---

## 8. ข้อควรระวังด้านความปลอดภัย

- `SUPABASE_SERVICE_ROLE_KEY` และ `JWT_SECRET` ต้องอยู่ใน environment variables เท่านั้น ห้ามฝังในโค้ดหรือ commit ขึ้น git
- `.env.example` ต้องมีแต่ค่า placeholder (เช่น `your-key-here`) ไม่ใช่ค่าที่หน้าตาเหมือนคีย์จริง เพราะ GitHub secret scanning จะบล็อกการ push ถ้าตรวจพบ pattern คล้ายคีย์จริง
- ตั้ง `JWT_SECRET` เป็นค่าที่ตั้งเองแบบสุ่มยาวๆ เสมอในสภาพแวดล้อม production — ไม่พึ่งค่า fallback ที่ตั้งไว้ในโค้ด
- `POST /api/tap` เปิดสาธารณะโดยตั้งใจ (ไม่มี JWT) — ความปลอดภัยของ endpoint นี้ขึ้นกับการควบคุมทางกายภาพว่าใครเข้าถึงเครื่องอ่านที่ห้องทะเบียนได้บ้าง

---

## 9. สิ่งที่ยังต้องตัดสินใจเพิ่มเติม

- [ ] ต้องการแจ้งเตือน (เสียง/ไลน์/อีเมล) เมื่อยืมเกินเวลาที่กำหนดหรือไม่
- [ ] ต้องการให้ปรับ `SESSION_TTL_MS` (ปัจจุบัน 20 วินาที ใน `routes/tap.js`) ให้นานขึ้นหรือไม่
- [ ] รองรับเครื่องอ่านหลายเครื่องพร้อมกัน (มี `readerId` รองรับไว้แล้วในโค้ด แต่ยังไม่ได้ใช้งานจริงหลายเครื่อง)
