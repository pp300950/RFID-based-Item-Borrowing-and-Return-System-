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

---

## 6. ลำดับการเช็คว่าใช้งานได้จริง

1. แตะบัตร → สมัครครูอัตโนมัติ
2. ยืมกุญแจ
3. คืนกุญแจ
4. ดูประวัติ
5. export ข้อมูล
6. อัปโหลดรูปห้อง (เช็คว่ารูปไปโผล่ใน `public/uploads/room-images/` จริง)

---

## 7. Bridge + Cloudflare Tunnel (สำหรับให้เว็บบน Render ต่อกลับมาที่ MySQL เครื่องนี้)

ทำตามนี้เฉพาะตอนต้องการให้ **เว็บออนไลน์ (Render) ใช้งานได้ด้วย** — ถ้าใช้แค่
เครื่อง local (offline) ไม่ต้องทำ section นี้เลย

> ⚠️ **สถาปัตยกรรมนี้คนละแบบกับ Cloudflare Tunnel ตรง MySQL แบบเดิม** —
> Render **ไม่ได้ต่อ MySQL ตรงๆ** แต่คุยผ่าน HTTP ไปหา
> `config/bridge-server.js` (โปรแกรมเล็กๆ ที่รันแยกอีก process บนเครื่องนี้)
> แล้ว `bridge-server.js` ค่อยไปคุย MySQL ผ่าน `localhost` ต่ออีกที —
> พอร์ต MySQL (3306) เลย**ไม่ต้องเปิดออกอินเทอร์เน็ตเลยแม้แต่จุดเดียว**
> ปลอดภัยกว่าแบบเดิม ดู README.md section 11 สำหรับรายละเอียดเหตุผล
>
> **อัปเดต:** ตัว tunnel ที่ใช้จริงตอนนี้คือ **Cloudflare Tunnel** (คำสั่ง
> `cloudflared`) ไม่ใช่ ngrok แล้ว — เปลี่ยนมาใช้ตัวนี้เพราะไม่ต้องสมัคร
> บัญชีก็รันแบบ quick tunnel ได้เลย ส่วนแนวคิดโดยรวม (bridge คุย MySQL
> ผ่าน localhost, tunnel แค่เปิด bridge ออกเน็ต) เหมือนเดิมทุกอย่าง

ต้องมี **3 อย่างรันพร้อมกันตลอดเวลา** บนเครื่องนี้ เว็บ Render ถึงจะใช้งานได้:

1. XAMPP (MySQL ต้อง Start ค้างไว้ — ดูข้อ 2)
2. `config/bridge-server.js` (โปรแกรมคนละตัวกับ `server.js` หลัก รันแยก terminal)
3. cloudflared (tunnel ที่เปิดพอร์ตของ bridge-server.js ออกอินเทอร์เน็ต)

ถ้าอันใดอันหนึ่งใน 3 อย่างนี้หยุดทำงาน (ปิด terminal, เครื่องปิด, MySQL
ไม่ได้ start) **เว็บบน Render จะใช้งานไม่ได้ทันที** — เป็น trade-off ที่
ยอมรับแล้วของสถาปัตยกรรมนี้ ไม่ใช่บั๊ก

### 7.1 ติดตั้ง cloudflared (ทำครั้งเดียวต่อเครื่อง)

1. โหลดตัวติดตั้งสำหรับ Windows จาก
   https://github.com/cloudflare/cloudflared/releases (เลือกไฟล์
   `cloudflared-windows-amd64.exe` แล้วเปลี่ยนชื่อเป็น `cloudflared.exe`
   ก็ได้ หรือติดตั้งผ่าน winget แทนก็ได้ง่ายกว่า):
   ```
   winget install --id Cloudflare.cloudflared
   ```
2. ปิด Terminal แล้วเปิดใหม่ (เหมือนตอนลง Node.js) จากนั้นเช็คว่าติดตั้งสำเร็จ:
   ```
   cloudflared --version
   ```
   ถ้าขึ้นเลขเวอร์ชันมา แปลว่าใช้ได้แล้ว

> ต่างจาก ngrok ตรงที่ **quick tunnel ของ cloudflared ไม่ต้องสมัครบัญชี
> หรือใส่ authtoken ก็รันได้เลย** ข้ามขั้นตอนสมัครบัญชี/คัดลอก token ไปได้
> เลยในเวอร์ชันนี้

### 7.2 ตั้งค่า `.env` ฝั่ง bridge (ทำครั้งเดียว ก่อนรัน bridge-server.js ครั้งแรก)

`bridge-server.js` อ่านค่าจากไฟล์ `.env` เดียวกับ `server.js` หลัก —
เพิ่ม 2 บรรทัดนี้เข้าไปในไฟล์ `.env` (ถ้ายังไม่มี ดู `.env.example`
เป็นตัวอย่าง):

```
BRIDGE_PORT=4001
BRIDGE_AUTH_KEY=<สุ่มมายาวๆ ห้ามเว้นว่าง>
```

`BRIDGE_AUTH_KEY` คือคีย์ลับกันคนแปลกหน้ายิง SQL เข้ามาผ่าน bridge
(bridge-server.js **จะไม่ยอมสตาร์ทเลยถ้าไม่ตั้งค่านี้**) สุ่มได้ด้วย:

```
openssl rand -hex 32
```

ถ้าเครื่องไม่มีคำสั่ง `openssl` (บาง Windows ไม่มีติดมาให้) พิมพ์อะไรก็ได้
ที่ยาวๆ สุ่มๆ แทนก็พอ (เช่น 40 ตัวอักษรผสมตัวเลข) ขอแค่จำได้/คัดลอกเก็บไว้
เพราะต้องเอาไปใส่ฝั่ง Render ด้วย (ดูข้อ 7.4)

> ⚠️ **ห้ามใส่ค่า `BRIDGE_AUTH_KEY` จริงไว้ในไฟล์ README หรือ commit ขึ้น
> GitHub เด็ดขาด** — ถ้าเคยมีคีย์จริงหลุดไปอยู่ในเอกสาร/แชท/commit ไหนมา
> ก่อน ให้สุ่มคีย์ใหม่แล้วอัปเดตทั้งฝั่ง `.env` local และ `DB_BRIDGE_KEY`
> บน Render ให้ตรงกันทันที

### 7.3 รัน bridge-server.js + เปิด cloudflared (ทำทุกครั้งที่จะให้เว็บ Render ใช้งานได้)

**ต้อง Start MySQL ใน XAMPP ไว้ก่อนเสมอ** (ดูข้อ 2) จากนั้นเปิด
**Terminal 2 หน้าต่างแยกกัน** (คนละหน้าต่างจากที่รัน `npm start` ของเว็บหลัก
ถ้าเปิดเว็บหลักไว้ด้วย):

**Terminal A — รัน bridge-server.js:**
```
cd webapp
cd config
node bridge-server.js
```
ถ้าขึ้น `✓ bridge-server.js กำลังรันที่ http://localhost:4001` แปลว่า
สำเร็จ ปล่อยหน้าต่างนี้ค้างไว้ ห้ามปิด

ทดสอบได้ทันทีในเบราว์เซอร์ (หรือด้วย `curl`/`Invoke-WebRequest` ใน
PowerShell — อย่าพิมพ์ URL ตรงๆ ใน PowerShell เฉยๆ เพราะมันจะพยายาม
ตีความเป็นคำสั่ง):
```
http://localhost:4001/health
```
ควรขึ้น `{"ok":true,"message":"bridge-server is running"}`

**Terminal B — เปิด cloudflared ชี้ไปที่พอร์ตของ bridge:**
```
cloudflared tunnel --url http://localhost:4001
```
ไม่ต้อง cd ไปไหนก่อนก็ได้ รันแล้วจะมีข้อความยาวๆ ขึ้นมา ให้หาบรรทัดที่มี
URL ลักษณะแบบนี้ (อยู่ใต้ "Your quick Tunnel has been created!"):
```
https://xxxxx-xxxxx-xxxxx-xxxxx.trycloudflare.com
```
**คัดลอก URL ที่ลงท้ายด้วย `.trycloudflare.com` เก็บไว้** เพื่อเอาไปกรอก
เป็นค่า `DB_BRIDGE_URL` ใน Environment Variables ของ Render (ดูข้อ 7.4)

ปล่อยหน้าต่างนี้ค้างไว้เช่นกัน ห้ามปิด — ถ้าปิด tunnel จะขาด เว็บ Render
จะต่อฐานข้อมูลไม่ได้ทันที

> ⚠️ **ข้อควรรู้เรื่อง Cloudflare quick tunnel:** ทุกครั้งที่รันคำสั่ง
> `cloudflared tunnel --url http://localhost:4001` ใหม่ (เช่น หลังปิด
> Terminal หรือรีสตาร์ทเครื่อง) จะได้ URL สุ่มใหม่ทุกครั้ง (ชื่อสุ่มแบบ
> `usual-lemon-pros-converted.trycloudflare.com` เปลี่ยนไปเรื่อยๆ) ต้อง
> เข้าไปแก้ค่า `DB_BRIDGE_URL` บน Render ใหม่ทุกรอบด้วย — ถ้าเจอปัญหานี้
> บ่อยจนน่ารำคาญ บอกผมได้ จะช่วยตั้งค่าแบบ named tunnel (ผูกกับ
> Cloudflare account + domain) ให้ URL คงที่ไม่เปลี่ยนอีก

### 7.4 ตั้งค่า Environment Variables บน Render (ทำครั้งเดียว/อัปเดตเมื่อ URL เปลี่ยน)

เข้า Render dashboard → เลือกเว็บ service นี้ → **Environment** → ตั้งค่า:

```
DB_MODE=bridge
DB_BRIDGE_URL=<URL จาก cloudflared ในข้อ 7.3 เช่น https://xxxx.trycloudflare.com>
DB_BRIDGE_KEY=<ต้องเป็นค่าเดียวกับ BRIDGE_AUTH_KEY ในข้อ 7.2 เป๊ะๆ>
```

**ไม่ต้องตั้ง** `DB_HOST` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` บน
Render เลย เพราะโหมด bridge ไม่ได้ต่อ MySQL ตรงจากฝั่ง Render — ตัวแปร
เหล่านั้นเป็นของเครื่อง local เท่านั้น (ดูข้อ 5)

ทุกครั้งที่เปิด cloudflared ใหม่แล้วได้ URL ใหม่ (ดูคำเตือนในข้อ 7.3) ต้อง
กลับมาแก้ `DB_BRIDGE_URL` ตรงนี้ให้ตรงกับ URL ล่าสุดเสมอ ไม่งั้นเว็บ
Render จะยิงไปหา URL เก่าที่ตายไปแล้ว

### 7.5 เช็คว่า bridge ทำงานถูกต้อง

เปิด browser ไปที่ URL จาก cloudflared ต่อท้ายด้วย `/health` เช่น
`https://xxxx.trycloudflare.com/health` — ถ้าขึ้น
`{"ok":true,"message":"bridge-server is running"}` แปลว่า bridge
ทำงานปกติและ tunnel เชื่อมถึงแล้ว (endpoint นี้ไม่ต้อง auth key)

ถ้าเว็บ Render โหลดข้อมูลไม่ขึ้น (เช่น หน้าแอดมินขึ้น error) ให้เช็คตาม
ลำดับนี้:
1. XAMPP MySQL ยัง Start อยู่ไหม
2. Terminal A (`bridge-server.js`) ยังเปิดค้างไม่มี error ไหม
3. Terminal B (`cloudflared`) ยังเปิดค้างอยู่ไหม
4. `DB_BRIDGE_URL` บน Render ตรงกับ URL ล่าสุดจาก cloudflared ไหม
5. `DB_BRIDGE_KEY` บน Render ตรงกับ `BRIDGE_AUTH_KEY` ในไฟล์ `.env` เป๊ะไหม
   (พิมพ์ผิดตัวเดียวก็จะขึ้น `401 unauthorized` ทันที)

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
      ต่อด้วย: ติดตั้ง `cloudflared` (ข้อ 7.1) + ตั้งค่า `BRIDGE_PORT`/
      `BRIDGE_AUTH_KEY` ใน `.env` (ข้อ 7.2) — ถ้าเครื่องนี้ใช้แค่ offline
      ไม่ต้องทำข้อนี้
- [ ] ถ้าเปลี่ยนเครื่องหลักที่เปิด bridge+cloudflared ไปใช้เครื่องนี้แทน
      อย่าลืมเข้าไปแก้ค่า `DB_BRIDGE_URL` บน Render ให้เป็น URL
      cloudflared ของเครื่องใหม่ด้วย (ไม่งั้นเว็บ Render ยังจะพยายามยิง
      ไปที่เครื่องเก่าอยู่) และเช็คว่า `DB_BRIDGE_KEY` บน Render ยังตรง
      กับ `BRIDGE_AUTH_KEY` ของเครื่องใหม่
- [ ] **ข้อ 6** — รัน `npm start` แล้วเช็คทุก flow ตามลิสต์ทดสอบ (สมัครครู
      → ยืม → คืน → ดูประวัติ → export → อัปโหลดรูป)