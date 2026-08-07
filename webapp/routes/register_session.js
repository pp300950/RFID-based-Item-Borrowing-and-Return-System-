// routes/register_session.js
// -----------------------------------------------------------------
// เก็บ "pending registration session" ชั่วคราวใน memory (แยกต่างหาก
// จาก activeSessions ของ flow ยืม-คืนใน tap.js โดยตั้งใจ — คนละ
// concept กัน: อันนี้คือ "ครูคนนี้กำลังกรอกฟอร์มสมัครอยู่ รอแตะบัตร
// เพื่อผูก tag_uid ให้" ไม่ใช่ "ครูคนนี้ล็อกอินแล้วกำลังยืม/คืนกุญแจ"
//
// ทำไมต้องแยกไฟล์ออกมาต่างหาก (ไม่ยัดรวมใน tap.js หรือ auth.js):
//   ทั้ง auth.js (เปิด/ปิด session ตอนกรอกฟอร์ม) และ tap.js (เช็คว่า
//   readerId นี้มีคนรอแตะบัตรสมัครอยู่ไหม ตอนเครื่องอ่านยิง POST
//   เข้ามา) ต้องมองเห็น state เดียวกัน จึงต้องแยกเป็น module กลาง
//   ให้ทั้งคู่ require เข้าไปใช้ แทนที่จะให้ไฟล์นึง require อีกไฟล์นึง
//   ตรงๆ (ป้องกัน circular require ระหว่าง tap.js <-> auth.js)
//
// สำคัญ: readerId ต้องเป็นตัวเดียวกับที่ฝั่ง tap.js ใช้ ("default" ถ้า
// ไม่ส่งมา) เพราะเครื่องอ่านจริงมีเครื่องเดียวที่ห้องทะเบียน ใช้ทั้ง
// สแกนยืม-คืนและสแกนตอนสมัครครู
// -----------------------------------------------------------------

const REGISTER_SESSION_TTL_MS = 60 * 1000; // 60 วินาที ให้เวลาเดินไปแตะบัตรที่เครื่องอ่าน

// key: readerId (string) -> { name, department, expiresAt, result }
// result: null ระหว่างรอ, หรือ { ok, tagUid, teacher } / { ok:false, message } หลังแตะแล้ว
const pendingRegistrations = new Map();

function startRegistration(readerId, name, department) {
  const reader = readerId || "default";
  pendingRegistrations.set(reader, {
    name,
    department: department || null,
    expiresAt: Date.now() + REGISTER_SESSION_TTL_MS,
    result: null, // ยังไม่มีการแตะบัตรเข้ามา
  });
  return reader;
}

// เรียกจาก tap.js เมื่อเช็คแล้วว่า readerId นี้กำลังรอสมัครอยู่ และแท็ก
// ที่แตะเข้ามาไม่รู้จักในระบบเลย (ไม่ใช่ทั้งบัตรครูเดิมและแท็กกุญแจ)
function getPendingRegistration(readerId) {
  const reader = readerId || "default";
  const pending = pendingRegistrations.get(reader);
  if (!pending) return null;
  if (Date.now() > pending.expiresAt) {
    pendingRegistrations.delete(reader);
    return null;
  }
  return pending;
}

// tap.js เรียกหลังผูก tag_uid สำเร็จ เพื่อฝากผลลัพธ์ไว้ให้หน้าเว็บที่
// กำลัง poll อยู่เห็นว่าสำเร็จแล้ว (แล้วค่อยลบ session ทิ้งหลัง poll เจอ)
function resolveRegistration(readerId, result) {
  const reader = readerId || "default";
  const pending = pendingRegistrations.get(reader);
  if (!pending) return false;
  pending.result = result;
  return true;
}

// auth.js เรียกตอน poll — คืนสถานะปัจจุบัน ไม่ลบทิ้งจนกว่าจะเจอผลลัพธ์
// (ป้องกันกรณี poll เร็วเกินไปแล้วพลาด event ตอนแตะบัตรพอดี)
function pollRegistration(readerId) {
  const reader = readerId || "default";
  const pending = getPendingRegistration(reader);
  if (!pending) {
    return { active: false };
  }
  if (pending.result) {
    // มีผลลัพธ์แล้ว (สำเร็จหรือ error) -> ส่งให้หน้าเว็บ แล้วเคลียร์ session ทิ้ง
    pendingRegistrations.delete(reader);
    return { active: false, result: pending.result };
  }
  return {
    active: true,
    name: pending.name,
    department: pending.department,
    expiresInMs: pending.expiresAt - Date.now(),
  };
}

function clearRegistration(readerId) {
  const reader = readerId || "default";
  pendingRegistrations.delete(reader);
}

module.exports = {
  startRegistration,
  getPendingRegistration,
  resolveRegistration,
  pollRegistration,
  clearRegistration,
  REGISTER_SESSION_TTL_MS,
};
