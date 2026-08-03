// public/js/teacher.js
// -----------------------------------------------------------------
// หน้าครู: รวม 2 อย่างในหน้าเดียว
//   1. คิวอนุมัติ — GET /api/transactions/pending (backend กรองมาให้
//      เฉพาะห้องที่ครูคนนี้มีสิทธิ์ดูแลอยู่แล้ว ผ่าน teacher_room_assignments)
//      -> POST /api/transactions/:id/approve หรือ /reject
//   2. รายการของทั้งหมด — ยืม/คืนของตัวเองได้เหมือนนักเรียน
//      GET /api/items, POST /api/borrow, POST /api/return,
//      POST /api/transactions/:id/cancel (ยกเลิกคำขอของตัวเอง)
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
// SECTION 1 — คิวอนุมัติ
// =================================================================

const approvalQueueEl = document.getElementById("approval-queue");

async function loadApprovalQueue() {
  const { ok, data } = await apiGet("/api/transactions/pending");

  if (!ok) {
    approvalQueueEl.innerHTML = `<div class="empty-state empty-state--queue">${escapeHtml(
      data.message || "โหลดรายการที่รออนุมัติไม่สำเร็จ"
    )}</div>`;
    return;
  }

  renderApprovalQueue(data.transactions || []);
}

function renderApprovalQueue(transactions) {
  if (transactions.length === 0) {
    approvalQueueEl.innerHTML = `<div class="empty-state empty-state--queue">ไม่มีคำขอรออนุมัติในห้องที่คุณดูแลอยู่ตอนนี้</div>`;
    return;
  }

  approvalQueueEl.innerHTML = transactions
    .map((t) => {
      const item = t.room_items || {};
      const roomName = item.room_tags ? item.room_tags.room_name : "—";
      const isBorrowAction = t.action === "borrow";

      const requester =
        t.requested_by_type === "student"
          ? t.requested_by_student
          : t.requested_by_teacher;

      const requesterName = requester ? requester.name : "—";
      const requesterExtra =
        t.requested_by_type === "student" && requester
          ? ` · ห้อง ${escapeHtml(requester.room || "—")} เลขที่ ${escapeHtml(requester.seat_no || "—")}`
          : t.requested_by_type === "teacher" && requester && requester.department
          ? ` · ${escapeHtml(requester.department)}`
          : "";

      return `
        <div class="approval-card" data-txn-id="${t.id}">
          <div class="approval-info">
            <span class="approval-dot" aria-hidden="true"></span>
            <div class="approval-text">
              <div class="approval-item-name">
                <span class="approval-action-label">${isBorrowAction ? "ขอยืม" : "ขอคืน"}</span>
                ${escapeHtml(item.item_name || "—")}
              </div>
              <div class="approval-meta">ห้อง ${escapeHtml(roomName)} · ผู้ขอ: ${escapeHtml(requesterName)}${requesterExtra}</div>
            </div>
          </div>
          <div class="approval-buttons">
            <button class="btn btn--approve" data-action="approve" data-id="${t.id}">อนุมัติ</button>
            <button class="btn btn--reject" data-action="reject" data-id="${t.id}">ปฏิเสธ</button>
          </div>
        </div>
      `;
    })
    .join("");
}

approvalQueueEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const action = btn.dataset.action; // "approve" | "reject"
  const txnId = btn.dataset.id;
  const card = btn.closest(".approval-card");
  const buttons = card.querySelectorAll("button");

  buttons.forEach((b) => (b.disabled = true));

  const { ok, data } = await apiPost(`/api/transactions/${txnId}/${action}`);

  if (ok) {
    showToast(action === "approve" ? "อนุมัติคำขอแล้ว" : "ปฏิเสธคำขอแล้ว", "ok");
    await loadApprovalQueue();
    await loadItems();
  } else {
    showToast(data.message || "ดำเนินการไม่สำเร็จ", "error");
    buttons.forEach((b) => (b.disabled = false));
  }
});

// =================================================================
// SECTION 2 — รายการของทั้งหมด (ยืม-คืนของตัวเอง)
// =================================================================

const itemsGridEl = document.getElementById("items-grid");
const searchInput = document.getElementById("search-input");
const statusFilter = document.getElementById("status-filter");

let allItems = [];
let myPendingItemIds = new Set(); // ของที่ตัวเองมีคำขอ pending ค้างอยู่ (ไม่ว่า borrow/return)
let myPendingByItemId = new Map(); // itemId -> transactionId (ของตัวเอง) ใช้ตอนกดยกเลิก

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

// ครูก็เห็นเฉพาะคำขอของตัวเองใน /transactions/pending (แม้ backend จะกรอง
// ตามห้องที่ดูแลให้ในคิวอนุมัติด้านบน — แต่ endpoint เดียวกันนี้ใช้คนละ
// วัตถุประสงค์ จึงต้องกรองเฉพาะ requested_by_teacher_id ตรงกับตัวเองอีกชั้น
// เพื่อเอามาแสดงสถานะ "รออนุมัติ" บนการ์ดของที่ตัวเองขอไว้)
async function loadMyPending() {
  myPendingItemIds = new Set();
  myPendingByItemId = new Map();

  if (!currentUser) return;

  const { ok, data } = await apiGet("/api/transactions/pending");
  if (!ok) return;

  (data.transactions || []).forEach((t) => {
    const isMine = t.requested_by_type === "teacher" && t.requested_by_teacher_id === currentUser.id;
    if (isMine && t.room_item_id) {
      myPendingItemIds.add(String(t.room_item_id));
      myPendingByItemId.set(String(t.room_item_id), t.id);
    }
  });
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
    item.borrowed_by_type === "teacher" &&
    currentUser &&
    item.borrowed_by_teacher_id === currentUser.id;

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
  await loadApprovalQueue();
  await loadItems();
})();
