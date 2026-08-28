-- sql/schema.sql
-- -----------------------------------------------------------------
-- MySQL/MariaDB Schema สำหรับระบบยืม-คืนกุญแจด้วย RFID
-- เปลี่ยนจาก Supabase PostgreSQL มาเป็น MySQL
-- -----------------------------------------------------------------
-- วิธีรัน: 
--   1. เปิด phpMyAdmin → สร้าง database ชื่อ key_borrow_db
--   2. Import file นี้เข้า database
--   หรือ CLI: mysql -u root -p key_borrow_db < schema.sql

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------
-- 1. Teachers table (ครู)
-- -----------------------------------------------------------------
DROP TABLE IF EXISTS `teachers`;
CREATE TABLE `teachers` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `name` TEXT NOT NULL,
  `department` TEXT,
  `teacher_code` VARCHAR(255) NOT NULL UNIQUE,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_login_at` DATETIME NULL,
  INDEX idx_teacher_code (teacher_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------
-- 2. Teacher Tags table (แท็ก RFID ประจำตัวครู)
-- ความสัมพันธ์: 1 ครู = 1 แท็ก (1:1 unique)
-- -----------------------------------------------------------------
DROP TABLE IF EXISTS `teacher_tags`;
CREATE TABLE `teacher_tags` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `teacher_id` BIGINT NOT NULL UNIQUE,
  `tag_uid` VARCHAR(255) NOT NULL UNIQUE,
  `assigned_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT `fk_teacher_tags_teacher`
    FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_teacher_tags_tag_uid ON `teacher_tags` (`tag_uid`);

-- -----------------------------------------------------------------
-- 3. Room Tags table (กุญแจ/ห้อง — แต่ละดอก = 1 แท็ก)
-- status: 'available' = ว่าง, 'borrowed' = ถูกยืมอยู่
-- -----------------------------------------------------------------
DROP TABLE IF EXISTS `room_tags`;
CREATE TABLE `room_tags` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `room_name` TEXT NOT NULL,
  `tag_uid` VARCHAR(255) UNIQUE NOT NULL,
  `description` TEXT,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  
  `status` VARCHAR(20) NOT NULL DEFAULT 'available',
  `borrowed_by_teacher_id` BIGINT NULL,
  `borrowed_at` DATETIME NULL,
  
  `borrow_window_days` JSON NULL COMMENT 'เช่น [1,2,3,4,5]',
  `borrow_window_start` TIME NULL,
  `borrow_window_end` TIME NULL,
  
  `image_url` TEXT NULL,
  
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT `chk_room_tags_status`
    CHECK (`status` IN ('available', 'borrowed')),
  
  CONSTRAINT `chk_room_tags_borrower` CHECK (
    (`status` = 'available' AND `borrowed_by_teacher_id` IS NULL AND `borrowed_at` IS NULL)
    OR
    (`status` = 'borrowed' AND `borrowed_by_teacher_id` IS NOT NULL AND `borrowed_at` IS NOT NULL)
  ),
  
  CONSTRAINT `fk_room_tags_borrowed_by`
    FOREIGN KEY (`borrowed_by_teacher_id`) REFERENCES `teachers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_room_tags_tag_uid ON `room_tags` (`tag_uid`);
CREATE INDEX idx_room_tags_status ON `room_tags` (`status`);
CREATE INDEX idx_room_tags_borrowed_by ON `room_tags` (`borrowed_by_teacher_id`);

-- -----------------------------------------------------------------
-- 4. Room Images table (หลายรูปต่อห้อง)
-- -----------------------------------------------------------------
DROP TABLE IF EXISTS `room_images`;
CREATE TABLE `room_images` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `room_tag_id` BIGINT NOT NULL,
  `image_url` TEXT NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT `fk_room_images_room_tag`
    FOREIGN KEY (`room_tag_id`) REFERENCES `room_tags` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_room_images_room_tag_id_sort ON `room_images` (`room_tag_id`, `sort_order`);

-- -----------------------------------------------------------------
-- 5. Key Logs table (ประวัติยืม-คืน)
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
    FOREIGN KEY (`room_tag_id`) REFERENCES `room_tags` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_key_logs_teacher`
    FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_key_logs_room_tag_id ON `key_logs` (`room_tag_id`);
CREATE INDEX idx_key_logs_teacher_id ON `key_logs` (`teacher_id`);
CREATE INDEX idx_key_logs_acted_at ON `key_logs` (`acted_at`);

SET FOREIGN_KEY_CHECKS = 1;
