// public/js/teacher.js
// -----------------------------------------------------------------
// หน้าครู (เวอร์ชันใหม่ — read-only):
//   1. สถานะกุญแจทั้งหมด — GET /api/keys/status (ว่าง/ถูกยืม + ใครยืมอยู่)
//   2. ประวัติการยืม-คืนของตัวเอง — GET /api/keys/history/mine (50 ล่าสุด)
//
// ครูไม่ยืม-คืนผ่านเว็บอีกต่อไป — flow จริงคือแตะแท็กประจำตัวที่เครื่องอ่าน
// หน้าห้องทะเบียน แล้วแตะแท็กกุญแจ (ดู routes/tap.js ฝั่ง backend) หน้านี้
// จึงใช้แค่ "ดู" สถานะปัจจุบันเท่านั้น ไม่มีปุ่มยืม/คืน/อนุมัติใดๆ
//
// ใช้ JWT จาก localStorage คีย์ "token" เหมือนหน้าอื่นๆ ทั้งหมด
// ไม่ได้ใช้ framework ใดๆ — vanilla DOM + fetch
// -----------------------------------------------------------------

const TOKEN_KEY = "token";

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function getPayloadFromToken(token) {
  try {
    const base64 = token.split(".")[1];
    return JSON.parse(atob(base64.replace(/-/g, "+").replace(/_/g, "/")));
  } catch (e) {
    return null;
  }
}

function goToLogin() {
  window.location.href = "/";
}

// -------------------------------------------------------------
// apiFetch: ผู้ช่วยกลางสำหรับเรียก API ทุกจุดในหน้านี้
// -------------------------------------------------------------
async function apiFetch(url, options = {}) {
  const token = getToken();

  if (!token) {
    goToLogin();
    return { ok: false, status: 401, data: { ok: false, message: "กรุณาเข้าสู่ระบบ" } };
  }

  const headers = Object.assign(
    { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    options.headers || {}
  );

  let res;
  try {
    res = await fetch(url, Object.assign({}, options, { headers }));
  } catch (err) {
    return { ok: false, status: 0, data: { ok: false, message: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง" } };
  }

  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    goToLogin();
    return { ok: false, status: 401, data: { ok: false, message: "เซสชันหมดอายุ" } };
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    data = { ok: false, message: "เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง" };
  }

  return { ok: res.ok && data.ok, status: res.status, data };
}

const apiGet = (url) => apiFetch(url);

// -------------------------------------------------------------
// Toast
// -------------------------------------------------------------
const toastEl = document.getElementById("toast");
let toastTimer = null;

function showToast(message, type) {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.className = "teacher-toast is-visible " + (type === "ok" ? "ok" : "error");
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("is-visible");
  }, 3200);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDateTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("th-TH", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch (e) {
    return iso;
  }
}

// -------------------------------------------------------------
// ผู้ใช้ปัจจุบัน (ถอดจาก JWT payload: { role, id, name })
// -------------------------------------------------------------
const userNameEl = document.getElementById("user-name");
const userMetaEl = document.getElementById("user-meta");
let currentUser = null;

function initUserBlock() {
  const token = getToken();
  if (!token) return;
  currentUser = getPayloadFromToken(token);
  if (currentUser && currentUser.name) {
    userNameEl.textContent = currentUser.name;
    userMetaEl.textContent = "ครู";
  }
}

document.getElementById("logout-btn").addEventListener("click", () => {
  localStorage.removeItem(TOKEN_KEY);
  goToLogin();
});

// =================================================================
// SECTION 1 — สถานะกุญแจทั้งหมด
// =================================================================

const itemsGridEl = document.getElementById("items-grid");
const searchInput = document.getElementById("search-input");
const statusFilter = document.getElementById("status-filter");

let allKeys = [];

async function loadKeysStatus() {
  const { ok, data } = await apiGet("/api/keys/status");

  if (!ok) {
    itemsGridEl.innerHTML = `<div class="empty-state">${escapeHtml(data.message || "โหลดสถานะกุญแจไม่สำเร็จ")}</div>`;
    return;
  }

  allKeys = data.keys || [];
  renderItemsGrid();
}

function matchesFilters(key) {
  const q = searchInput.value.trim().toLowerCase();
  const statusVal = statusFilter.value;

  if (statusVal && key.status !== statusVal) return false;

  if (q) {
    const haystack = `${key.room_name} ${key.description || ""}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }

  return true;
}

function renderItemsGrid() {
  const filtered = allKeys.filter(matchesFilters);

  if (filtered.length === 0) {
    itemsGridEl.innerHTML = `<div class="empty-state">ไม่พบกุญแจที่ตรงกับเงื่อนไข</div>`;
    return;
  }

  itemsGridEl.innerHTML = filtered.map(renderItemCard).join("");
}

function renderItemCard(key) {
  const isBorrowed = key.status === "borrowed";
  const isMineBorrowed =
    isBorrowed && currentUser && key.borrowed_by && key.borrowed_by.id === currentUser.id;

  let pillClass = "pill--available";
  let pillLabel = "ว่าง";
  if (isBorrowed) {
    pillClass = isMineBorrowed ? "pill--mine" : "pill--borrowed";
    pillLabel = isMineBorrowed ? "คุณยืมอยู่" : "ถูกยืมอยู่";
  }

  const holderName = isBorrowed && key.borrowed_by ? key.borrowed_by.name : null;

  return `
    <div class="item-card" data-key-id="${key.id}">
      <div class="item-card-top">
        <div>
          <div class="item-name">${escapeHtml(key.room_name)}</div>
          ${key.description ? `<div class="item-room">${escapeHtml(key.description)}</div>` : ""}
        </div>
        <span class="pill ${pillClass}">${pillLabel}</span>
      </div>
      ${
        isBorrowed && holderName
          ? `<div class="item-card-meta">ยืมอยู่โดยคุณครู ${escapeHtml(holderName)}</div>`
          : ""
      }
    </div>
  `;
}

searchInput.addEventListener("input", renderItemsGrid);
statusFilter.addEventListener("change", renderItemsGrid);

// =================================================================
// SECTION 2 — ประวัติการยืม-คืนของฉัน
// =================================================================

const historyTbody = document.getElementById("history-tbody");

async function loadMyHistory() {
  const { ok, data } = await apiGet("/api/keys/history/mine");

  if (!ok) {
    historyTbody.innerHTML = `<tr class="row-empty"><td colspan="3">${escapeHtml(
      data.message || "โหลดประวัติไม่สำเร็จ"
    )}</td></tr>`;
    return;
  }

  renderHistoryTable(data.logs || []);
}

function renderHistoryTable(logs) {
  if (logs.length === 0) {
    historyTbody.innerHTML = `<tr class="row-empty"><td colspan="3">ยังไม่มีประวัติการยืม-คืน</td></tr>`;
    return;
  }

  historyTbody.innerHTML = logs
    .map((log) => {
      const roomName = log.room_tags ? log.room_tags.room_name : "—";
      const actionLabel = log.action === "borrow" ? "ยืม" : "คืน";
      const actionClass = log.action === "borrow" ? "pill--borrowed" : "pill--available";

      return `
        <tr>
          <td>${escapeHtml(roomName)}</td>
          <td><span class="pill ${actionClass}">${actionLabel}</span></td>
          <td>${escapeHtml(formatDateTime(log.acted_at))}</td>
        </tr>
      `;
    })
    .join("");
}

// =================================================================
// Init
// =================================================================

(async function init() {
  if (!getToken()) {
    goToLogin();
    return;
  }
  initUserBlock();
  await loadKeysStatus();
  await loadMyHistory();
})();