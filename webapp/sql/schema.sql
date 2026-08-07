-- =================================================================
-- schema.sql
-- ระบบยืม-คืน "กุญแจ" ด้วยแท็ก RFID (เวอร์ชันตัดสเกล)
--
-- แนวคิดใหม่ (เทียบกับเวอร์ชันเดิม):
--   - ไม่มีนักเรียนในระบบแล้ว -> ตัดตาราง students ทิ้งทั้งหมด
--   - ไม่มี "ของ" แยกจากห้อง -> กุญแจทุกดอก "คือ" row เดียวใน room_tags
--     เอง (ตัดตาราง room_items ทิ้ง ย้าย status/borrowed_by เข้ามาอยู่ใน
--     room_tags ตรงๆ)
--   - ไม่มีมอบหมายครูดูแลห้อง -> ครูคนไหนมีแท็กประจำตัวก็ยืมกุญแจห้อง
--     ไหนก็ได้ทั้งหมด (ตัดตาราง teacher_room_assignments + trigger 6 ห้อง)
--   - ไม่มี flow ขอยืม/รออนุมัติ -> แตะแท็กครู แล้วแตะแท็กกุญแจ =
--     ยืม/คืนสำเร็จทันที (ตัดตาราง transactions แบบ pending/approve
--     ทิ้ง แทนที่ด้วย key_logs ซึ่งเป็นแค่ log อย่างเดียว ไม่มีสถานะ
--     รออนุมัติ)
--   - ตัด access_violation_logs ทิ้ง (ของเดิมไว้จับ role ผิดสิทธิ์
--     ซึ่งไม่มี concept นั้นแล้วในระบบใหม่ที่มีแค่ครู/แอดมิน)
--
-- Flow จริงหน้างาน (ดู README ประกอบ):
--   1. ครูแตะแท็กประจำตัวที่เครื่องอ่าน (ตั้งอยู่ห้องทะเบียน) -> เปิด
--      "session" ชั่วคราวฝั่ง backend (เก็บใน memory ไม่ต้องมีตาราง
--      เพราะอายุสั้นแค่ไม่กี่วินาที/นาที)
--   2. แตะแท็กกุญแจต่อได้เรื่อยๆ (หลายดอก) ภายใน session เดียวกัน ->
--      แต่ละดอกที่แตะ toggle สถานะ available <-> borrowed ทันที
--   3. ถ้าจะคืน ก็แตะแท็กครูคนเดิม (คนที่ยืมไป) แล้วแตะแท็กกุญแจดอกนั้น
--      ซ้ำอีกที -> ระบบเห็นว่า borrowed อยู่โดยครูคนนี้แล้ว จึงคืนให้
-- =================================================================

create table if not exists teachers (
  id bigint generated always as identity primary key,
  name text not null,
  department text,
  teacher_code text not null unique,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create index if not exists idx_teachers_teacher_code on teachers (teacher_code);

-- -----------------------------------------------------------------
-- teacher_tags: ผูก teacher <-> เลขแท็กประจำตัว (1:1) แอดมิน assign เท่านั้น
-- -----------------------------------------------------------------
create table if not exists teacher_tags (
  id bigint generated always as identity primary key,
  teacher_id bigint not null unique references teachers (id) on delete cascade,
  tag_uid text not null unique,
  assigned_at timestamptz not null default now()
);

create index if not exists idx_teacher_tags_tag_uid on teacher_tags (tag_uid);

-- -----------------------------------------------------------------
-- room_tags: กุญแจแต่ละดอก (การ์ด/แท็กจริง 1 ใบต่อ 1 กุญแจ) พร้อม
-- สถานะปัจจุบันอยู่ในตัวเลย ไม่ต้องมีตาราง "ของ" แยกอีกชั้นเหมือนเดิม
-- -----------------------------------------------------------------
create table if not exists room_tags (
  id bigint generated always as identity primary key,
  room_name text not null,
  tag_uid text unique, -- เลขแท็กจริง; null ได้ตอนแอดมินสร้างไว้ก่อนที่จะมีแท็กจริงมาผูก
  description text,
  is_active boolean not null default true,

  status text not null default 'available'
    check (status in ('available', 'borrowed')),
  borrowed_by_teacher_id bigint references teachers (id) on delete set null,
  borrowed_at timestamptz,

  -- ช่วงเวลาที่อนุญาตให้ "ยืม" (บังคับจริงที่ /api/tap ไม่ใช่แค่แสดงผล)
  -- borrow_window_days: อาร์เรย์ของวันในสัปดาห์ที่อนุญาต (0=อาทิตย์ .. 6=เสาร์)
  --   null = ไม่จำกัดวัน (ยืมได้ทุกวัน)
  -- borrow_window_start / borrow_window_end: ช่วงเวลาในแต่ละวันที่อนุญาต
  --   null ทั้งคู่ = ไม่จำกัดเวลา
  -- การ "คืน" ไม่ถูกจำกัดด้วยฟิลด์เหล่านี้เลย ไม่ว่ากรณีใด (จงใจ — ครูต้อง
  -- คืนกุญแจได้เสมอ ป้องกันกรณีค้างคืนเพราะติดช่วงเวลาห้ามยืม)
  borrow_window_days smallint[],
  borrow_window_start time,
  borrow_window_end time,

  created_at timestamptz not null default now(),

  -- status ต้องสอดคล้องกับ borrowed_by_teacher_id/borrowed_at เสมอ
  constraint chk_room_tags_borrower check (
    (status = 'available' and borrowed_by_teacher_id is null and borrowed_at is null)
    or
    (status = 'borrowed' and borrowed_by_teacher_id is not null and borrowed_at is not null)
  )
);

create index if not exists idx_room_tags_tag_uid on room_tags (tag_uid);
create index if not exists idx_room_tags_status on room_tags (status);

-- -----------------------------------------------------------------
-- room_images: หลายรูปต่อห้อง/กุญแจ 1 ดอก (แทนที่ room_tags.image_url
-- เดี่ยวเดิม) เก็บลำดับการแสดงผลไว้ใน sort_order ให้แอดมินจัดเรียงได้
-- room_tags.image_url เดิมยังคงอยู่เพื่อ backward compat กับโค้ด/ข้อมูล
-- เก่าที่ยังอ้างอิงอยู่ (ดู migration note ด้านล่าง)
-- -----------------------------------------------------------------
create table if not exists room_images (
  id bigint generated always as identity primary key,
  room_tag_id bigint not null references room_tags (id) on delete cascade,
  image_url text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_room_images_room_tag_id_sort
  on room_images (room_tag_id, sort_order);

-- -----------------------------------------------------------------
-- key_logs: ประวัติยืม-คืนทั้งหมด (แทน transactions เดิม แต่ไม่มี
-- สถานะ pending/approve แล้ว — แตะปุ๊บบันทึกปั๊บ เป็น log ล้วนๆ)
-- -----------------------------------------------------------------
create table if not exists key_logs (
  id bigint generated always as identity primary key,
  room_tag_id bigint not null references room_tags (id) on delete cascade,
  teacher_id bigint not null references teachers (id) on delete cascade,
  action text not null check (action in ('borrow', 'return')),
  acted_at timestamptz not null default now()
);

create index if not exists idx_key_logs_room_tag_id on key_logs (room_tag_id);
create index if not exists idx_key_logs_teacher_id on key_logs (teacher_id);
create index if not exists idx_key_logs_acted_at on key_logs (acted_at);

-- -----------------------------------------------------------------
-- RLS: ปิดไว้เหมือนเดิม (backend คุยผ่าน service_role key)
-- -----------------------------------------------------------------
alter table teachers disable row level security;
alter table teacher_tags disable row level security;
alter table room_tags disable row level security;
alter table key_logs disable row level security;
alter table room_images disable row level security;

-- -----------------------------------------------------------------
-- MIGRATION NOTE (ถ้ามี DB เดิมอยู่แล้วจากเวอร์ชันก่อนหน้า):
-- รันตามลำดับนี้บน DB เดิมเพื่ออัปเกรดแทนการสร้างใหม่ทั้งหมด:
--
--   drop table if exists access_violation_logs;
--   drop table if exists transactions;
--   drop table if exists teacher_room_assignments;
--   drop table if exists room_items;
--   drop table if exists students;
--
--   alter table room_tags add column if not exists status text not null default 'available'
--     check (status in ('available', 'borrowed'));
--   alter table room_tags add column if not exists borrowed_by_teacher_id bigint
--     references teachers (id) on delete set null;
--   alter table room_tags add column if not exists borrowed_at timestamptz;
--   alter table room_tags add constraint chk_room_tags_borrower check (
--     (status = 'available' and borrowed_by_teacher_id is null and borrowed_at is null)
--     or
--     (status = 'borrowed' and borrowed_by_teacher_id is not null and borrowed_at is not null)
--   );
--
--   create table if not exists key_logs (
--     id bigint generated always as identity primary key,
--     room_tag_id bigint not null references room_tags (id) on delete cascade,
--     teacher_id bigint not null references teachers (id) on delete cascade,
--     action text not null check (action in ('borrow', 'return')),
--     acted_at timestamptz not null default now()
--   );
-- -----------------------------------------------------------------




-- =================================================================
-- Migration: เพิ่มรูปภาพห้อง/กุญแจ
-- รันใน Supabase SQL editor ครั้งเดียว
-- =================================================================

-- 1) เพิ่มคอลัมน์เก็บ public URL ของรูปห้อง
alter table room_tags
  add column if not exists image_url text;

-- 2) สร้าง Storage bucket สำหรับเก็บไฟล์รูปห้อง (public bucket เพราะต้อง
--    แสดงรูปให้ครูดูได้โดยไม่ต้อง sign URL)
insert into storage.buckets (id, name, public)
values ('room-images', 'room-images', true)
on conflict (id) do nothing;

-- 3) Storage policy: อนุญาตให้ทุกคนอ่านรูปได้ (bucket เป็น public อยู่แล้ว
--    แต่ policy นี้จำเป็นสำหรับ RLS ของ storage.objects)
--    หมายเหตุ: Postgres ไม่รองรับ "create policy if not exists" (ต่างจาก
--    create table/index) จึง drop เดิมทิ้งก่อนเสมอแล้วค่อยสร้างใหม่
--    เพื่อให้สคริปต์นี้รันซ้ำได้โดยไม่ error
drop policy if exists "Public read room images" on storage.objects;

create policy "Public read room images"
  on storage.objects for select
  using (bucket_id = 'room-images');

-- หมายเหตุ: การ insert/update/delete รูปทำผ่าน service_role key ฝั่ง
-- backend (supabaseClient.js) เท่านั้น ซึ่ง bypass RLS อยู่แล้ว จึงไม่ต้อง
-- เพิ่ม policy insert/update/delete ให้ client ฝั่ง browser โดยตรง


-- =================================================================
-- Migration: หลายรูปต่อห้อง + ช่วงเวลาที่อนุญาตยืม
-- รันใน Supabase SQL editor ครั้งเดียว (รันซ้ำได้ปลอดภัย — ใช้ if not exists)
-- =================================================================

-- 1) ช่วงเวลาที่อนุญาตยืม บน room_tags (บังคับจริงที่ /api/tap)
alter table room_tags
  add column if not exists borrow_window_days smallint[];

alter table room_tags
  add column if not exists borrow_window_start time;

alter table room_tags
  add column if not exists borrow_window_end time;

-- 2) ตารางรูปภาพหลายรูปต่อห้อง (room_tags.image_url เดิมยังคงอยู่ ไม่ลบ
--    ทิ้ง เผื่อโค้ด/หน้าจอเก่าที่ยังอ้างอิง field เดี่ยวนี้อยู่ระหว่าง
--    ทยอยย้ายไปใช้ room_images แทน)
create table if not exists room_images (
  id bigint generated always as identity primary key,
  room_tag_id bigint not null references room_tags (id) on delete cascade,
  image_url text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_room_images_room_tag_id_sort
  on room_images (room_tag_id, sort_order);

alter table room_images disable row level security;