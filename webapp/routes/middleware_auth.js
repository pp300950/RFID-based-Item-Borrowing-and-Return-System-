// middleware/auth.js
// -----------------------------------------------------------------
// JWT ล้วนๆ ไม่มี session store ฝั่ง server (stateless) — token เก็บแค่
// { role, id, name } พอสำหรับทุก route ในระบบตอนนี้
//
// ทำไมออกแบบแบบนี้:
//   - นักเรียน/ครู login ผ่าน students.id / teachers.id ปกติ -> id เป็น
//     bigint จริงจากฐานข้อมูล
//   - แอดมิน ไม่มีแถวในฐานข้อมูล (เทียบกับ env var เท่านั้น) -> id เป็น
//     null เสมอ ใช้ role: "admin" อย่างเดียวเป็น identity
//
// ใช้ตามนี้ในไฟล์อื่น:
//   const { signToken, requireAuth, requireRole } = require("../middleware/auth");
//   router.get("/x", requireAuth, handler)
//   router.post("/y", requireAuth, requireRole("teacher"), handler)
//   router.delete("/z", requireAuth, requireRole("admin"), handler)
// -----------------------------------------------------------------

const jwt = require("jsonwebtoken");

// ต้องตั้งใน .env เสมอสำหรับ production — ค่า fallback นี้มีไว้กัน crash
// ตอน dev เฉยๆ ไม่ควรพึ่งค่า default นี้จริงจัง
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-insecure-secret-change-me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

if (!process.env.JWT_SECRET) {
  console.warn(
    "⚠️  ยังไม่ได้ตั้งค่า JWT_SECRET ใน .env — ใช้ค่า default ชั่วคราวซึ่งไม่ปลอดภัย\n" +
      "   กรุณาตั้งค่า JWT_SECRET เป็นข้อความสุ่มยาวๆ ก่อนใช้งานจริง"
  );
}

// -------------------------------------------------------------
// signToken({ role, id, name }) -> token string
// -------------------------------------------------------------
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// -------------------------------------------------------------
// requireAuth: ตรวจ Authorization: Bearer <token>
// ผ่านแล้วจะเซ็ต req.user = { role, id, name } ให้ route ถัดไปใช้ต่อ
// -------------------------------------------------------------
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({
      ok: false,
      message: "กรุณาเข้าสู่ระบบก่อนใช้งานส่วนนี้",
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { role: decoded.role, id: decoded.id, name: decoded.name };
    return next();
  } catch (err) {
    return res.status(401).json({
      ok: false,
      message: "เซสชันหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่อีกครั้ง",
    });
  }
}

// -------------------------------------------------------------
// requireRole("teacher") หรือ requireRole("admin", "teacher") เป็นต้น
// ต้องใช้ต่อจาก requireAuth เสมอ (พึ่ง req.user ที่ requireAuth เซ็ตไว้)
// -------------------------------------------------------------
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      // เผื่อลืมใส่ requireAuth ก่อนหน้า — กันพังแบบเงียบๆ
      return res.status(401).json({
        ok: false,
        message: "กรุณาเข้าสู่ระบบก่อนใช้งานส่วนนี้",
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        ok: false,
        message: "คุณไม่มีสิทธิ์เข้าถึงส่วนนี้",
      });
    }

    return next();
  };
}

module.exports = { signToken, requireAuth, requireRole };
