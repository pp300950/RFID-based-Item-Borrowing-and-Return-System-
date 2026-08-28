// config/mysql-pool.js
// -----------------------------------------------------------------
// Pool กลางตัวเดียวที่คุย MySQL/MariaDB ผ่าน mysql2 ตรงๆ ผ่าน localhost
// เท่านั้น (ไม่ว่าจะถูกเรียกจากที่ไหนก็ตาม ไฟล์นี้ไม่รู้จัก "bridge"
// หรือ Render เลย — แค่เป็น pool ธรรมดา)
//
// ใช้ร่วมกันโดย 2 จุด (ตามที่ตกลงกันไว้ กันโค้ด query/transaction ซ้ำ):
//   1. config/db.js         (โหมด DB_MODE=local) — export ตรงๆ ผ่าน db.js
//   2. bridge-server.js     (รันบนเครื่อง local คู่กับ XAMPP) — ใช้ query()
//      สำหรับ endpoint POST /query และใช้ pool.getConnection() ตรงๆ
//      สำหรับ interactive transaction (/transaction/begin ฯลฯ)
//
// ตัวแปร env ที่ต้องตั้ง (เหมือนกับที่ .env / .env.example ใช้ทุกจุด):
//   DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT (default 3306)
//
// ⚠️ เรื่อง root@localhost ต่อ TCP ไม่ได้ — ดู README section 12.3:
// ต้องสร้าง MySQL user แยก (host '%' + มี password) ไม่ใช้ root เปล่าๆ
// -----------------------------------------------------------------

require("dotenv").config();

const mysql = require("mysql2/promise");

const DB_HOST = process.env.DB_HOST || "localhost";
const DB_USER = process.env.DB_USER || "root";
const DB_PASSWORD = process.env.DB_PASSWORD || "";
const DB_NAME = process.env.DB_NAME;
const DB_PORT = process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306;

if (!DB_NAME) {
  console.warn(
    "⚠️  ยังไม่ได้ตั้งค่า DB_NAME ใน .env — ทุก query จะ error ทันที " +
    "(ดูตัวอย่างค่าที่ต้องตั้งใน .env.example)"
  );
}

// connectTimeout ตั้งไว้สูงกว่า default ของ mysql2 (10s) เพราะ
// bridge-server.js เองก็ใช้ pool ตัวนี้ และบางครั้งเครื่อง local
// (XAMPP) เพิ่งเปิด MySQL ขึ้นมาสดๆ อาจตอบช้ากว่าปกติรอบแรก
const pool = mysql.createPool({
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  port: DB_PORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 20000,
  // เก็บ JSON column (borrow_window_days) ให้ mysql2 คืนเป็น string
  // ธรรมดา ไม่ auto-parse ให้ — โค้ด route ทำ JSON.parse/stringify เอง
  // ตามที่ตกลงกันไว้ใน schema.sql (กันพฤติกรรม auto-parse ของบาง
  // เวอร์ชัน driver ที่ไม่ตรงกันระหว่าง MySQL/MariaDB)
  typeCast: function typeCast(field, next) {
    return next();
  },
});

/**
 * query(sql, params) — เทียบเท่า pool.query() ของ mysql2 ตรงๆ
 * คืนค่าเป็น [rows, fields] tuple เหมือนเดิมทุกจุด เพื่อให้ route files
 * เขียน `const [rows] = await query(...)` ได้แบบเดียวกันไม่ว่าจะโหมดไหน
 */
async function query(sql, params) {
  return pool.query(sql, params);
}

/**
 * getConnection() — ขอ connection เดี่ยวจาก pool ตรงๆ (ไม่ auto-release)
 * ผู้เรียกต้อง connection.release() เองเสมอ — ใช้กรณีต้องคุม connection
 * เดียวข้ามหลาย query แบบ manual (bridge-server.js ใช้จุดนี้ทำ
 * interactive transaction ที่ค้างข้าม HTTP request หลายครั้ง)
 */
async function getConnection() {
  return pool.getConnection();
}

/**
 * withTransaction(callback) — เปิด connection เดี่ยวจาก pool, เริ่ม
 * transaction, เรียก callback(connection) — ถ้า callback จบแบบไม่ throw
 * จะ commit ให้ ถ้า throw จะ rollback ให้ก่อนโยน error เดิมต่อ ไม่ว่า
 * กรณีไหนก็ release() connection คืน pool เสมอในตอนท้าย
 *
 * callback รับ "connection" จริงจาก mysql2 (มี .query() ปกติ) — ต่างจาก
 * db-bridge-client.js ที่ส่ง fake connection object แทน แต่หน้าตาการ
 * เรียกใช้จากมุมมอง route files เหมือนกันทุกจุด: await connection.query(...)
 */
async function withTransaction(callback) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (err) {
    try {
      await connection.rollback();
    } catch (rollbackErr) {
      console.error("rollback ล้มเหลว:", rollbackErr.message);
    }
    throw err;
  } finally {
    connection.release();
  }
}

module.exports = {
  query,
  getConnection,
  withTransaction,
  pool,
};
