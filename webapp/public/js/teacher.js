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
    <div class="item-card" data-key-id="${key.id}" role="button" tabindex="0" aria-label="ดูรายละเอียด ${escapeHtml(key.room_name)}">
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
// คลิก/กด Enter บนการ์ด -> เปิด modal รายละเอียดห้อง (Task 9a)
// ใช้ event delegation บน itemsGridEl เดียว เพราะการ์ดถูก re-render
// ทั้งกริดทุกครั้งที่ filter/refresh — ผูก listener ตรงๆ กับการ์ด
// แต่ละใบจะหลุดหายไปพร้อม innerHTML ทุกรอบ ต้องผูกที่ container แทน
// -------------------------------------------------------------
itemsGridEl.addEventListener("click", (e) => {
  const card = e.target.closest(".item-card");
  if (!card) return;
  const keyId = card.getAttribute("data-key-id");
  openRoomDetail(keyId);
});

itemsGridEl.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const card = e.target.closest(".item-card");
  if (!card) return;
  e.preventDefault();
  const keyId = card.getAttribute("data-key-id");
  openRoomDetail(keyId);
});

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
// Room detail modal (Task 9a — shell only)
// -----------------------------------------------------------------
// เปิดจากการคลิก/Enter บนการ์ดห้อง (ผูก listener ไว้ที่ itemsGridEl
// ด้านบนแล้ว) เนื้อหาโหลด 2 ส่วนคนละ endpoint:
//   1. ข้อมูลห้อง/รูป/สถานะ/ช่วงเวลายืม -> ใช้ของที่มีอยู่แล้วใน allKeys
//      (มาจาก /api/keys/status ตอนโหลดหน้าแรก) ไม่ต้อง fetch ซ้ำ
//   2. ประวัติยืม-คืน 10 รายการล่าสุด -> GET /api/keys/:id/history
//      (fetch สดทุกครั้งที่เปิด modal เพราะ allKeys ไม่มีข้อมูลนี้)
//
// Task 9b (lightbox) และ 9c (badge ช่วงเวลายืมแบบมนุษย์อ่านง่าย) จะมา
// ขยาย renderRoomDetail()/renderRoomImages() นี้ทีหลัง — ตอนนี้รูป
// หลายใบแสดงเป็นแถบรูปธรรมดา ยังคลิกขยายไม่ได้ และช่วงเวลายืมแสดงเป็น
// ข้อความดิบๆ ยังไม่มีไอคอนนาฬิกา/ปฏิทินตามสเปค
// -------------------------------------------------------------
const roomModalOverlay = document.getElementById("room-modal-overlay");
const roomModalBody = document.getElementById("room-modal-body");
const roomModalClose = document.getElementById("room-modal-close");

let lastFocusedBeforeModal = null;

const ACTION_LABEL_TH = { borrow: "ยืม", return: "คืน" };

function findKeyById(keyId) {
  // data-key-id มาจาก template string (attribute เป็น string เสมอ) ส่วน
  // key.id ที่มาจาก Supabase เป็น number -> เทียบแบบ loose (==) ที่นี่
  // จุดเดียวเพื่อกันปัญหา type mismatch ไม่ต้องแก้หลายที่
  return allKeys.find((k) => String(k.id) === String(keyId)) || null;
}

async function openRoomDetail(keyId) {
  const key = findKeyById(keyId);
  if (!key) {
    showToast("ไม่พบข้อมูลห้องนี้ ลองรีเฟรชหน้าใหม่อีกครั้ง", "error");
    return;
  }

  lastFocusedBeforeModal = document.activeElement;

  roomModalBody.innerHTML = renderRoomDetailShell(key);
  showRoomModal();

  // ประวัติยืม-คืนโหลดทีหลัง แสดง "กำลังโหลด..." ในบล็อก timeline ก่อน
  // ไม่บล็อก modal จากการเปิดทันทีที่คลิก (ข้อมูลห้อง/รูปโชว์ได้จาก
  // allKeys อยู่แล้วโดยไม่ต้องรอ network)
  try {
    const res = await fetch(`/api/keys/${encodeURIComponent(keyId)}/history`);
    const data = await res.json();

    if (!res.ok || !data.ok) {
      renderTimelineError(data.message || "โหลดประวัติไม่สำเร็จ");
      return;
    }

    renderTimeline(data.logs || [], data.totalCount || 0, key.id);
  } catch (err) {
    renderTimelineError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง");
  }
}

function renderRoomDetailShell(key) {
  const isBorrowed = key.status === "borrowed";
  const pillClass = isBorrowed ? "pill--borrowed" : "pill--available";
  const pillLabel = isBorrowed ? "ถูกยืมอยู่" : "ว่าง";

  const holderName = isBorrowed && key.borrowed_by ? key.borrowed_by.name : null;
  const holderDept = isBorrowed && key.borrowed_by ? key.borrowed_by.department : null;

  return `
    <div class="room-modal-header">
      <div>
        <h3 id="room-modal-title" class="room-modal-title">${escapeHtml(key.room_name)}</h3>
        ${key.description ? `<p class="room-modal-desc">${escapeHtml(key.description)}</p>` : ""}
      </div>
      <span class="pill ${pillClass}">${pillLabel}</span>
    </div>

    <div class="room-modal-images">
      ${renderRoomImages(key)}
    </div>

    ${
      isBorrowed
        ? `<div class="room-modal-status-line">
             ${
               holderName
                 ? `ยืมอยู่โดยคุณครู ${escapeHtml(holderName)}${holderDept ? ` (${escapeHtml(holderDept)})` : ""}`
                 : "ถูกยืมอยู่"
             }
             ${key.borrowed_at ? ` — ตั้งแต่ ${escapeHtml(formatBorrowedSince(key.borrowed_at))}` : ""}
           </div>`
        : ""
    }

    <div class="room-modal-section">
      <h4 class="room-modal-section-title">ประวัติยืม-คืนล่าสุด</h4>
      <div id="room-modal-timeline" class="room-modal-timeline">
        <div class="room-modal-timeline-loading">กำลังโหลด...</div>
      </div>
    </div>
  `;
}

// -------------------------------------------------------------
// รูปภาพห้อง — ใช้ room_images (หลายรูป, เรียงตาม sort_order จาก
// backend อยู่แล้ว) ถ้าไม่มีเลยค่อย fallback ไป image_url เดี่ยวเดิม
// (backward compat ตาม schema.sql migration note) ไม่มีเลยทั้งคู่ ->
// placeholder เดียวกับที่การ์ดใช้
//
// currentRoomImages/currentRoomName ถูกเซ็ตที่นี่ (module-level state)
// ให้ openLightbox() อ่านต่อได้ — เก็บไว้ตอน render แทนที่จะ query DOM
// ย้อนกลับตอนคลิก เพราะ URL รูปอยู่ใน allKeys อยู่แล้วไม่ต้อง derive
// จาก src attribute ซ้ำ (กัน encode/escape เพี้ยนไปมา)
//
// รูปแต่ละรูปมี data-index + role="button" ให้คลิก/Enter เปิด lightbox
// (Task 9b) — event delegation ผูกที่ .room-modal-images ครั้งเดียว
// ด้านล่าง เพราะรูปถูก re-render ทุกครั้งที่เปิด modal ใหม่เหมือนกับ
// pattern ที่ใช้กับ .item-card ใน itemsGridEl ด้านบน
// -------------------------------------------------------------
let currentRoomImages = [];
let currentRoomName = "";

function renderRoomImages(key) {
  const images =
    key.room_images && key.room_images.length > 0
      ? key.room_images.map((img) => img.image_url)
      : key.image_url
        ? [key.image_url]
        : [];

  currentRoomImages = images;
  currentRoomName = key.room_name;

  if (images.length === 0) {
    return `
      <div class="room-modal-image-placeholder">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M3 21V8l9-5 9 5v13" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M9 21v-8h6v8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>ไม่มีรูปภาพ</span>
      </div>
    `;
  }

  return images
    .map(
      (url, i) => `
        <img
          class="room-modal-image"
          src="${escapeHtml(url)}"
          alt="${escapeHtml(key.room_name)} รูปที่ ${i + 1}"
          loading="lazy"
          data-image-index="${i}"
          role="button"
          tabindex="0"
          aria-label="ดูรูป ${escapeHtml(key.room_name)} รูปที่ ${i + 1} แบบเต็มจอ"
        />
      `
    )
    .join("");
}

function renderTimeline(logs, totalCount, roomId) {
  const timelineEl = document.getElementById("room-modal-timeline");
  if (!timelineEl) return; // modal อาจถูกปิดไปแล้วก่อน fetch เสร็จ

  if (logs.length === 0) {
    timelineEl.innerHTML = `<div class="room-modal-timeline-empty">ยังไม่มีประวัติยืม-คืนของห้องนี้</div>`;
    return;
  }

  const rows = logs
    .map((log) => {
      const actionLabel = ACTION_LABEL_TH[log.action] || log.action;
      const actionClass = log.action === "borrow" ? "is-borrow" : "is-return";
      const teacherName = log.teachers ? log.teachers.name : "—";
      const teacherDept = log.teachers && log.teachers.department ? ` (${escapeHtml(log.teachers.department)})` : "";

      return `
        <div class="room-modal-timeline-row">
          <span class="room-modal-timeline-action ${actionClass}">${escapeHtml(actionLabel)}</span>
          <span class="room-modal-timeline-who">${escapeHtml(teacherName)}${teacherDept}</span>
          <span class="room-modal-timeline-when">${escapeHtml(formatBorrowedSince(log.acted_at))}</span>
        </div>
      `;
    })
    .join("");

  const viewAllLink =
    totalCount > logs.length
      ? `<a class="room-modal-timeline-viewall" href="/history.html?roomId=${encodeURIComponent(roomId)}">ดูทั้งหมด (${totalCount} รายการ) &rarr;</a>`
      : "";

  timelineEl.innerHTML = rows + viewAllLink;
}

function renderTimelineError(message) {
  const timelineEl = document.getElementById("room-modal-timeline");
  if (!timelineEl) return;
  timelineEl.innerHTML = `<div class="room-modal-timeline-empty">${escapeHtml(message)}</div>`;
}

function showRoomModal() {
  roomModalOverlay.classList.add("is-visible");
  document.body.classList.add("modal-open");
  roomModalClose.focus();
  document.addEventListener("keydown", onRoomModalKeydown);
}

function closeRoomDetail() {
  // ถ้า lightbox ยังเปิดค้างอยู่ (ผู้ใช้คลิกพื้นหลัง room modal โดยไม่ได้
  // ปิด lightbox ก่อน) ต้องปิดไปด้วย ไม่งั้นจะค้างลอยอยู่เหนือ modal ที่
  // เพิ่งถูกล้าง innerHTML ทิ้งไปแล้ว — เช็คจาก class แทน flag แยก เพราะ
  // เป็น source of truth เดียวกับที่ CSS ใช้ตัดสินว่าแสดงอยู่หรือไม่
  if (lightboxOverlay.classList.contains("is-visible")) {
    closeLightbox();
  }

  roomModalOverlay.classList.remove("is-visible");
  document.body.classList.remove("modal-open");
  document.removeEventListener("keydown", onRoomModalKeydown);
  roomModalBody.innerHTML = "";
  if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === "function") {
    lastFocusedBeforeModal.focus();
  }
}

function onRoomModalKeydown(e) {
  if (e.key === "Escape") closeRoomDetail();
}

roomModalClose.addEventListener("click", closeRoomDetail);

// ปิด modal เมื่อคลิกพื้นหลังนอกการ์ด (ไม่ใช่คลิกในตัวการ์ดเอง)
roomModalOverlay.addEventListener("click", (e) => {
  if (e.target === roomModalOverlay) closeRoomDetail();
});

// =================================================================
// Lightbox (Task 9b)
// -----------------------------------------------------------------
// ขยายรูปเต็มจอเมื่อคลิก/Enter บนรูปใน .room-modal-images ซ้อนทับ
// room modal อีกที (z-index สูงกว่า ดู teacher.css) ใช้
// currentRoomImages/currentRoomName ที่ renderRoomImages() เซ็ตไว้
// ล่าสุดแทนการ query src จาก DOM — กัน escape/encode เพี้ยน และไม่ต้อง
// parse attribute กลับ
//
// Escape ปิดเฉพาะ lightbox ก่อน (ไม่ปิด room modal ทับซ้อนไปด้วย) —
// ต้อง stopPropagation ที่ document keydown listener ของ lightbox เอง
// เพราะ room modal เองก็ฟัง Escape อยู่ที่ document เหมือนกัน ถ้าไม่กัน
// จะปิดพร้อมกันทั้งคู่ในคลิกเดียว ซึ่งไม่ใช่พฤติกรรมที่ควรเป็น (ผู้ใช้
// กด Escape ครั้งแรกควรกลับไปที่ room modal ก่อน ไม่ใช่หลุดออกทั้งหมด)
// -------------------------------------------------------------
let lightboxIndex = 0;
let lastFocusedBeforeLightbox = null;

const lightboxOverlay = document.createElement("div");
lightboxOverlay.id = "room-lightbox-overlay";
lightboxOverlay.className = "room-lightbox-overlay";
lightboxOverlay.innerHTML = `
  <button type="button" class="room-lightbox-close" aria-label="ปิดรูปเต็มจอ">&times;</button>
  <button type="button" class="room-lightbox-nav room-lightbox-prev" aria-label="รูปก่อนหน้า">&larr;</button>
  <figure class="room-lightbox-figure">
    <img class="room-lightbox-image" alt="" />
    <figcaption class="room-lightbox-caption"></figcaption>
  </figure>
  <button type="button" class="room-lightbox-nav room-lightbox-next" aria-label="รูปถัดไป">&rarr;</button>
`;
document.body.appendChild(lightboxOverlay);

const lightboxImageEl = lightboxOverlay.querySelector(".room-lightbox-image");
const lightboxCaptionEl = lightboxOverlay.querySelector(".room-lightbox-caption");
const lightboxCloseBtn = lightboxOverlay.querySelector(".room-lightbox-close");
const lightboxPrevBtn = lightboxOverlay.querySelector(".room-lightbox-prev");
const lightboxNextBtn = lightboxOverlay.querySelector(".room-lightbox-next");

function renderLightboxFrame() {
  const total = currentRoomImages.length;
  if (total === 0) return;

  const url = currentRoomImages[lightboxIndex];
  lightboxImageEl.src = url;
  lightboxImageEl.alt = `${currentRoomName} รูปที่ ${lightboxIndex + 1}`;
  lightboxCaptionEl.textContent = total > 1 ? `${lightboxIndex + 1} / ${total}` : currentRoomName;

  // ซ่อนปุ่มเลื่อนถ้ามีรูปเดียว — ไม่มีอะไรให้เลื่อนไปหา
  const showNav = total > 1;
  lightboxPrevBtn.style.display = showNav ? "" : "none";
  lightboxNextBtn.style.display = showNav ? "" : "none";
}

function openLightbox(index) {
  if (!currentRoomImages || currentRoomImages.length === 0) return;
  lightboxIndex = ((index % currentRoomImages.length) + currentRoomImages.length) % currentRoomImages.length;
  lastFocusedBeforeLightbox = document.activeElement;

  renderLightboxFrame();
  lightboxOverlay.classList.add("is-visible");
  lightboxCloseBtn.focus();
  document.addEventListener("keydown", onLightboxKeydown, true);
}

function closeLightbox() {
  lightboxOverlay.classList.remove("is-visible");
  document.removeEventListener("keydown", onLightboxKeydown, true);
  if (lastFocusedBeforeLightbox && typeof lastFocusedBeforeLightbox.focus === "function") {
    lastFocusedBeforeLightbox.focus();
  }
}

function showPrevImage() {
  openLightboxAtOffset(-1);
}

function showNextImage() {
  openLightboxAtOffset(1);
}

function openLightboxAtOffset(offset) {
  if (currentRoomImages.length === 0) return;
  lightboxIndex =
    ((lightboxIndex + offset) % currentRoomImages.length + currentRoomImages.length) % currentRoomImages.length;
  renderLightboxFrame();
}

// capture: true เพื่อดักก่อน room modal's own Escape listener แล้ว
// stopPropagation กันไม่ให้ event ทะลุไปปิด room modal ด้วยในคลิกเดียว
function onLightboxKeydown(e) {
  if (e.key === "Escape") {
    e.stopPropagation();
    closeLightbox();
  } else if (e.key === "ArrowLeft") {
    showPrevImage();
  } else if (e.key === "ArrowRight") {
    showNextImage();
  }
}

lightboxCloseBtn.addEventListener("click", closeLightbox);
lightboxPrevBtn.addEventListener("click", showPrevImage);
lightboxNextBtn.addEventListener("click", showNextImage);

// ปิดเมื่อคลิกพื้นหลัง (นอกรูป/ปุ่ม) เหมือน room modal
lightboxOverlay.addEventListener("click", (e) => {
  if (e.target === lightboxOverlay) closeLightbox();
});

// เปิด lightbox จากการคลิก/Enter บนรูปใน .room-modal-images — ผูก
// listener ที่ roomModalBody (parent คงที่) แทนที่จะผูกกับรูปแต่ละใบ
// เพราะ renderRoomDetailShell() แทนที่ innerHTML ทั้งก้อนทุกครั้งที่
// เปิด modal ใหม่ (เหมือน pattern เดิมของ itemsGridEl/room card)
roomModalBody.addEventListener("click", (e) => {
  const img = e.target.closest(".room-modal-image");
  if (!img) return;
  const idx = parseInt(img.getAttribute("data-image-index"), 10);
  openLightbox(Number.isNaN(idx) ? 0 : idx);
});

roomModalBody.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const img = e.target.closest(".room-modal-image");
  if (!img) return;
  e.preventDefault();
  const idx = parseInt(img.getAttribute("data-image-index"), 10);
  openLightbox(Number.isNaN(idx) ? 0 : idx);
});

// =================================================================
// Init
// =================================================================
function initTeacherPage() {
  loadKeysStatus();
  startAutoRefresh();
}

initTeacherPage();