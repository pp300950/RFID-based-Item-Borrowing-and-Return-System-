// public/js/login.js
// -----------------------------------------------------------------
// *** เปลี่ยนใหญ่: ตัด teacher login/register แบบกรอกรหัสครูออกทั้งหมด ***
// ครูไม่ login ผ่านเว็บอีกต่อไป — เหลือแค่:
//   1. "สมัครครูใหม่" — กรอกชื่อ-แผนก แล้วไปแตะบัตรที่เครื่องอ่าน
//      (POST /api/register/teacher/start -> poll GET /api/register/teacher/session)
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
  return { ok: res.ok, data };
}

async function getJSON(url) {
  const res = await fetch(url);
  const data = await res.json();
  return { ok: res.ok, data };
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
// สมัครครูใหม่ — แตะบัตรที่เครื่องอ่าน (polling flow)
// =================================================================

const READER_ID = "default"; // เครื่องอ่านมีเครื่องเดียวตอนนี้

const formRegister = document.getElementById("form-teacher-register");
const stepForm = document.querySelector('[data-register-step="form"]');
const stepWaiting = document.getElementById("register-waiting");
const countdownEl = document.getElementById("waiting-countdown");
const btnCancel = document.getElementById("btn-cancel-register");

let pollTimer = null;

function showRegisterStep(step) {
  stepForm.classList.toggle("is-active", step === "form");
  stepWaiting.classList.toggle("is-active", step === "waiting");
}

function stopPolling() {
  clearTimeout(pollTimer);
  pollTimer = null;
}

function currentName() {
  return document.getElementById("tr-name").value.trim();
}

formRegister.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearStatus();

  const name = currentName();
  const department = document.getElementById("tr-department").value.trim();

  if (!name) {
    showStatus("⚠️ กรุณากรอกชื่อ-นามสกุล", "error");
    return;
  }

  const submitBtn = formRegister.querySelector(".submit-btn");
  submitBtn.disabled = true;

  try {
    const { ok, data } = await postJSON("/api/register/teacher/start", {
      name,
      department,
      readerId: READER_ID,
    });

    if (!ok || !data.ok) {
      showStatus(`⚠️ ${data.message || "เริ่มสมัครไม่สำเร็จ"}`, "error");
      return;
    }

    showRegisterStep("waiting");
    startPolling();
  } catch (err) {
    showStatus("⚠️ เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง", "error");
  } finally {
    submitBtn.disabled = false;
  }
});

function startPolling() {
  stopPolling();
  pollOnce();
}

async function pollOnce() {
  try {
    const { ok, data } = await getJSON(
      `/api/register/teacher/session?readerId=${encodeURIComponent(READER_ID)}`
    );

    if (!ok || !data.ok) {
      finishRegisterFlow(false, "⚠️ ตรวจสอบสถานะไม่สำเร็จ ลองใหม่อีกครั้ง");
      return;
    }

    if (data.active) {
      // ยังรออยู่ — อัปเดต countdown แล้ว poll ต่อ
      const seconds = Math.max(0, Math.ceil((data.expiresInMs || 0) / 1000));
      countdownEl.textContent = seconds;
      pollTimer = setTimeout(pollOnce, 1500);
      return;
    }

    // active: false -> จบแล้ว ไม่ว่าจะสำเร็จ error หรือ timeout
    if (data.result && data.result.ok) {
      const teacherName = data.result.teacher ? data.result.teacher.name : currentName();
      finishRegisterFlow(true, `✅ สมัครสำเร็จ: ${teacherName}`);
    } else if (data.result && !data.result.ok) {
      finishRegisterFlow(false, `⚠️ ${data.result.message || "แตะบัตรไม่สำเร็จ"}`);
    } else {
      finishRegisterFlow(false, "⚠️ หมดเวลารอแตะบัตร กรุณาลองใหม่อีกครั้ง");
    }
  } catch (err) {
    // เครือข่ายมีปัญหาชั่วคราวระหว่าง poll — ลองใหม่แทนที่จะเลิกทันที
    pollTimer = setTimeout(pollOnce, 2000);
  }
}

function finishRegisterFlow(success, message) {
  stopPolling();
  showRegisterStep("form");
  showStatus(message, success ? "ok" : "error");
  if (success) {
    formRegister.reset();
  }
}

btnCancel.addEventListener("click", async () => {
  stopPolling();
  showRegisterStep("form");
  clearStatus();
  try {
    await postJSON("/api/register/teacher/cancel", { readerId: READER_ID });
  } catch (err) {
    // ไม่ต้องแจ้ง error ตอนยกเลิก — เจตนาของผู้ใช้คือออกจากหน้ารอแล้ว
  }
});