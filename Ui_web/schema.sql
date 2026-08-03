-- =================================================================
-- schema.sql
-- สคีมาฐานข้อมูลสำหรับระบบยืม-คืนอุปกรณ์ (เวอร์ชันทดสอบ)
--
-- วิธีรัน:
--   1. เข้าโปรเจกต์ Supabase ของคุณ
--   2. ไปที่เมนูซ้าย -> "SQL Editor"
--   3. กด "New query" แล้ววางโค้ดทั้งหมดนี้ลงไป
--   4. กด "Run"
--
-- หมายเหตุ: ตอนนี้มีแค่ตาราง students เพราะหน้าที่ทำเป็นหน้าแรก
-- คือหน้าสมัคร/เข้าสู่ระบบเท่านั้น ตารางอื่น (teacher_tags, room_tags,
-- transactions ฯลฯ) จะเพิ่มเข้ามาทีหลังตามที่ทำแต่ละหน้าเพิ่ม
-- =================================================================

create table if not exists students (
  id bigint generated always as identity primary key,
  name text not null,
  room text not null,
  seat_no text not null,
  student_code text not null unique,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

-- index ช่วยให้ค้นหาด้วยรหัสนักเรียนเร็วขึ้น (ใช้ตอน login ทุกครั้ง)
create index if not exists idx_students_student_code on students (student_code);

-- Row Level Security: ปิดไว้ก่อนสำหรับเวอร์ชันทดสอบ เพราะ backend (Express)
-- เป็นคนคุยกับฐานข้อมูลด้วย service_role key อยู่แล้ว (bypass RLS โดยธรรมชาติ)
-- ถ้าในอนาคตจะให้ frontend คุยกับ Supabase ตรงๆ ด้วย anon key ต้องมาเปิดและ
-- ตั้งค่า RLS policy ให้เหมาะสมก่อนเสมอ
alter table students disable row level security;
