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

-- =================================================================
-- ส่วนเพิ่มเติม: ระบบยืม-คืนอุปกรณ์ (room_tags, room_items, teacher_tags,
-- teacher_room_assignments, transactions, access_violation_logs)
--
-- อ้างอิง decision จาก HANDOFF.md ข้อ 3-6:
--   - แท็กครู (teacher_tags) 1:1 กับ teachers, แอดมินเป็นคน assign ทีหลัง
--   - แท็กห้อง/กุญแจ (room_tags) อิสระจากครู, แอดมินเพิ่มทีหลังได้ (ยังไม่มี
--     เลขแท็กจริงตอนสร้างแถวก็ได้)
--   - ของที่ยืมได้ (room_items) ผูกกับ room_tags
--   - ห้องหนึ่งมีครูดูแลได้ "หลายคน" -> ต้องมีตารางกลาง many-to-many
--     (teacher_room_assignments) จำกัดครู 1 คนดูแลได้สูงสุด 6 ห้อง
--     (บังคับด้วย trigger เพราะ Postgres ไม่มี COUNT constraint ตรงๆ)
--   - transactions เก็บ log ยืม-คืนแบบ pending/approved
--   - access_violation_logs เก็บ log กรณีผิดปกติ/พยายามทำเกินสิทธิ์
-- =================================================================

-- -----------------------------------------------------------------
-- room_tags: ห้อง/กุญแจ (การ์ด/แท็กจริง 1 ใบต่อ 1 ห้องหรือกุญแจ)
-- -----------------------------------------------------------------
create table if not exists room_tags (
  id bigint generated always as identity primary key,
  room_name text not null,
  tag_uid text unique, -- เลขแท็กจริง; อนุญาตให้เป็น null ได้ตอนแอดมินสร้างห้องไว้ก่อนที่จะมีแท็กจริงมาผูก
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_room_tags_tag_uid on room_tags (tag_uid);

-- -----------------------------------------------------------------
-- room_items: ของที่ยืมได้จริงในแต่ละห้อง/กุญแจ
-- -----------------------------------------------------------------
create table if not exists room_items (
  id bigint generated always as identity primary key,
  room_tag_id bigint not null references room_tags (id) on delete cascade,
  item_name text not null,
  status text not null default 'available'
    check (status in ('available', 'borrowed')),
  -- ผู้ถือของอยู่ตอนนี้ (ยืมสำเร็จแล้ว ไม่ใช่ pending) อาจเป็นนักเรียนหรือครู
  -- เก็บเป็น 2 คอลัมน์แยก ประเภท + id เพราะนักเรียน/ครูอยู่คนละตาราง
  borrowed_by_type text check (borrowed_by_type in ('student', 'teacher')),
  borrowed_by_student_id bigint references students (id) on delete set null,
  borrowed_by_teacher_id bigint references teachers (id) on delete set null,
  borrowed_at timestamptz,
  created_at timestamptz not null default now(),
  -- borrowed_by_type ต้องสอดคล้องกับคอลัมน์ id ที่ไม่เป็น null
  constraint chk_room_items_borrower check (
    (status = 'available' and borrowed_by_type is null
      and borrowed_by_student_id is null and borrowed_by_teacher_id is null)
    or
    (status = 'borrowed' and borrowed_by_type = 'student'
      and borrowed_by_student_id is not null and borrowed_by_teacher_id is null)
    or
    (status = 'borrowed' and borrowed_by_type = 'teacher'
      and borrowed_by_teacher_id is not null and borrowed_by_student_id is null)
  )
);

create index if not exists idx_room_items_room_tag_id on room_items (room_tag_id);
create index if not exists idx_room_items_status on room_items (status);

-- -----------------------------------------------------------------
-- teacher_tags: ผูก teacher <-> เลขแท็กครู (1:1) แอดมิน assign เท่านั้น
-- -----------------------------------------------------------------
create table if not exists teacher_tags (
  id bigint generated always as identity primary key,
  teacher_id bigint not null unique references teachers (id) on delete cascade,
  tag_uid text not null unique,
  assigned_at timestamptz not null default now()
);

create index if not exists idx_teacher_tags_tag_uid on teacher_tags (tag_uid);

-- -----------------------------------------------------------------
-- teacher_room_assignments: many-to-many ครู <-> ห้องที่ดูแล
-- (1 ห้องมีครูดูแลได้หลายคน, 1 ครูดูแลได้สูงสุด 6 ห้อง)
-- -----------------------------------------------------------------
create table if not exists teacher_room_assignments (
  id bigint generated always as identity primary key,
  teacher_id bigint not null references teachers (id) on delete cascade,
  room_tag_id bigint not null references room_tags (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique (teacher_id, room_tag_id) -- กันมอบหมายซ้ำคู่เดิม
);

create index if not exists idx_tra_teacher_id on teacher_room_assignments (teacher_id);
create index if not exists idx_tra_room_tag_id on teacher_room_assignments (room_tag_id);

-- จำกัดครู 1 คนดูแลได้สูงสุด 6 ห้อง — ใช้ trigger เพราะ Postgres
-- ไม่รองรับการนับจำนวนแถวใน check constraint ตรงๆ
create or replace function fn_enforce_max_6_rooms_per_teacher()
returns trigger as $$
declare
  current_count int;
begin
  select count(*) into current_count
  from teacher_room_assignments
  where teacher_id = new.teacher_id;

  if current_count >= 6 then
    raise exception 'ครูคนนี้ดูแลห้องครบ 6 ห้องแล้ว (สูงสุดต่อคน)';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_max_6_rooms_per_teacher on teacher_room_assignments;
create trigger trg_max_6_rooms_per_teacher
  before insert on teacher_room_assignments
  for each row
  execute function fn_enforce_max_6_rooms_per_teacher();

-- -----------------------------------------------------------------
-- transactions: log การยืม-คืน แบบ pending -> approved
-- -----------------------------------------------------------------
create table if not exists transactions (
  id bigint generated always as identity primary key,
  room_item_id bigint not null references room_items (id) on delete cascade,

  action text not null check (action in ('borrow', 'return')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),

  -- ผู้ขอ (นักเรียนหรือครู กดขอยืม/ขอคืนเอง)
  requested_by_type text not null check (requested_by_type in ('student', 'teacher')),
  requested_by_student_id bigint references students (id) on delete set null,
  requested_by_teacher_id bigint references teachers (id) on delete set null,
  requested_at timestamptz not null default now(),

  -- ผู้อนุมัติ (ต้องเป็นครูที่มีสิทธิ์ดูแลห้องนั้นเท่านั้น ตาม teacher_room_assignments)
  approved_by_teacher_id bigint references teachers (id) on delete set null,
  approved_at timestamptz,

  constraint chk_transactions_requester check (
    (requested_by_type = 'student' and requested_by_student_id is not null and requested_by_teacher_id is null)
    or
    (requested_by_type = 'teacher' and requested_by_teacher_id is not null and requested_by_student_id is null)
  )
);

create index if not exists idx_transactions_room_item_id on transactions (room_item_id);
create index if not exists idx_transactions_status on transactions (status);

-- -----------------------------------------------------------------
-- access_violation_logs: เก็บ log กรณีผิดปกติ/เกินสิทธิ์
--
-- Case ที่ยืนยันจาก user:
--   1. พยายามยืมของที่ไม่มีสิทธิ์ / ไม่มีอยู่จริง (invalid_borrow_attempt)
--   2. ครูกดอนุมัติห้องที่ตัวเองไม่ได้ดูแล (unauthorized_approval)
-- Case เพิ่มเติมที่แนะนำ (ตามความเหมาะสม เผื่อไว้ใช้งานจริง):
--   3. พยายามคืนของที่ตัวเองไม่ได้เป็นคนยืม (invalid_return_attempt)
--   4. พยายามส่ง action ยืม/คืนซ้ำขณะมี pending transaction ค้างอยู่แล้ว
--      (duplicate_pending_request) — กันสแปมกดรัว
--   5. ครู/นักเรียนพยายามยิง request ตรงไปที่ endpoint โดยไม่ผ่าน UI ปกติ
--      เช่น room_item_id ไม่ตรง room ที่มีอยู่จริง (invalid_target)
-- ทุก case เก็บ event_type เป็น text แบบเปิด (ไม่ใช้ enum ตายตัว) เพื่อให้
-- เพิ่ม case ใหม่ในอนาคตได้โดยไม่ต้อง migrate ตาราง
-- -----------------------------------------------------------------
create table if not exists access_violation_logs (
  id bigint generated always as identity primary key,
  event_type text not null,
  -- ใครเป็นคนก่อเหตุ (แยก type เหมือนที่อื่นในสคีมานี้)
  actor_type text check (actor_type in ('student', 'teacher')),
  actor_student_id bigint references students (id) on delete set null,
  actor_teacher_id bigint references teachers (id) on delete set null,
  -- อ้างอิงถึง object ที่เกี่ยวข้อง (nullable เพราะบาง event ไม่มี room_item/transaction ชัดเจน)
  room_item_id bigint references room_items (id) on delete set null,
  transaction_id bigint references transactions (id) on delete set null,
  detail text, -- ข้อความอธิบายเพิ่มเติมแบบอ่านง่าย เก็บ context ไว้ debug
  created_at timestamptz not null default now()
);

create index if not exists idx_avl_event_type on access_violation_logs (event_type);
create index if not exists idx_avl_created_at on access_violation_logs (created_at);

-- -----------------------------------------------------------------
-- RLS: ปิดไว้ก่อนเหมือนตารางเดิม (backend คุยผ่าน service_role key)
-- -----------------------------------------------------------------
alter table room_tags disable row level security;
alter table room_items disable row level security;
alter table teacher_tags disable row level security;
alter table teacher_room_assignments disable row level security;
alter table transactions disable row level security;
alter table access_violation_logs disable row level security;
