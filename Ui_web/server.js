// server.js
require("dotenv").config();
const express = require("express");
const path = require("path");
const authRoutes = require("./routes/auth");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use("/api", authRoutes);

// เวอร์ชันทดสอบตอนนี้มีแค่หน้าเข้าสู่ระบบ/สมัครใช้งาน
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.listen(PORT, () => {
  console.log(`✅ Server กำลังรันอยู่ที่ http://localhost:${PORT}`);
});
