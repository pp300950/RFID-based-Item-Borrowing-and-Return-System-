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
-- หมายเหตุ: ตาราง students และ teachers ใช้สำหรับหน้าสมัคร/เข้าสู่ระบบ
-- เวอร์ชันทดสอบ ตารางอื่น (teacher_tags, room_tags, transactions ฯลฯ)
-- จะเพิ่มเข้ามาทีหลังตามที่ทำแต่ละหน้าเพิ่ม
--
-- เรื่องครู: ตาม README เดิม ครูตั้งใจให้ล็อกอินด้วยการแตะแท็ก RFID
-- ล้วนๆ ไม่มีฟอร์ม แต่เวอร์ชันนี้เพิ่ม "รหัสครู" (teacher_code) ให้
-- ล็อกอินผ่านเว็บได้ไปก่อน เผื่อระบบแท็กยังไม่พร้อม — ภายหลังจะผูก
-- teacher_tags.teacher_id -> teachers.id เพิ่มได้โดยไม่กระทบตารางนี้
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

create table if not exists teachers (
  id bigint generated always as identity primary key,
  name text not null,
  department text,
  teacher_code text not null unique,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

-- index ช่วยให้ค้นหาด้วยรหัสครูเร็วขึ้น (ใช้ตอน login ทุกครั้ง)
create index if not exists idx_teachers_teacher_code on teachers (teacher_code);

-- Row Level Security: ปิดไว้ก่อนสำหรับเวอร์ชันทดสอบ เพราะ backend (Express)
-- เป็นคนคุยกับฐานข้อมูลด้วย service_role key อยู่แล้ว (bypass RLS โดยธรรมชาติ)
-- ถ้าในอนาคตจะให้ frontend คุยกับ Supabase ตรงๆ ด้วย anon key ต้องมาเปิดและ
-- ตั้งค่า RLS policy ให้เหมาะสมก่อนเสมอ
alter table students disable row level security;
alter table teachers disable row level security;
