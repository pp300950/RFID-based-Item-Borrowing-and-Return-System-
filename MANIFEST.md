# สถานะงาน — ย้ายฐานข้อมูลจาก Supabase → MySQL (XAMPP)

เป้าหมาย: ตัด dependency กับ Supabase (ทั้ง Postgres ผ่าน PostgREST และ
Storage) ออกทั้งหมด เปลี่ยนมาใช้ MySQL/MariaDB ที่รันผ่าน XAMPP บนเครื่อง
เอง + เก็บรูปภาพเป็นไฟล์ในโฟลเดอร์ `public/uploads/` แทน Storage bucket

หลักการที่ยึดตลอดงานนี้: **แก้เฉพาะชั้นที่คุยกับฐานข้อมูล/ไฟล์** — โครง
route, endpoint path, response shape (`{ ok, ... }`), และ business logic
(session ยืม-คืน, borrow window, conditional update กัน race) **ต้อง
เหมือนเดิมทุกจุด** เพื่อไม่ให้ frontend ที่เขียนไว้แล้วพังตาม

---

## 🔲 ไฟล์ที่ต้องแก้ทั้งหมด (10 ไฟล์ + schema)

| ไฟล์ | งานหลัก |
|---|---|
| `schema.sql` | เขียนใหม่ทั้งหมดเป็น MySQL DDL |
| `config/supabaseClient.js` | แทนที่ด้วย `config/db.js` (mysql2 pool) |
| `server.js` | แก้แค่จุด require ไฟล์ config ใหม่ |
| `routes/tap.js` | query หลักของระบบ — เขียนใหม่ทั้งหมด (มี conditional update กัน race) |
| `routes/auth.js` | เขียนใหม่เฉพาะส่วนสร้างครู (ผ่าน `register_session.js` flow เดิม) |
| `routes/keys.js` | เขียนใหม่ทั้งหมด (JOIN + pagination) |
| `routes/admin_keys.js` | เขียนใหม่ทั้งหมด (JOIN + batch query) |
| `routes/admin_teachers.js` | เขียนใหม่ทั้งหมด (CRUD ธรรมดา) |
| `routes/admin_rooms.js` | เขียนใหม่ทั้งหมด + เปลี่ยนการอัปโหลดรูปเป็น disk storage |
| `routes/export.js` | แก้แค่ query ดึงข้อมูล (`fetchHistoryForExport`) ส่วน CSV/DOCX generation เดิมไม่ต้องแตะ |
| `routes/middleware_auth.js` | **ไม่ต้องแก้เลย** — เป็น JWT ล้วนๆ ไม่แตะ DB |
| `routes/register_session.js` | **ไม่ต้องแก้เลย** — เก็บ state ใน memory ไม่แตะ DB |
| `.env` | เปลี่ยนจาก `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` → `DB_HOST`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` |
| `package.json` | ถอด `@supabase/supabase-js` ออก เพิ่ม `mysql2` + `multer` (ถ้ายังไม่มี) |

---

## 🔴 จุดที่ไม่ใช่แค่แปล syntax ต้องคิด logic ใหม่

### 1. `borrow_window_days` — Postgres array → MySQL

Postgres เก็บเป็น `smallint[]` ตรงๆ ได้ MySQL ไม่มี array type จริง
เลือกวิธีนี้: เก็บเป็น **`JSON` column** (`borrow_window_days JSON NULL`)
เก็บเป็น `[1,2,3,4,5]` แล้ว parse/stringify เองในโค้ด — ง่ายกว่าแยกตาราง
ลูกเพราะ `tap.js`/`admin_rooms.js` แค่อ่าน-เขียนทั้งก้อนไม่เคย query
กรองด้วยวันเดี่ยวๆ ในฐานข้อมูลเลย

### 2. Conditional update กัน race condition (`tap.js`)

ของเดิม:
```js
.update({...}).eq("id", roomTag.id).eq("status", "available").select().maybeSingle()
// ถ้า updated === null แปลว่ามีคนแตะแซงไปก่อนแล้ว
```
MySQL ทำแบบเดียวกันด้วย `UPDATE ... WHERE id = ? AND status = 'available'`
แล้วเช็ค `result.affectedRows === 0` แทนการเช็ค `null` — ต้อง `SELECT`
แถวใหม่อีกทีหลัง update สำเร็จ (mysql2 ไม่มี `.select()` ในตัวเหมือน
Supabase)

### 3. Nested/embedded select ทั้งหมดต้องเขียนเป็น `JOIN`

ตัวอย่างที่ใช้เยอะสุด — `borrowed_by:borrowed_by_teacher_id(id, name, department)`:
```sql
SELECT rt.*, t.id AS borrowed_by_id, t.name AS borrowed_by_name, t.department AS borrowed_by_department
FROM room_tags rt
LEFT JOIN teachers t ON t.id = rt.borrowed_by_teacher_id
```
แล้ว map ผลลัพธ์กลับเป็น shape เดิม `{ ...room, borrowed_by: { id, name, department } | null }`
ในโค้ด JS ก่อนส่ง response — ทำจุดนี้ให้ตรงทุก endpoint ที่มี nested
select เดิม (`keys.js`, `admin_keys.js`, `export.js` ล้วนมี pattern นี้)

### 4. `room_images` join แบบ array (`keys.js` GET /keys/status)

ของเดิมใช้ PostgREST embed ดึง `room_images(...)` เป็น array ซ้อนในแถว
เดียวของ `room_tags` เลย MySQL ต้อง query 2 รอบ (ห้องทั้งหมด → รูปทั้งหมด
ของห้องเหล่านั้นด้วย `WHERE room_tag_id IN (...)`) แล้ว group เข้าด้วยกัน
เองในโค้ด JS — ห้ามลืม sort ตาม `sort_order` ตอน group

### 5. Pagination แบบ count คู่กับ range (`keys.js` GET /keys/history/all)

ของเดิม `{ count: "exact" }` + `.range(from, to)` คืน count มาพร้อมกันใน
query เดียว MySQL ต้องแยกเป็น 2 query ชัดเจน: `SELECT COUNT(*) ...` กับ
`SELECT ... LIMIT ? OFFSET ?` (`admin_keys.js` history และ `export.js`
ไม่ต้องกังวลจุดนี้เพราะไม่มี count)

### 6. CHECK constraint (`chk_room_tags_borrower`)

Postgres:
```sql
constraint chk_room_tags_borrower check (
  (status = 'available' and borrowed_by_teacher_id is null and borrowed_at is null)
  or (status = 'borrowed' and borrowed_by_teacher_id is not null and borrowed_at is not null)
)
```
MySQL 8.0.16+ รองรับ `CHECK` constraint ตรงๆ แล้ว (ต้องเช็คเวอร์ชัน MySQL
ที่มากับ XAMPP ก่อน — XAMPP ส่วนใหญ่ยังใช้ MariaDB ซึ่งรองรับ `CHECK`
ตั้งแต่ 10.2+ เหมือนกัน) ถ้าเวอร์ชันเก่ากว่านั้นให้ตัด constraint นี้ออก
จาก schema แล้วพึ่ง logic ฝั่งแอป (`tap.js`) คุมแทนทั้งหมด — ของเดิมก็
เขียนแบบ set ทั้งคู่พร้อมกันอยู่แล้วในทุกจุดที่ update สถานะ ความเสี่ยง
ต่ำ

### 7. `on delete cascade` / `on delete set null`

MySQL รองรับเหมือน Postgres แต่ทั้งสอง table ต้องเป็น **InnoDB** engine
(ค่า default ของ MySQL/MariaDB ใหม่ๆ อยู่แล้ว แต่ควรระบุ `ENGINE=InnoDB`
ชัดเจนในทุก `CREATE TABLE` กันพลาด — XAMPP บางเวอร์ชันเก่า default เป็น
MyISAM ซึ่งไม่รองรับ foreign key เลย)

### 8. รูปภาพ: Supabase Storage → ไฟล์บนดิสก์

**`multer`** เปลี่ยนจาก `memoryStorage()` → `diskStorage()` เขียนตรงไป
`public/uploads/room-images/` ด้วยชื่อไฟล์แบบเดิม
(`room-<id>-<timestamp>.<ext>`) แล้วเก็บ **path สัมพัทธ์**
(`/uploads/room-images/room-12-171234.jpg`) ลงคอลัมน์ `image_url` แทน
public URL เต็มของ Supabase — ฝั่ง frontend ที่ดึง `image_url` ไปใส่
`<img src>` ตรงๆ จะยังทำงานได้เหมือนเดิมเพราะ `express.static` เสิร์ฟ
โฟลเดอร์ `public/` อยู่แล้วใน `server.js`

ฟังก์ชัน "ลบไฟล์เก่า" (`supabase.storage.remove([oldPath])`) เปลี่ยนเป็น
`fs.unlink()` แบบ best-effort เหมือนเดิม (catch error แล้ว log เฉยๆ
ไม่ throw)

ต้องสร้างโฟลเดอร์ `public/uploads/room-images/` เองไว้ก่อนรัน (git ไม่
track โฟลเดอร์ว่าง — ใส่ `.gitkeep` หรือให้โค้ด `fs.mkdirSync(..., {
recursive: true })` ตอน startup กันพลาด "ENOENT: no such directory"
ตอนอัปโหลดรูปแรก)

### 9. Transaction สำหรับ multi-step insert

จุดที่ Supabase ทำหลาย insert/update ต่อกันแบบไม่มี transaction จริง
(เช่น `tap.js` สร้างครูใหม่ + insert `teacher_tags` สองคำสั่งแยกกัน,
`admin_rooms.js` insert หลายรูปพร้อมกัน) ตอนย้ายมา MySQL ควรห่อด้วย
`connection.beginTransaction()` / `commit()` / `rollback()` จริงๆ เพราะ
mysql2 ทำได้ตรงไปตรงมาและลดความเสี่ยงข้อมูลครึ่งๆ กลางๆ ถ้า insert ที่
สองล้มเหลว (ของเดิมบน Supabase ก็ไม่ได้กันจุดนี้ไว้ 100% เหมือนกัน แต่
เป็นโอกาสอุดรูระหว่างย้ายไปในตัว)

---

## ✅ สิ่งที่ไม่ต้องเปลี่ยนเลย

- Business logic ทั้งหมดใน `tap.js` (session, toggle borrow/return,
  isWithinBorrowWindow) — เปลี่ยนแค่การเรียก DB ข้างใน ไม่แตะเงื่อนไข
- `middleware_auth.js` — JWT ล้วนๆ ไม่แตะ DB เลย
- `register_session.js` — เก็บ state ใน memory ไม่แตะ DB เลย
- CSV/DOCX generation logic ใน `export.js` (`buildCsv`, `buildDocx`,
  `csvEscapeField`, ฯลฯ) — แก้แค่ query ที่ป้อนข้อมูลเข้าไป
- Response shape (`{ ok, message, ... }`) ของทุก endpoint — frontend
  พึ่งชื่อ field พวกนี้อยู่ ต้องคงเดิมเป๊ะแม้ query เบื้องหลังเปลี่ยน

---

## 📋 ลำดับการทำที่แนะนำ

1. ติดตั้ง MySQL ผ่าน XAMPP + เปิด phpMyAdmin สร้าง database เปล่าไว้ก่อน
2. เขียน `schema.sql` เวอร์ชัน MySQL รันผ่าน phpMyAdmin หรือ CLI ให้ตาราง
   ครบ ตรวจ foreign key + index ตามเดิม
3. เขียน `config/db.js` (connection pool) แทน `supabaseClient.js`
4. ไล่แก้ทีละ route ไฟล์ **เรียงจากง่ายไปยาก**: `admin_teachers.js` →
   `keys.js`/`admin_keys.js` → `export.js` → `admin_rooms.js` (มีเรื่อง
   ไฟล์รูปเพิ่ม) → `tap.js` (ซับซ้อนสุด, มี conditional update + auto
   register)
5. แก้ `.env` + `server.js` (จุด require)
6. ทดสอบทีละ endpoint ด้วย flow จริง: สมัครครู (แตะบัตร) → ยืมกุญแจ →
   คืนกุญแจ → ดูประวัติ → export → อัปโหลดรูปห้อง

---

## 📎 คำแนะนำเรื่องอัปไฟล์รอบต่อไป

อัปไฟล์ตามลำดับที่จะลงมือแก้จริง (จากข้อ 4 ด้านบน) ไม่ต้องอัปทั้งชุด
พร้อมกัน — เริ่มจาก `schema.sql` (ต้องได้ตารางก่อนถึงจะเขียน query
route ได้) แล้วค่อยไล่ทีละไฟล์ตามลำดับความยาก
