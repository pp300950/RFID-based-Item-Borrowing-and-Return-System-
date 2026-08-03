// server.js
require("dotenv").config();
const express = require("express");
const path = require("path");

const { requireAuth, requireRole } = require("./middleware/auth");

const authRoutes = require("./routes/auth");
const transactionRoutes = require("./routes/transactions");
const adminRoomsRoutes = require("./routes/admin_rooms");
const adminItemsRoutes = require("./routes/admin_items");
const adminTeachersRoutes = require("./routes/admin_teachers");
const adminAssignmentsRoutes = require("./routes/admin_assignments");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// -------------------------------------------------------------
// /api/* — login/register นักเรียน/ครู/แอดมิน (เปิดสาธารณะ ไม่ต้อง login
// ก่อนเข้าถึง เพราะเป็น endpoint สำหรับ login เอง)
// -------------------------------------------------------------
app.use("/api", authRoutes);

// -------------------------------------------------------------
// /api/* — flow ยืม-คืนของ (borrow/return/approve/reject/cancel)
// ต้อง login ก่อนเสมอ (นักเรียนและครูเข้าได้ทั้งคู่ — role gating ละเอียด
// กว่านั้นอยู่ในตัว route เอง เช่น approve ต้องเป็นครูเท่านั้น)
// -------------------------------------------------------------
app.use("/api", requireAuth, transactionRoutes);

// -------------------------------------------------------------
// /api/admin/* — เฉพาะแอดมินเท่านั้น (จุดเดียวที่ยืนยัน role ก่อนเข้าทุก
// route ย่อยด้วย requireRole("admin") — ไฟล์ route แต่ละไฟล์เองไม่ได้
// ใส่ middleware ซ้ำ ดูคอมเมนต์ในแต่ละไฟล์ admin_*.js ประกอบ)
// -------------------------------------------------------------
app.use(
  "/api/admin",
  requireAuth,
  requireRole("admin"),
  adminRoomsRoutes,
  adminItemsRoutes,
  adminTeachersRoutes,
  adminAssignmentsRoutes
);

// หน้าแรก: ยังเป็นหน้า login/register ตามเดิม
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.listen(PORT, () => {
  console.log(`✅ Server กำลังรันอยู่ที่ http://localhost:${PORT}`);
});