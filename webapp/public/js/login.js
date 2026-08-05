// public/js/login.js

const statusMsg = document.getElementById("status-msg");

const roleButtons = document.querySelectorAll(".role-btn");
const rolePanels = document.querySelectorAll(".role-panel");

const modeButtons = document.querySelectorAll(".mode-btn");

// -------------------------------------------------------------
// สลับบทบาท (ครู / แอดมิน)
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
// สลับโหมด (เข้าสู่ระบบ / สร้างบัญชี) ภายในแต่ละบทบาท
// -------------------------------------------------------------
function switchMode(panel, mode) {
  const modeBtns = panel.querySelectorAll(".mode-btn");
  const modeForms = panel.querySelectorAll(".mode-form");

  modeBtns.forEach((btn) => {
    const isTarget = btn.dataset.mode === mode;
    btn.classList.toggle("is-active", isTarget);
    btn.setAttribute("aria-selected", isTarget);
  });

  modeForms.forEach((form) => {
    form.classList.toggle("is-active", form.dataset.modeForm === mode);
  });

  clearStatus();
}

modeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const panel = btn.closest(".role-panel");
    switchMode(panel, btn.dataset.mode);
  });
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
  return { ok: res.ok, data };
}

// -------------------------------------------------------------
// ตัวช่วยผูกฟอร์ม submit -> เรียก API -> โชว์สถานะ
// -------------------------------------------------------------
function bindForm(formId, { buildPayload, endpoint, onSuccess }) {
  const form = document.getElementById(formId);
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearStatus();

    const payload = buildPayload(form);
    const submitBtn = form.querySelector(".submit-btn");
    submitBtn.disabled = true;

    try {
      const { ok, data } = await postJSON(endpoint, payload);

      if (ok && data.ok) {
        onSuccess(data);
      } else {
        showStatus(`⚠️ ${data.message || "ดำเนินการไม่สำเร็จ"}`, "error");
      }
    } catch (err) {
      showStatus("⚠️ เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง", "error");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// -------------------------------------------------------------
// เก็บ token + ข้อมูลผู้ใช้ แล้วพาไปหน้าที่ตรงกับบทบาท
// -------------------------------------------------------------
const TOKEN_KEY = "token";
const REDIRECT_DELAY_MS = 600; // เผื่อเวลาให้เห็นข้อความสำเร็จก่อนเด้งหน้า

function completeLogin(data, redirectTo) {
  if (data.token) {
    localStorage.setItem(TOKEN_KEY, data.token);
  }
  setTimeout(() => {
    window.location.href = redirectTo;
  }, REDIRECT_DELAY_MS);
}

// --- ครู: เข้าสู่ระบบ ---
bindForm("form-teacher-login", {
  endpoint: "/api/login/teacher",
  buildPayload: (form) => ({
    teacherCode: form.querySelector("#tl-code").value.trim(),
  }),
  onSuccess: (data) => {
    showStatus(`✅ เข้าสู่ระบบสำเร็จ: ${data.teacher.name}`, "ok");
    completeLogin(data, "/teacher.html");
  },
});

// --- ครู: สร้างบัญชี ---
bindForm("form-teacher-register", {
  endpoint: "/api/register/teacher",
  buildPayload: (form) => ({
    name: form.querySelector("#tr-name").value.trim(),
    department: form.querySelector("#tr-department").value.trim(),
    teacherCode: form.querySelector("#tr-code").value.trim(),
  }),
  onSuccess: (data) => {
    showStatus(`✅ สร้างบัญชีสำเร็จ: ${data.teacher.name} — ไปที่แท็บเข้าสู่ระบบได้เลย`, "ok");
  },
});

// --- แอดมิน ---
bindForm("form-admin", {
  endpoint: "/api/login/admin",
  buildPayload: (form) => ({
    username: form.querySelector("#a-username").value.trim(),
    password: form.querySelector("#a-password").value,
  }),
  onSuccess: (data) => {
    showStatus("✅ เข้าสู่ระบบแอดมินสำเร็จ", "ok");
    completeLogin(data, "/admin.html");
  },
});
