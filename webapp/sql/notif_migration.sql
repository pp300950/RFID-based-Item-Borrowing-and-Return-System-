-- =================================================================
-- sql/notif_migration.sql
-- Migration เพิ่มเติมสำหรับฟีเจอร์ "แจ้งเตือนผ่าน LINE OA"
--
-- รันไฟล์นี้ "ต่อจาก" schema.sql เดิม (ไม่ต้องรันซ้ำ schema.sql เดิม
-- ไฟล์นี้เป็น ALTER/CREATE เพิ่มเข้าไปในฐานข้อมูลที่มีอยู่แล้วเท่านั้น)
--
-- สิ่งที่เพิ่ม:
--   1. line_targets      — เก็บ LINE group ID ที่จะยิงข้อความแจ้งเตือนเข้าไป
--                          (ได้มาจาก webhook ตอนเชิญบอทเข้ากลุ่ม ดู
--                          routes/line_webhook.js)
--   2. key_logs.overdue_notified_date
--                        — กันแจ้งเตือน "เกินเวลาคืน" ซ้ำ: แจ้งได้แค่
--                          "1 ครั้งต่อการยืม 1 ครั้ง ต่อวัน" ตามที่ตกลงกัน
--                          เก็บเป็นวันที่ (DATE) ที่แจ้งไปแล้วล่าสุด ถ้า
--                          เป็นวันเดียวกับวันนี้ = ข้าม ไม่แจ้งซ้ำ
-- =================================================================

SET NAMES utf8mb4;

-- -----------------------------------------------------------------
-- line_targets: กลุ่ม/ปลายทางที่จะส่งข้อความแจ้งเตือนเข้าไป
--
-- ออกแบบให้รองรับได้มากกว่า 1 กลุ่มในอนาคต (เผื่อวันหน้าอยากแยกกลุ่ม
-- แอดมิน กับกลุ่มห้องทะเบียน) แต่ตอนนี้ใช้งานจริงแค่แถวเดียวที่
-- is_active = 1 เท่านั้น — ดู services/line_notify.js
--
-- target_id: LINE group ID (ขึ้นต้นด้วย "C...") ได้จาก webhook event
-- "join" ตอนเชิญบอทเข้ากลุ่ม (log ออก console ฝั่ง Render ให้ก็อปมา
-- ใส่ตารางนี้ หรือระบบจะ insert ให้อัตโนมัติเมื่อ webhook เข้ามาก็ได้
-- ดู routes/line_webhook.js)
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `line_targets` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `target_type` VARCHAR(20) NOT NULL DEFAULT 'group',
  `target_id` VARCHAR(255) NOT NULL,
  `label` VARCHAR(255) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_line_targets_target_id` (`target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------
-- key_logs.overdue_notified_date
--
-- NULL = ยังไม่เคยแจ้งเกินเวลาสำหรับการยืมครั้งนี้เลย
-- ไม่ NULL = วันที่ (DATE, ไม่มีเวลา) ที่แจ้งไปแล้วล่าสุด — ถ้าตรงกับ
-- "วันนี้" (CURDATE()) ให้ overdue_checker.js ข้ามแถวนี้ไป ไม่แจ้งซ้ำ
-- ถ้าเลยมาอีกวันแล้วยังไม่คืน จะแจ้งได้อีกครั้งของวันใหม่ (1 ครั้ง/วัน
-- ตามที่ตกลงกัน)
--
-- ใช้คอลัมน์นี้กับแถว key_logs ที่ action = 'borrow' เท่านั้น (แถว
-- 'return' ไม่เกี่ยวข้องกับการเช็คเกินเวลา)
-- -----------------------------------------------------------------
ALTER TABLE `key_logs`
  ADD COLUMN IF NOT EXISTS `overdue_notified_date` DATE NULL AFTER `acted_at`;

CREATE INDEX IF NOT EXISTS `idx_key_logs_overdue_notified_date`
  ON `key_logs` (`overdue_notified_date`);
