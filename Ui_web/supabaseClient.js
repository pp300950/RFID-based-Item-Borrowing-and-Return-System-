// config/supabaseClient.js
// -----------------------------------------------------------------
// ไฟล์นี้ไม่มีคีย์ลับอยู่ในตัวเอง แค่ "อ่านค่า" มาจากไฟล์ .env
// (ดูวิธีหาคีย์จริงได้ในไฟล์ .env.example)
// -----------------------------------------------------------------

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "⚠️  ยังไม่ได้ตั้งค่า SUPABASE_URL หรือ SUPABASE_SERVICE_ROLE_KEY\n" +
    "   ระบบจะยังรันได้ แต่ทุก request ที่ต้องใช้ฐานข้อมูลจะ error\n" +
    "   ดูวิธีตั้งค่าได้ในไฟล์ .env.example"
  );
}

// ใช้ service_role key เพราะไฟล์นี้ทำงานอยู่ฝั่ง server เท่านั้น
// (ห้ามเอา client ตัวนี้ไปยัดใส่โค้ดฝั่ง browser เด็ดขาด)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

module.exports = supabase;
