// config/db.js
// แทนที่ config/supabaseClient.js เดิม
//
// สลับสองโหมดอัตโนมัติตาม env var DB_MODE:
//
//   DB_MODE=local (หรือไม่ตั้งเลย — ค่า default)
//     คุย MySQL ผ่าน mysql2 ตรงๆ ผ่าน localhost — ใช้ตอน dev บนเครื่อง
//     local หรือรันจริงบนเครื่องเดียวกับ XAMPP เลย (ไม่ต้องมี Render)
//     ทดสอบแล้วว่าทำงานถูกต้องจริง — ดู README section 12.1
//
//   DB_MODE=bridge
//     ยิง HTTP ไปหา bridge-server.js (ที่รันอยู่บนเครื่อง local คู่กับ
//     XAMPP) แทนที่จะต่อ MySQL ตรง — ใช้ตอนรันบน Render ดู README
//     section 11
//
// ==== สำคัญ: route files (tap.js, keys.js, ฯลฯ) เรียกใช้ query() และ
// withTransaction() แบบเดียวกันทุกจุด ไม่ว่าจะรันโหมดไหน — ไม่ต้องรู้
// เรื่อง local/bridge เลย โค้ด route ที่จะเขียนต่อจากนี้เขียนได้เหมือน
// เดิมทุกอย่างตามที่ MANIFEST ระบุไว้ ====

require("dotenv").config();

const DB_MODE = process.env.DB_MODE === "bridge" ? "bridge" : "local";

let impl;

if (DB_MODE === "local") {
  // -----------------------------------------------------------
  // โหมด local: คุย MySQL ตรงผ่าน mysql2 — ใช้ pool กลางจาก
  // config/mysql-pool.js (ตัวเดียวกับที่ bridge-server.js ใช้ตอนมันรับ
  // request มาจาก Render แล้วส่งต่อ MySQL local)
  // -----------------------------------------------------------
  const mysqlPool = require("./mysql-pool");
  impl = {
    query: mysqlPool.query,
    getConnection: mysqlPool.getConnection,
    withTransaction: mysqlPool.withTransaction,
    pool: mysqlPool.pool,
  };
} else {
  // -----------------------------------------------------------
  // โหมด bridge: ยิง HTTP ไปหา bridge-server.js แทน
  // -----------------------------------------------------------
  impl = require("./db-bridge-client");
}

module.exports = {
  query: impl.query,
  getConnection: impl.getConnection,
  withTransaction: impl.withTransaction,
  pool: impl.pool,
};