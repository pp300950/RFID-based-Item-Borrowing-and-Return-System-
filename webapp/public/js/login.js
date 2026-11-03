// public/js/login.js
// -----------------------------------------------------------------
// ครูไม่ login ผ่านเว็บ — เหลือแค่:
//   1. "สมัครครูใหม่" — กรอกชื่อ-แผนก(ไม่บังคับ)-รหัสประจำตัว แล้วเสร็จทันที
//      (POST /api/register/teacher) ไม่มีขั้นรอแตะบัตรอีกต่อไป
//   2. แอดมิน login เดิม ไม่เปลี่ยน
// -----------------------------------------------------------------

const statusMsg = document.getElementById("status-msg");

const roleButtons = document.querySelectorAll(".role-btn");
const rolePanels = document.querySelectorAll(".role-panel");

// -------------------------------------------------------------
// สลับบทบาท (สมัครครูใหม่ / แอดมิน)
// -------------------------------------------------------------
function switchRole(role) {
  roleButtons.forEach((btn) => {
    const isTarget = btn.dataset.role === role;
    btn.classList.toggle("is-active", isTarget);
    btn.setAttribute("aria-selected", isTarget);
  });

  rolePanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.rolePanel === role);
  });

  clearStatus();
}

roleButtons.forEach((btn) => {
  btn.addEventListener("click", () => switchRole(btn.dataset.role));
});

// -------------------------------------------------------------
// ข้อความสถานะ
// -------------------------------------------------------------
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
  return { ok: res.ok, status: res.status, data };
}

// -------------------------------------------------------------
// เก็บ token แอดมิน แล้วพาไปหน้าแอดมิน
// -------------------------------------------------------------
const TOKEN_KEY = "token";
const REDIRECT_DELAY_MS = 600;

function completeAdminLogin(data) {
  if (data.token) {
    localStorage.setItem(TOKEN_KEY, data.token);
  }
  setTimeout(() => {
    window.location.href = "/admin.html";
  }, REDIRECT_DELAY_MS);
}

// --- แอดมิน ---
document.getElementById("form-admin").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearStatus();

  const form = e.target;
  const submitBtn = form.querySelector(".submit-btn");
  submitBtn.disabled = true;

  try {
    const { ok, data } = await postJSON("/api/login/admin", {
      username: form.querySelector("#a-username").value.trim(),
      password: form.querySelector("#a-password").value,
    });

    if (ok && data.ok) {
      showStatus("✅ เข้าสู่ระบบแอดมินสำเร็จ", "ok");
      completeAdminLogin(data);
    } else {
      showStatus(`⚠️ ${data.message || "เข้าสู่ระบบไม่สำเร็จ"}`, "error");
    }
  } catch (err) {
    showStatus("⚠️ เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง", "error");
  } finally {
    submitBtn.disabled = false;
  }
});

// =================================================================
// สมัครครูใหม่ — กรอกชื่อ/แผนก/รหัสประจำตัว แล้วเสร็จในครั้งเดียว
// =================================================================

const formRegister = document.getElementById("form-teacher-register");
const codeInput = document.getElementById("tr-code");

// รหัสต้องเป็นตัวเลขล้วน — ตัดตัวอักษรอื่นทิ้งทันทีที่พิมพ์/วาง
codeInput.addEventListener("input", () => {
  codeInput.value = codeInput.value.replace(/\D/g, "");
});

formRegister.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearStatus();

  const name = document.getElementById("tr-name").value.trim();
  const department = document.getElementById("tr-department").value.trim();
  const teacherCode = codeInput.value.trim();

  if (!name) {
    showStatus("⚠️ กรุณากรอกชื่อ-นามสกุล", "error");
    return;
  }
  if (!teacherCode) {
    showStatus("⚠️ กรุณากรอกรหัสประจำตัว", "error");
    codeInput.focus();
    return;
  }

  const submitBtn = formRegister.querySelector(".submit-btn");
  submitBtn.disabled = true;

  try {
    const { ok, status, data } = await postJSON("/api/register/teacher", {
      name,
      department,
      teacherCode,
    });

    if (ok && data.ok) {
      showStatus(`✅ สมัครสำเร็จ: ${name}`, "ok");
      formRegister.reset();
    } else {
      showStatus(`⚠️ ${data.message || "สมัครไม่สำเร็จ"}`, "error");
      // รหัสซ้ำ (409) — ให้ตั้งรหัสใหม่ได้ทันที
      if (status === 409) {
        codeInput.focus();
        codeInput.select();
      }
    }
  } catch (err) {
    showStatus("⚠️ เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง", "error");
  } finally {
    submitBtn.disabled = false;
  }
});