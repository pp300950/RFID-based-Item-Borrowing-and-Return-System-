// public/js/teacher.js
// -----------------------------------------------------------------
// หน้าสถานะกุญแจ (public, read-only, ไม่มี login) — ตามสถาปัตยกรรมใหม่
// (ดู README ข้อ 10 + routes/keys.js): ครูไม่ login ผ่านเว็บอีกต่อไป
// หน้านี้แค่ดึง GET /api/keys/status (public, ไม่มี JWT) มาแสดงเป็น
// การ์ดห้อง/กุญแจทั้งหมด พร้อมรูปภาพ + สถานะ + เวลาที่ถูกยืมไป
//
// ไม่มี: token, logout, "ของฉัน", ประวัติย้อนหลัง — สิ่งเหล่านี้ถูกตัด
// ออกไปแล้วตามสถาปัตยกรรมใหม่ (ดู commit ที่ตัด /api/keys/history/mine
// และ teacher login ออก)
// -----------------------------------------------------------------

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
// จัดรูปแบบระยะเวลาที่ยืมมาแล้ว เช่น "2 ชม. 14 นาที" / "5 นาที" / "1 วัน 3 ชม."
// -------------------------------------------------------------
function formatDuration(fromIso) {
  const from = new Date(fromIso).getTime();
  if (Number.isNaN(from)) return "—";

  let diffMs = Date.now() - from;
  if (diffMs < 0) diffMs = 0;

  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days} วัน ${hours} ชม.`;
  if (hours > 0) return `${hours} ชม. ${minutes} นาที`;
  if (minutes > 0) return `${minutes} นาที`;
  return "เมื่อสักครู่";
}

function formatBorrowedSince(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("th-TH", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch (e) {
    return "";
  }
}

// -------------------------------------------------------------
// โหลดสถานะกุญแจ — GET /api/keys/status เป็น endpoint public ไม่ต้อง
// แนบ token ใดๆ (ดู routes/keys.js: mount แบบไม่ผ่าน requireAuth)
// -------------------------------------------------------------
const itemsGridEl = document.getElementById("items-grid");
const searchInput = document.getElementById("search-input");
const statusFilter = document.getElementById("status-filter");

let allKeys = [];
let durationTickTimer = null;

async function loadKeysStatus() {
  try {
    const res = await fetch("/api/keys/status");
    const data = await res.json();

    if (!res.ok || !data.ok) {
      itemsGridEl.innerHTML = `<div class="empty-state">${escapeHtml(
        data.message || "โหลดสถานะกุญแจไม่สำเร็จ"
      )}</div>`;
      return;
    }

    allKeys = data.keys || [];
    renderItemsGrid();
    startDurationTicker();
  } catch (err) {
    itemsGridEl.innerHTML = `<div class="empty-state">เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองรีเฟรชหน้าใหม่อีกครั้ง</div>`;
  }
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

function renderImageBlock(key) {
  if (key.image_url) {
    return `<img class="item-card-image" src="${escapeHtml(key.image_url)}" alt="${escapeHtml(
      key.room_name
    )}" loading="lazy" />`;
  }
  // placeholder ไอคอนห้อง เผื่อยังไม่มีรูปสำหรับห้องนั้นๆ
  return `
    <div class="item-card-image-placeholder">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M3 21V8l9-5 9 5v13" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M9 21v-8h6v8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>ไม่มีรูปภาพ</span>
    </div>
  `;
}

function renderItemCard(key) {
  const isBorrowed = key.status === "borrowed";

  const pillClass = isBorrowed ? "pill--borrowed" : "pill--available";
  const pillLabel = isBorrowed ? "ถูกยืมอยู่" : "ว่าง";

  const holderName = isBorrowed && key.borrowed_by ? key.borrowed_by.name : null;
  const holderDept = isBorrowed && key.borrowed_by ? key.borrowed_by.department : null;

  const durationBlock =
    isBorrowed && key.borrowed_at
      ? `
        <div class="item-borrowed-duration" data-borrowed-at="${escapeHtml(key.borrowed_at)}">
          <span class="dot" aria-hidden="true"></span>
          <span class="duration-text">ยืมมาแล้ว ${formatDuration(key.borrowed_at)}</span>
        </div>
      `
      : "";

  return `
    <div class="item-card" data-key-id="${key.id}">
      <div class="item-card-image-wrap">
        ${renderImageBlock(key)}
        <span class="pill ${pillClass}">${pillLabel}</span>
      </div>
      <div class="item-card-body">
        <div class="item-card-top">
          <div>
            <div class="item-name">${escapeHtml(key.room_name)}</div>
            ${key.description ? `<div class="item-room">${escapeHtml(key.description)}</div>` : ""}
          </div>
        </div>
        ${
          isBorrowed && holderName
            ? `<div class="item-card-meta">ยืมอยู่โดยคุณครู ${escapeHtml(holderName)}${
                holderDept ? ` (${escapeHtml(holderDept)})` : ""
              }</div>`
            : ""
        }
        ${
          isBorrowed && key.borrowed_at
            ? `<div class="item-card-meta">ตั้งแต่ ${escapeHtml(formatBorrowedSince(key.borrowed_at))}</div>`
            : ""
        }
        ${durationBlock}
      </div>
    </div>
  `;
}

// -------------------------------------------------------------
// อัปเดตข้อความ "ยืมมาแล้ว X นาที/ชม." แบบสด ทุก 60 วินาที โดยไม่ต้อง
// re-render การ์ดทั้งหมด (กัน layout กระตุกตอนกำลังพิมพ์ค้นหาอยู่)
// -------------------------------------------------------------
function startDurationTicker() {
  clearInterval(durationTickTimer);
  durationTickTimer = setInterval(() => {
    document.querySelectorAll(".item-borrowed-duration").forEach((el) => {
      const borrowedAt = el.getAttribute("data-borrowed-at");
      if (!borrowedAt) return;
      const textEl = el.querySelector(".duration-text");
      if (textEl) textEl.textContent = `ยืมมาแล้ว ${formatDuration(borrowedAt)}`;
    });
  }, 60 * 1000);
}

searchInput.addEventListener("input", renderItemsGrid);
statusFilter.addEventListener("change", renderItemsGrid);

// -------------------------------------------------------------
// รีเฟรชสถานะทั้งหมดอัตโนมัติทุก 15 วินาที เพื่อให้เห็นการยืม-คืนที่
// เกิดขึ้นจากเครื่องอ่านที่ห้องทะเบียนแบบเกือบเรียลไทม์ (หน้านี้ไม่มี
// login ใครก็เปิดทิ้งไว้ดูได้)
// -------------------------------------------------------------
function startAutoRefresh() {
  setInterval(loadKeysStatus, 15 * 1000);
}

// =================================================================
// Init
// =================================================================
(function init() {
  loadKeysStatus();
  startAutoRefresh();
})();
