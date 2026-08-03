// public/js/login.js

const tabStudent = document.getElementById("tab-student");
const tabAdmin = document.getElementById("tab-admin");
const formStudent = document.getElementById("form-student");
const formAdmin = document.getElementById("form-admin");
const statusMsg = document.getElementById("status-msg");

function switchTab(target) {
  const isStudent = target === "student";

  tabStudent.classList.toggle("is-active", isStudent);
  tabAdmin.classList.toggle("is-active", !isStudent);
  tabStudent.setAttribute("aria-selected", isStudent);
  tabAdmin.setAttribute("aria-selected", !isStudent);

  formStudent.classList.toggle("is-hidden", !isStudent);
  formAdmin.classList.toggle("is-hidden", isStudent);

  clearStatus();
}

tabStudent.addEventListener("click", () => switchTab("student"));
tabAdmin.addEventListener("click", () => switchTab("admin"));

function showStatus(message, type) {
  statusMsg.textContent = message;
  statusMsg.className = "status-msg " + (type === "ok" ? "ok" : "error");
}

function clearStatus() {
  statusMsg.textContent = "";
  statusMsg.className = "status-msg";
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { ok: res.ok, data };
}

// --- ฟอร์มนักเรียน ---
formStudent.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearStatus();

  const payload = {
    name: document.getElementById("s-name").value.trim(),
    room: document.getElementById("s-room").value.trim(),
    seatNo: document.getElementById("s-seat").value.trim(),
    studentCode: document.getElementById("s-code").value.trim(),
  };

  const submitBtn = formStudent.querySelector(".submit-btn");
  submitBtn.disabled = true;

  try {
    const { ok, data } = await postJSON("/api/login/student", payload);

    if (ok && data.ok) {
      const label = data.mode === "register" ? "สร้างบัญชีใหม่และเข้าสู่ระบบสำเร็จ" : "เข้าสู่ระบบสำเร็จ";
      showStatus(`✅ ${label}: ${data.student.name}`, "ok");
      // TODO: เมื่อมีหน้าโปรไฟล์นักเรียนแล้ว ให้ redirect ไปที่นั่นต่อ
    } else {
      showStatus(`⚠️ ${data.message || "เข้าสู่ระบบไม่สำเร็จ"}`, "error");
    }
  } catch (err) {
    showStatus("⚠️ เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง", "error");
  } finally {
    submitBtn.disabled = false;
  }
});

// --- ฟอร์มแอดมิน ---
formAdmin.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearStatus();

  const payload = {
    username: document.getElementById("a-username").value.trim(),
    password: document.getElementById("a-password").value,
  };

  const submitBtn = formAdmin.querySelector(".submit-btn");
  submitBtn.disabled = true;

  try {
    const { ok, data } = await postJSON("/api/login/admin", payload);

    if (ok && data.ok) {
      showStatus("✅ เข้าสู่ระบบแอดมินสำเร็จ", "ok");
      // TODO: เมื่อมีหน้า admin/dashboard แล้ว ให้ redirect ไปที่นั่นต่อ
    } else {
      showStatus(`⚠️ ${data.message || "เข้าสู่ระบบไม่สำเร็จ"}`, "error");
    }
  } catch (err) {
    showStatus("⚠️ เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง", "error");
  } finally {
    submitBtn.disabled = false;
  }
});
