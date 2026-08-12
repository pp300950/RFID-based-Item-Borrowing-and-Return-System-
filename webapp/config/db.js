// config/db.js
// แทนที่ config/supabaseClient.js เดิม
//
// ใช้ mysql2/promise สร้าง connection pool เดียวทั้งแอป แล้วให้ทุก
// route require ไฟล์นี้แทนการ import supabase client ตัวเก่า
//
// อ่านค่าเชื่อมต่อจาก .env: DB_HOST / DB_USER / DB_PASSWORD / DB_NAME
// (แทน SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY เดิม)

require("dotenv").config();
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 10,
  idleTimeout: 60000,
  queueLimit: 0,
  // ค่า default ของ mysql2 (10s) อาจสั้นไปเมื่อเชื่อมผ่าน Cloudflare
  // Tunnel ที่มี latency สูงกว่าเชื่อม localhost ตรงๆ — เพิ่มเผื่อไว้
  connectTimeout: 20000,
  // ให้ DATETIME ที่ MySQL คืนมาเป็น string ตรงๆ (ไม่ auto-convert เป็น
  // JS Date ตาม timezone ของเครื่อง) ลดโอกาสงงเรื่อง timezone ตอน
  // ย้ายจาก timestamptz ของ Postgres มา — ถ้า route ไหนอยาก format เอง
  // ค่อยจัดการเองในโค้ด
  dateStrings: true,
  namedPlaceholders: true,
});

/**
 * รัน query ธรรมดานอก transaction (ใช้กับ SELECT/INSERT/UPDATE/DELETE
 * เดี่ยวๆ ที่ไม่ต้องผูกกับ statement อื่น)
 *
 * ตัวอย่าง:
 *   const [rows] = await query("SELECT * FROM teachers WHERE id = ?", [id]);
 *   const [result] = await query("UPDATE room_tags SET status=? WHERE id=?", ["available", id]);
 *   // result.affectedRows ใช้เช็คแทน .select().maybeSingle() ของ Supabase เดิม
 */
async function query(sql, params) {
  return pool.query(sql, params);
}

/**
 * ขอ connection เดี่ยวจาก pool มาใช้เอง — จำเป็นสำหรับ transaction
 * เพราะต้อง begin/commit/rollback บน connection เดียวกันตลอด (จะ
 * pool.query() เฉยๆ ไม่ได้ เพราะแต่ละ query อาจไปคนละ connection ใน
 * pool)
 *
 * อย่าลืม connection.release() ใน finally เสมอ ไม่งั้น pool จะโดนเบียด
 * connection จนหมดหลังใช้งานไปสักพัก
 */
async function getConnection() {
  return pool.getConnection();
}

/**
 * Helper สำหรับ multi-step insert/update ที่ต้องเป็น transaction จริง
 * (ตามข้อ 9 ใน MANIFEST — เช่น tap.js สร้างครูใหม่ + insert
 * teacher_tags, หรือ admin_rooms.js insert หลายรูปพร้อมกัน)
 *
 * ใช้แบบนี้:
 *   const result = await withTransaction(async (conn) => {
 *     const [r1] = await conn.query("INSERT INTO teachers (...) VALUES (...)", [...]);
 *     await conn.query("INSERT INTO teacher_tags (...) VALUES (...)", [r1.insertId, ...]);
 *     return r1.insertId;
 *   });
 *
 * ถ้า callback throw เมื่อไหร่ จะ rollback ให้อัตโนมัติแล้ว throw
 * error เดิมต่อ (route ข้างนอกจับ error แล้วตอบ { ok: false, ... } ตาม
 * pattern เดิมได้เลย) ถ้าสำเร็จจะ commit ให้แล้ว release connection คืน
 * pool เสมอไม่ว่าจะ error หรือไม่
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
      // ไม่ throw ทับ error เดิม แค่ log ไว้เฉยๆ
      console.error("Rollback failed:", rollbackErr);
    }
    throw err;
  } finally {
    connection.release();
  }
}

module.exports = { pool, query, getConnection, withTransaction };