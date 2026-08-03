# วิธี Deploy ขึ้น Render + เชื่อม Supabase

## โครงสร้างไฟล์ในโปรเจกต์นี้

```
webapp/
├─ server.js                  → ไฟล์หลักของเซิร์ฟเวอร์ (Express)
├─ package.json                → รายชื่อ dependency
├─ .gitignore                  → กัน .env หลุดขึ้น Git
├─ .env.example                → *ไฟล์คีย์* template + วิธีหาคีย์ (อ่านในไฟล์นี้)
├─ config/
│  └─ supabaseClient.js        → จุดเดียวที่เชื่อมต่อ Supabase (อ่านคีย์จาก .env)
├─ routes/
│  └─ auth.js                  → logic login นักเรียน/แอดมิน
├─ public/                     → หน้าเว็บ (frontend)
│  ├─ login.html
│  ├─ css/style.css
│  └─ js/login.js
└─ sql/
   └─ schema.sql                → คำสั่งสร้างตาราง (รันใน Supabase SQL Editor)
```

---

## ขั้นตอนที่ 1: ตั้งค่า Supabase

1. เข้า https://supabase.com สร้างโปรเจกต์ใหม่ (ดูขั้นตอนละเอียดในไฟล์ `.env.example`)
2. เข้า **SQL Editor** ในโปรเจกต์ Supabase แล้ววางโค้ดจาก `sql/schema.sql` ลงไป กด Run
   (จะได้ตาราง `students` พร้อมใช้งาน)
3. ไปที่ **Project Settings → API** คัดลอกค่า **Project URL** และ **service_role key** เก็บไว้

---

## ขั้นตอนที่ 2: ทดสอบรันบนเครื่องตัวเอง (ถ้ามีคอมที่ลง Node ได้)

```bash
cd webapp
npm install
cp .env.example .env
```

จากนั้นเปิดไฟล์ `.env` แก้ค่า `SUPABASE_URL` และ `SUPABASE_SERVICE_ROLE_KEY` ให้เป็นค่าจริงจากขั้นตอนที่ 1 แล้วรัน:

```bash
npm start
```

เปิดเบราว์เซอร์ไปที่ `http://localhost:3000`

---

## ขั้นตอนที่ 3: อัปโค้ดขึ้น GitHub

```bash
git init
git add .
git commit -m "หน้าแรก: login/สมัครใช้งาน"
git branch -M main
git remote add origin <ลิงก์ repo ของคุณ>
git push -u origin main
```

**เช็คก่อน push ทุกครั้ง:** ไฟล์ `.env` (ตัวจริง ไม่ใช่ `.env.example`) ต้อง**ไม่ถูก commit ขึ้นไป** — `.gitignore` กันไว้ให้แล้ว แต่ลองรัน `git status` เช็คอีกทีว่าไม่มีไฟล์ `.env` โผล่ในลิสต์ที่จะ commit

---

## ขั้นตอนที่ 4: Deploy บน Render

1. เข้า https://render.com สมัคร/ล็อกอิน (เชื่อมกับ GitHub ได้เลย)
2. กด **New +** → **Web Service**
3. เลือก repo ของโปรเจกต์นี้
4. ตั้งค่า:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Region**: เลือกที่ใกล้ผู้ใช้งานที่สุด (เช่น Singapore)
5. ไปที่แท็บ **Environment** ของ service ที่สร้าง เพิ่มตัวแปรต่อไปนี้ทีละตัว (ค่าจากไฟล์ `.env` ของคุณ):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`
   - (ไม่ต้องตั้ง `PORT` เอง Render จัดการให้อัตโนมัติ)
6. กด **Deploy** รอสักครู่ Render จะให้ลิงก์สาธารณะมา เช่น `https://your-app.onrender.com`

---

## ทดสอบว่าเชื่อม Supabase สำเร็จหรือยัง

1. เข้าลิงก์เว็บที่ได้จาก Render
2. กรอกฟอร์มนักเรียนด้วยข้อมูลทดสอบ เช่น รหัส `69319011766`
3. ถ้าขึ้น "✅ สร้างบัญชีใหม่และเข้าสู่ระบบสำเร็จ" แปลว่าเชื่อมฐานข้อมูลสำเร็จแล้ว
4. เข้าไปเช็คใน Supabase → **Table Editor** → ตาราง `students` จะเห็น record ที่เพิ่งสร้างขึ้นจริง

---

## หมายเหตุสำหรับเวอร์ชันทดสอบนี้

- ยังไม่มีระบบ session/JWT จริงจัง (login แล้วยังไม่ redirect ไปหน้าอื่น เพราะหน้าอื่นยังไม่ได้สร้าง)
- ตาราง `admins` **ไม่มีในฐานข้อมูล** เพราะ requirement บอกให้ hardcode ไว้ผ่าน environment variable แทน
- ตารางอื่นๆ (teacher_tags, room_tags, room_items, transactions, access_violation_logs) ยังไม่ได้สร้าง จะทยอยเพิ่มใน `sql/schema.sql` เมื่อเริ่มทำหน้าถัดไป
