-- =================================================================
-- schema.sql  (MySQL / MariaDB — สำหรับรันบน XAMPP)
-- ระบบยืม-คืน "กุญแจ" ด้วยแท็ก RFID
--
-- ย้ายจาก Postgres (Supabase) มา MySQL/MariaDB — ไฟล์นี้รวม schema
-- หลัก + migration ทั้งสองรอบของเวอร์ชัน Postgres เดิม (รูปภาพเดี่ยว,
-- รูปหลายรูป + ช่วงเวลายืม) เป็นไฟล์เดียวจบ เพราะสร้างฐานข้อมูลใหม่ทั้ง
-- ก้อนบน XAMPP ไม่มี DB เดิมให้ทยอย alter ตาม migration note
--
-- ตัดออกทั้งหมด (ไม่มีใน MySQL เลย ไม่ต้องแปล):
--   - Supabase Storage bucket/policy (storage.buckets, storage.objects)
--     -> รูปภาพเก็บเป็นไฟล์จริงใน public/uploads/room-images/ แทน
--      คอลัมน์ image_url เก็บแค่ path สัมพัทธ์ เช่น
--      "/uploads/room-images/room-12-171234.jpg"
--   - Row Level Security (RLS) -> ไม่มี concept นี้ใน MySQL, ไม่ต้องทำ
--     อะไรเลย (ของเดิมก็แค่ "ปิด" RLS อยู่แล้ว เพราะ backend คุยด้วย
--     service_role key ที่ bypass มันอยู่แล้ว — พฤติกรรมเดิมคือ "backend
--     full access" ซึ่ง MySQL user ที่ config/db.js ใช้ก็ full access
--     อยู่แล้วโดยธรรมชาติ ไม่ต้องตั้งอะไรเพิ่ม)
--
-- แนวทางแปลง type หลักๆ ที่ใช้ทั้งไฟล์:
--   bigint generated always as identity  -> BIGINT AUTO_INCREMENT
--   timestamptz not null default now()   -> DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
--   boolean                               -> TINYINT(1)
--   smallint[]  (borrow_window_days)     -> JSON  (เก็บเป็น [1,2,3,4,5])
--   time                                   -> TIME (เหมือนเดิม)
--   text ที่ต้อง unique/index             -> VARCHAR(255) (MySQL บังคับ
--                                            ต้องมีความยาวชัดเจนถ้าจะทำ
--                                            index/unique บน string)
--   text ทั่วไปที่ไม่ index                -> TEXT (คงไว้เหมือนเดิม)
--
-- หมายเหตุ DATETIME vs TIMESTAMP: เลือกใช้ DATETIME แทน TIMESTAMP เพราะ
-- MySQL TIMESTAMP มีช่วงค่าที่รองรับจำกัด (ปี 1970-2038) และผูกกับ
-- session timezone โดย auto-convert ซึ่งพฤติกรรมต่างจาก Postgres
-- timestamptz พอสมควร — DATETIME เก็บค่าตรงไปตรงมากว่า ไม่ auto-convert
-- ข้าม timezone ให้งงตอน query
--
-- CHECK constraint: MariaDB รองรับตั้งแต่ 10.2+ และ MySQL ตั้งแต่ 8.0.16+
-- — XAMPP รุ่นใหม่ๆ ส่วนใหญ่ผ่านเกณฑ์นี้แล้ว ถ้ารันแล้วเจอ error แบบ
-- "check constraint ... syntax" หรือคล้ายกัน (แปลว่าเวอร์ชันเก่ากว่านี้)
-- ให้ลบบรรทัด CONSTRAINT ... CHECK (...) ออกจาก CREATE TABLE ที่เจอปัญหา
-- แล้วพึ่ง logic ฝั่งแอป (tap.js) คุมแทนทั้งหมด — โค้ด tap.js เซ็ตทั้ง
-- คู่ status/borrowed_by_teacher_id/borrowed_at พร้อมกันเสมออยู่แล้วทุก
-- จุดที่ update สถานะ ความเสี่ยงต่ำถ้าต้องตัด constraint นี้ออกจริง
-- =================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------
-- teachers
-- -----------------------------------------------------------------
DROP TABLE IF EXISTS `teachers`;
CREATE TABLE `teachers` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `name` TEXT NOT NULL,
  `department` TEXT,
  `teacher_code` VARCHAR(255) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_login_at` DATETIME NULL,
  UNIQUE KEY `uq_teachers_teacher_code` (`teacher_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX `idx_teachers_teacher_code` ON `teachers` (`teacher_code`);

-- -----------------------------------------------------------------
-- teacher_tags: ผูก teacher <-> เลขแท็กประจำตัว (1:1) แอดมิน assign เท่านั้น
-- -----------------------------------------------------------------
DROP TABLE IF EXISTS `teacher_tags`;
CREATE TABLE `teacher_tags` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `teacher_id` BIGINT NOT NULL,
  `tag_uid` VARCHAR(255) NOT NULL,
  `assigned_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_teacher_tags_teacher_id` (`teacher_id`),
  UNIQUE KEY `uq_teacher_tags_tag_uid` (`tag_uid`),
  CONSTRAINT `fk_teacher_tags_teacher`
    FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX `idx_teacher_tags_tag_uid` ON `teacher_tags` (`tag_uid`);

-- -----------------------------------------------------------------
-- room_tags: กุญแจแต่ละดอก พร้อมสถานะปัจจุบันอยู่ในตัวเลย
--
-- borrow_window_days เก็บเป็น JSON แทน smallint[] ของ Postgres — เก็บ
-- เป็น array ของเลขวัน เช่น [1,2,3,4,5] (0=อาทิตย์..6=เสาร์) หรือ NULL
-- = ไม่จำกัดวัน ต้อง JSON.parse/JSON.stringify เองในโค้ด route (ไม่มี
-- native array type ให้ query กรองวันเดี่ยวๆ ในฐานข้อมูลได้ตรงๆ เหมือน
-- Postgres — แต่โค้ดเดิมก็ไม่เคยทำแบบนั้นอยู่แล้ว อ่าน-เขียนทั้งก้อน
-- เท่านั้น จึงไม่กระทบ)
--
-- image_url: คงคอลัมน์นี้ไว้เพื่อ backward-compat กับ endpoint เดี่ยว
-- เดิม (POST /rooms/:id/image) เก็บเป็น path สัมพัทธ์บนดิสก์แทน public
-- URL ของ Supabase Storage เช่น "/uploads/room-images/room-12-xxx.jpg"
-- -----------------------------------------------------------------
DROP TABLE IF EXISTS `room_tags`;
CREATE TABLE `room_tags` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `room_name` TEXT NOT NULL,
  `tag_uid` VARCHAR(255) NULL,
  `description` TEXT,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,

  `status` VARCHAR(20) NOT NULL DEFAULT 'available',
  `borrowed_by_teacher_id` BIGINT NULL,
  `borrowed_at` DATETIME NULL,

  `borrow_window_days` JSON NULL,
  `borrow_window_start` TIME NULL,
  `borrow_window_end` TIME NULL,

  -- [BLOB migration] รูปภาพเก็บเป็น binary ตรงใน MySQL แทนไฟล์บนดิสก์
  -- (image_url เดิม) เพราะดิสก์ของ Render เป็น ephemeral และคนละเครื่อง
  -- กับ MySQL local — เก็บเป็น BLOB แล้ว query ผ่าน bridge ได้เหมือน
  -- ข้อมูลอื่นทุกจุด ไม่ต้องพึ่ง path ไฟล์/tunnel URL อีกต่อไป
  `image_data` LONGBLOB NULL,
  `image_mime` VARCHAR(50) NULL,

  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY `uq_room_tags_tag_uid` (`tag_uid`),

  CONSTRAINT `chk_room_tags_status`
    CHECK (`status` IN ('available', 'borrowed')),

  -- status ต้องสอดคล้องกับ borrowed_by_teacher_id/borrowed_at เสมอ —
  -- ถ้า MariaDB/MySQL เวอร์ชันที่ใช้ไม่รองรับ CHECK (ต่ำกว่า 10.2 /
  -- 8.0.16) ให้ลบบล็อกนี้ทิ้งทั้งก้อน ดูหมายเหตุยาวด้านบนหัวไฟล์
  CONSTRAINT `chk_room_tags_borrower` CHECK (
    (`status` = 'available' AND `borrowed_by_teacher_id` IS NULL AND `borrowed_at` IS NULL)
    OR
    (`status` = 'borrowed' AND `borrowed_by_teacher_id` IS NOT NULL AND `borrowed_at` IS NOT NULL)
  ),

  CONSTRAINT `fk_room_tags_borrowed_by`
    FOREIGN KEY (`borrowed_by_teacher_id`) REFERENCES `teachers` (`id`)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX `idx_room_tags_tag_uid` ON `room_tags` (`tag_uid`);
CREATE INDEX `idx_room_tags_status` ON `room_tags` (`status`);

-- -----------------------------------------------------------------
-- room_images: หลายรูปต่อห้อง/กุญแจ 1 ดอก — room_tags.image_url เดิม
-- ยังอยู่เพื่อ backward compat เหมือนเวอร์ชัน Postgres
-- -----------------------------------------------------------------
DROP TABLE IF EXISTS `room_images`;
CREATE TABLE `room_images` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `room_tag_id` BIGINT NOT NULL,
  `image_data` LONGBLOB NOT NULL,
  `image_mime` VARCHAR(50) NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_room_images_room_tag`
    FOREIGN KEY (`room_tag_id`) REFERENCES `room_tags` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX `idx_room_images_room_tag_id_sort` ON `room_images` (`room_tag_id`, `sort_order`);

-- -----------------------------------------------------------------
-- key_logs: ประวัติยืม-คืนทั้งหมด — log ล้วนๆ ไม่มีสถานะ pending/approve
-- -----------------------------------------------------------------
DROP TABLE IF EXISTS `key_logs`;
CREATE TABLE `key_logs` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `room_tag_id` BIGINT NOT NULL,
  `teacher_id` BIGINT NOT NULL,
  `action` VARCHAR(20) NOT NULL,
  `acted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `chk_key_logs_action` CHECK (`action` IN ('borrow', 'return')),
  CONSTRAINT `fk_key_logs_room_tag`
    FOREIGN KEY (`room_tag_id`) REFERENCES `room_tags` (`id`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_key_logs_teacher`
    FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX `idx_key_logs_room_tag_id` ON `key_logs` (`room_tag_id`);
CREATE INDEX `idx_key_logs_teacher_id` ON `key_logs` (`teacher_id`);
CREATE INDEX `idx_key_logs_acted_at` ON `key_logs` (`acted_at`);

SET FOREIGN_KEY_CHECKS = 1;

-- -----------------------------------------------------------------
-- ไม่มี RLS ให้ปิด (MySQL ไม่มี concept นี้) — ตัดบล็อก
-- "alter table ... disable row level security" ทั้งหมดออก ไม่ต้องแปล
-- เป็นอะไรเลย ความหมายเดิม ("backend full access ผ่าน service key")
-- เทียบเท่ากับ MySQL user ธรรมดาที่ config/db.js ใช้เชื่อมต่ออยู่แล้ว
-- -----------------------------------------------------------------

-- -----------------------------------------------------------------
-- ไม่มี Supabase Storage bucket/policy ให้สร้าง — รูปภาพเก็บเป็น BLOB
-- ตรงในตาราง room_tags.image_data / room_images.image_data (ดูด้านบน)
-- แทนไฟล์บนดิสก์ ไม่ต้องสร้างโฟลเดอร์ public/uploads/room-images/
-- อีกต่อไป — ไม่มีอะไรต้องทำเพิ่มในไฟล์ schema นี้
-- -----------------------------------------------------------------