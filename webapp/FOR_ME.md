# คำสั่งทั้งหมด — จำไม่ได้ก็มาเปิดไฟล์นี้

---

## 1. ติดตั้ง Node.js (ถ้าเครื่องยังไม่มี npm)

เช็คก่อนว่ามีหรือยัง เปิด Terminal / PowerShell แล้วพิมพ์:

```
npm -v
```

ถ้าขึ้น error ว่าไม่รู้จักคำสั่ง แปลว่ายังไม่มี ให้ติดตั้งด้วย:

```
winget install OpenJS.NodeJS.LTS
```

ติดตั้งเสร็จแล้ว **ปิด Terminal แล้วเปิดใหม่** (สำคัญ ไม่งั้นจะยังไม่เจอคำสั่ง npm) แล้วเช็คอีกรอบ:

```
npm -v
node -v
```

---

## 2. ติดตั้ง XAMPP + สร้าง Database (สำหรับ MySQL/MariaDB)

1. โหลดตัวติดตั้งจาก https://www.apachefriends.org/
2. ติดตั้งตามปกติ (Next ไปเรื่อยๆ)
3. เปิดโปรแกรม **XAMPP Control Panel**
4. กด **Start** ที่แถว **MySQL**
5. กด **Start** ที่แถว **Apache** ด้วย — **สำคัญ** ถ้าไม่ Start Apache จะเข้า phpMyAdmin ไม่ได้เลย (จะเจอ `ERR_CONNECTION_REFUSED` เพราะ phpMyAdmin เป็นเว็บที่รันผ่าน Apache ไม่ใช่ MySQL โดยตรง)
   - ทั้งสองแถวต้องขึ้นพื้นหลัง **สีเขียว** ถือว่ารันสำเร็จ
   - ถ้ากด Start Apache แล้วไม่ติด อาจมีโปรแกรมอื่นแย่ง port 80 อยู่ (เช่น Skype, IIS) บอกผมได้ถ้าเจอปัญหานี้
6. เข้า phpMyAdmin ผ่าน browser: http://localhost/phpmyadmin
7. สร้าง database เปล่าไว้ก่อน:
   - คลิกแท็บ **Databases** (ฐานข้อมูล) ด้านบน
   - ในช่อง "สร้างฐานข้อมูลใหม่" พิมพ์ชื่อ:
     ```
     key_borrow_db
     ```
     (ต้องตรงกับ `DB_NAME` ที่ตั้งไว้ใน `.env` เป๊ะๆ ตัวพิมพ์เล็ก-ใหญ่มีผล — ดูค่าเต็มในข้อ 5)
   - Collation เลือก `utf8mb4_general_ci` หรือปล่อย default ก็ได้
   - กด **Create** (สร้าง)
8. คลิกเข้า database `key_borrow_db` ที่เพิ่งสร้าง แล้วไปแท็บ **Import** → เลือกไฟล์ `schema.sql` → กด **Go** เพื่อสร้างตารางทั้งหมด

คำสั่งสำหรับเพิ่มเเท็กทั้งหมดเข้าไปบนฐานข้อมูล

```sql
insert into room_tags (room_name, tag_uid) values ('A111', '0058553602');
insert into room_tags (room_name, tag_uid) values ('A304', '0058557413');
insert into room_tags (room_name, tag_uid) values ('B205', '0058505527');
insert into room_tags (room_name, tag_uid) values ('B202', '0058661894');
insert into room_tags (room_name, tag_uid) values ('C205', '0058557651');
insert into room_tags (room_name, tag_uid) values ('A205', '0058660966');
insert into room_tags (room_name, tag_uid) values ('B307', '0058535181');
insert into room_tags (room_name, tag_uid) values ('C307', '0058642734');
insert into room_tags (room_name, tag_uid) values ('B103', '0058632534');
```

---

## 3. รันโปรเจกต์ (ทำทุกครั้งที่จะเปิดใช้งาน)

```
cd webapp
npm install
npm start
```

> `npm install` ไม่ต้องรันทุกครั้งก็ได้ถ้าไม่มีอะไรเปลี่ยน แต่รันซ้ำได้ไม่มีผลเสีย ปลอดภัยไว้ก่อน

---

## 4. Package ที่ต้องติดตั้งเพิ่ม (สำหรับงานย้าย Supabase → MySQL)

รันครั้งเดียวตอนอยู่ในโฟลเดอร์ `webapp`:

```
npm install mysql2
npm install multer
npm install jsonwebtoken
npm uninstall @supabase/supabase-js
```

อธิบายสั้นๆ ว่าแต่ละอันคืออะไร:
- **mysql2** → ใช้ต่อฐานข้อมูล MySQL/MariaDB (แทน Supabase client)
- **multer** → ใช้รับไฟล์รูปที่อัปโหลด แล้วเซฟลงดิสก์แทนการส่งขึ้น Supabase Storage
- **jsonwebtoken** → ใช้กับ `middleware_auth.js` (auth ด้วย JWT)
- **@supabase/supabase-js** → ถอดออกเพราะไม่ใช้ Supabase แล้ว

---

## 5. ก่อนรันครั้งแรกหลังย้ายมา MySQL

1. เปิด XAMPP Control Panel → Start MySQL (ต้อง start ทุกครั้งก่อนรัน `npm start`)
2. แก้ไฟล์ `.env` ให้เป็นค่าฐานข้อมูล MySQL แทนของ Supabase:
   ```
   DB_HOST=localhost
   DB_USER=root
   DB_PASSWORD=
   DB_NAME=key_borrow_db
   DB_PORT=3306
   ```
   (XAMPP ค่า default: user = `root`, password = ว่างๆ ไม่ต้องใส่อะไร)
3. สร้างโฟลเดอร์เก็บรูปเอง (ถ้ายังไม่มี เพราะ git ไม่เก็บโฟลเดอร์ว่าง):
   ```
   cd webapp
   mkdir public\uploads\room-images
   ```
   (ถ้าใช้ Git Bash / Mac / Linux ให้ใช้ `mkdir -p public/uploads/room-images` แทน)
4. Import `schema.sql` เข้า database ผ่าน phpMyAdmin (แท็บ Import) หรือ CLI

---

## 6. ลำดับการเช็คว่าใช้งานได้จริง

1. แตะบัตร → สมัครครูอัตโนมัติ
2. ยืมกุญแจ
3. คืนกุญแจ
4. ดูประวัติ
5. export ข้อมูล
6. อัปโหลดรูปห้อง (เช็คว่ารูปไปโผล่ใน `public/uploads/room-images/` จริง)

---

## 7. Cloudflare Tunnel (สำหรับให้เว็บบน Render ต่อกลับมาที่ MySQL เครื่องนี้)

ทำตามนี้เฉพาะตอนต้องการให้ **เว็บออนไลน์ (Render) ใช้งานได้ด้วย** — ถ้าใช้แค่
เครื่อง local (offline) ไม่ต้องทำ section นี้เลย

### 7.1 ติดตั้ง cloudflared (ทำครั้งเดียวต่อเครื่อง)

1. โหลดตัวติดตั้งสำหรับ Windows จาก:
   https://github.com/cloudflare/cloudflared/releases
   (เลือกไฟล์ `cloudflared-windows-amd64.msi`)
2. ติดตั้งตามปกติ (Next ไปเรื่อยๆ)
3. เปิด Terminal / PowerShell ใหม่ แล้วเช็คว่าติดตั้งสำเร็จ:
   ```
   cloudflared --version
   ```
   ถ้าขึ้นเลขเวอร์ชันมา แปลว่าใช้ได้แล้ว

### 7.2 เปิด tunnel ชี้ไปที่ MySQL (ทำทุกครั้งที่จะให้เว็บ Render ใช้งานได้)

**ต้อง Start MySQL ใน XAMPP ไว้ก่อนเสมอ** (ดูข้อ 2) แล้วค่อยรันคำสั่งนี้:

```
cloudflared access tcp --hostname <จะได้ตอนตั้งค่าแบบผูกโดเมน> --url tcp://localhost:3306
```

> **สำหรับตอนเริ่มต้น (ยังไม่มีโดเมน/Cloudflare account):** ใช้ Quick
> Tunnel แทน ซึ่งไม่ต้อง login ก็รันได้เลย:
> ```
> cloudflared tunnel --url tcp://localhost:3306
> ```
> รันแล้วจะมีบรรทัดขึ้นมาแสดง URL ชั่วคราวรูปแบบ
> `https://xxxxx.trycloudflare.com` — **คัดลอกส่วน `xxxxx.trycloudflare.com`
> เก็บไว้** เพื่อเอาไปกรอกเป็นค่า `DB_HOST` ใน Environment Variables ของ
> Render (ดู README.md section 7.4)

**ต้องเปิด Terminal ที่รันคำสั่งนี้ค้างไว้ตลอดเวลา** ห้ามปิดหน้าต่างนี้ —
ถ้าปิด tunnel จะขาด และเว็บ Render จะต่อฐานข้อมูลไม่ได้ทันที

> ⚠️ **ข้อควรรู้เรื่อง Quick Tunnel:** ทุกครั้งที่รันคำสั่งนี้ใหม่ (เช่น
> หลังปิด Terminal หรือรีสตาร์ทเครื่อง) จะได้ URL ใหม่ทุกครั้ง ต้องเข้าไป
> แก้ค่า `DB_HOST` บน Render ใหม่ทุกรอบด้วย — ถ้าเจอปัญหานี้บ่อยจนน่ารำคาญ
> บอกผมได้ จะช่วยตั้งค่าแบบผูกโดเมนถาวร (Named Tunnel) ให้ URL คงที่
> ไม่เปลี่ยนอีก (ต้องมีโดเมนของตัวเอง หรือใช้โดเมนฟรีจากผู้ให้บริการ
> อื่นเชื่อมเข้า Cloudflare ก็ได้)

### 7.3 สร้าง MySQL user แยกสำหรับ Render (ทำครั้งเดียว ก่อนเปิด tunnel ใช้งานจริงครั้งแรก)

**ห้ามให้ Render ต่อด้วย user `root`** เข้า phpMyAdmin → แท็บ **SQL** แล้ว
รันคำสั่งนี้ (เปลี่ยน `รหัสผ่านที่นี่` เป็นรหัสผ่านที่ตั้งเอง):

```sql
CREATE USER 'render_app'@'%' IDENTIFIED BY '300950';
GRANT SELECT, INSERT, UPDATE, DELETE ON key_borrow_db.* TO 'render_app'@'%';
FLUSH PRIVILEGES;
```

แล้วใช้ `render_app` / รหัสผ่านนี้เป็นค่า `DB_USER` / `DB_PASSWORD` บน
Render แทนการใช้ `root`

---

## 8. เซตอัปครั้งแรกบนเครื่องอื่น (เครื่องใหม่ที่ไม่เคยรันโปรเจกต์นี้มาก่อน)

ใช้เช็กลิสต์นี้เวลาย้ายไปตั้งเครื่องใหม่ (เช่น เครื่องสำรอง หรือเครื่องที่
โรงเรียนซื้อมาใหม่) ทำตามลำดับนี้ทั้งหมด — เรียงจากข้อ 1 ถึง 7 ห้ามข้าม:

- [ ] **ข้อ 1** — ติดตั้ง Node.js เช็คด้วย `npm -v` / `node -v`
- [ ] **ข้อ 2** — ติดตั้ง XAMPP, Start MySQL + Apache, สร้าง database
      `key_borrow_db`, import `schema.sql`, รัน insert แท็กทั้งหมด
- [ ] Clone/ดึงโค้ดโปรเจกต์มาไว้ในเครื่อง (จาก GitHub repo เดิม)
- [ ] **ข้อ 4** — ติดตั้ง package เพิ่ม (`npm install` ในโฟลเดอร์ `webapp`
      จะติดตั้งครบตาม `package.json` อยู่แล้ว ไม่ต้องรันทีละบรรทัดเอง
      อีกก็ได้ถ้า `package.json` มีครบแล้ว)
- [ ] **ข้อ 5** — สร้างไฟล์ `.env` เอง (คัดลอกจาก `.env.example` แล้วกรอก
      ค่าจริง) **ไฟล์นี้ git ไม่เก็บให้ ต้องสร้างใหม่ทุกเครื่อง** และสร้าง
      โฟลเดอร์ `public/uploads/room-images/`
- [ ] **ข้อ 7** — ถ้าเครื่องนี้จะเป็นเครื่องหลักที่เปิดค้างไว้ให้ Render
      ต่อด้วย: ติดตั้ง `cloudflared` + สร้าง MySQL user แยกสำหรับ Render
      (ทำครั้งเดียว) — ถ้าเครื่องนี้ใช้แค่ offline ไม่ต้องทำข้อนี้
- [ ] ถ้าเปลี่ยนเครื่องหลักที่เปิด tunnel ไปใช้เครื่องนี้แทน อย่าลืมเข้าไป
      แก้ค่า `DB_HOST` บน Render ให้เป็น URL tunnel ของเครื่องใหม่ด้วย
      (ไม่งั้นเว็บ Render ยังจะพยายามต่อไปที่เครื่องเก่าอยู่)
- [ ] **ข้อ 6** — รัน `npm start` แล้วเช็คทุก flow ตามลิสต์ทดสอบ (สมัครครู
      → ยืม → คืน → ดูประวัติ → export → อัปโหลดรูป)