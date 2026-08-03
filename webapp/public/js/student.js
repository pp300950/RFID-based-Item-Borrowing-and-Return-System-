// public/js/student.js
// -----------------------------------------------------------------
// หน้านักเรียน: ดูรายการของทั้งหมด + ขอยืม/ขอคืน + ดูสถานะคำขอของตัวเอง
//   GET  /api/items
//   GET  /api/transactions/pending  (backend กรองเฉพาะของตัวเองให้ role นักเรียน)
//   POST /api/borrow   { roomItemId }
//   POST /api/return   { roomItemId }
//   POST /api/transactions/:id/cancel
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
const apiPost = (url, body) => apiFetch(url, { method: "POST", body: JSON.stringify(body || {}) });

// -------------------------------------------------------------
// Toast
// -------------------------------------------------------------
const toastEl = document.getElementById("toast");
let toastTimer = null;

function showToast(message, type) {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.className = "student-toast is-visible " + (type === "ok" ? "ok" : "error");
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
    userMetaEl.textContent = "นักเรียน";
  }
}

document.getElementById("logout-btn").addEventListener("click", () => {
  localStorage.removeItem(TOKEN_KEY);
  goToLogin();
});

// =================================================================
// คำขอที่รออนุมัติ (ของตัวเอง)
// =================================================================

const pendingBlockEl = document.getElementById("pending-block");
const pendingStripEl = document.getElementById("pending-strip");

let myPendingItemIds = new Set(); // itemId -> มีคำขอ pending ของตัวเองค้างอยู่
let myPendingByItemId = new Map(); // itemId -> transactionId (ใช้ตอนกดยกเลิกจากการ์ดของ)

async function loadMyPending() {
  const { ok, data } = await apiGet("/api/transactions/pending");

  myPendingItemIds = new Set();
  myPendingByItemId = new Map();

  if (!ok) {
    pendingBlockEl.style.display = "none";
    return;
  }

  const mine = data.transactions || []; // backend กรองมาเฉพาะของนักเรียนคนนี้อยู่แล้ว

  mine.forEach((t) => {
    if (t.room_item_id) {
      myPendingItemIds.add(String(t.room_item_id));
      myPendingByItemId.set(String(t.room_item_id), t.id);
    }
  });

  if (mine.length === 0) {
    pendingBlockEl.style.display = "none";
    return;
  }

  pendingBlockEl.style.display = "";
  renderPendingStrip(mine);
}

function renderPendingStrip(transactions) {
  pendingStripEl.innerHTML = transactions
    .map((t) => {
      const item = t.room_items || {};
      const roomName = item.room_tags ? item.room_tags.room_name : "—";
      const isBorrowAction = t.action === "borrow";

      return `
        <div class="pending-card" data-txn-id="${t.id}">
          <div class="pending-info">
            <span class="pending-dot" aria-hidden="true"></span>
            <div class="pending-text">
              <div class="pending-item-name">${escapeHtml(item.item_name || "—")}</div>
              <div class="pending-meta">ห้อง ${escapeHtml(roomName)}</div>
            </div>
          </div>
          <span class="pending-action-label">${isBorrowAction ? "รออนุมัติการยืม" : "รออนุมัติการคืน"}</span>
          <button class="btn btn--cancel" data-action="cancel" data-txn-id="${t.id}">ยกเลิก</button>
        </div>
      `;
    })
    .join("");
}

pendingStripEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action='cancel']");
  if (!btn) return;

  const txnId = btn.dataset.txnId;
  btn.disabled = true;

  const { ok, data } = await apiPost(`/api/transactions/${txnId}/cancel`);

  if (ok) {
    showToast("ยกเลิกคำขอแล้ว", "ok");
    await loadItems();
  } else {
    showToast(data.message || "ยกเลิกไม่สำเร็จ", "error");
    btn.disabled = false;
  }
});

// =================================================================
// รายการของทั้งหมด
// =================================================================

const itemsGridEl = document.getElementById("items-grid");
const searchInput = document.getElementById("search-input");
const statusFilter = document.getElementById("status-filter");

let allItems = [];

async function loadItems() {
  const { ok, data } = await apiGet("/api/items");

  if (!ok) {
    itemsGridEl.innerHTML = `<div class="empty-state">${escapeHtml(data.message || "โหลดรายการของไม่สำเร็จ")}</div>`;
    return;
  }

  allItems = data.items || [];
  await loadMyPending();
  renderItemsGrid();
}

function matchesFilters(item) {
  const q = searchInput.value.trim().toLowerCase();
  const statusVal = statusFilter.value;

  if (statusVal && item.status !== statusVal) return false;

  if (q) {
    const roomName = item.room_tags ? item.room_tags.room_name : "";
    const haystack = `${item.item_name} ${roomName}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }

  return true;
}

function renderItemsGrid() {
  const filtered = allItems.filter(matchesFilters);

  if (filtered.length === 0) {
    itemsGridEl.innerHTML = `<div class="empty-state">ไม่พบของที่ตรงกับเงื่อนไข</div>`;
    return;
  }

  itemsGridEl.innerHTML = filtered.map(renderItemCard).join("");
}

function renderItemCard(item) {
  const roomName = item.room_tags ? item.room_tags.room_name : "—";
  const isBorrowed = item.status === "borrowed";
  const hasMyPending = myPendingItemIds.has(String(item.id));

  const isMineBorrowed =
    isBorrowed &&
    item.borrowed_by_type === "student" &&
    currentUser &&
    item.borrowed_by_student_id === currentUser.id;

  let pillClass = "pill--available";
  let pillLabel = "ว่าง";
  if (isBorrowed) {
    pillClass = isMineBorrowed ? "pill--mine" : "pill--borrowed";
    pillLabel = isMineBorrowed ? "คุณยืมอยู่" : "ถูกยืมอยู่";
  }

  let actionHtml;

  if (hasMyPending) {
    const txnId = myPendingByItemId.get(String(item.id));
    actionHtml = `
      <div class="item-card-action">
        <button class="btn btn--disabled-state" disabled>รออนุมัติ...</button>
        <button class="btn btn--cancel" data-action="cancel" data-txn-id="${txnId}" style="margin-top: 6px;">ยกเลิกคำขอ</button>
      </div>
    `;
  } else if (!isBorrowed) {
    actionHtml = `
      <div class="item-card-action">
        <button class="btn btn--borrow" data-action="borrow" data-item-id="${item.id}">ขอยืม</button>
      </div>
    `;
  } else if (isMineBorrowed) {
    actionHtml = `
      <div class="item-card-action">
        <button class="btn btn--return" data-action="return" data-item-id="${item.id}">ขอคืน</button>
      </div>
    `;
  } else {
    actionHtml = `
      <div class="item-card-action">
        <button class="btn btn--disabled-state" disabled>ถูกยืมอยู่</button>
      </div>
    `;
  }

  return `
    <div class="item-card" data-item-id="${item.id}">
      <div class="item-card-top">
        <div>
          <div class="item-name">${escapeHtml(item.item_name)}</div>
          <div class="item-room">ห้อง ${escapeHtml(roomName)}</div>
        </div>
        <span class="pill ${pillClass}">${pillLabel}</span>
      </div>
      ${actionHtml}
    </div>
  `;
}

searchInput.addEventListener("input", renderItemsGrid);
statusFilter.addEventListener("change", renderItemsGrid);

itemsGridEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const action = btn.dataset.action;

  if (action === "borrow" || action === "return") {
    const itemId = btn.dataset.itemId;
    btn.disabled = true;

    const endpoint = action === "borrow" ? "/api/borrow" : "/api/return";
    const { ok, data } = await apiPost(endpoint, { roomItemId: itemId });

    if (ok) {
      showToast(action === "borrow" ? "ส่งคำขอยืมแล้ว รอครูอนุมัติ" : "ส่งคำขอคืนแล้ว รอครูอนุมัติ", "ok");
      await loadItems();
    } else {
      showToast(data.message || "ดำเนินการไม่สำเร็จ", "error");
      btn.disabled = false;
    }
    return;
  }

  if (action === "cancel") {
    const txnId = btn.dataset.txnId;
    btn.disabled = true;

    const { ok, data } = await apiPost(`/api/transactions/${txnId}/cancel`);

    if (ok) {
      showToast("ยกเลิกคำขอแล้ว", "ok");
      await loadItems();
    } else {
      showToast(data.message || "ยกเลิกไม่สำเร็จ", "error");
      btn.disabled = false;
    }
  }
});

// =================================================================
// Init
// =================================================================

(async function init() {
  if (!getToken()) {
    goToLogin();
    return;
  }
  initUserBlock();
  await loadItems();
})();
