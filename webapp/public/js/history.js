// public/js/history.js
// -----------------------------------------------------------------
// หน้า "ดูทั้งหมด" ของประวัติยืม-คืน (public, read-only, ไม่มี login)
// เข้าได้ 2 ทาง:
//   /history.html            -> ทุกห้องรวมกัน
//   /history.html?roomId=X   -> เฉพาะห้องนั้น (ลิงก์มาจากปุ่ม "ดูทั้งหมด"
//                                ใน room modal ของ teacher.js)
//
// ใช้ GET /api/keys/history/all (routes/keys.js) — public, paginated,
// filter ได้แค่ roomId เท่านั้น (คนละ endpoint กับ /api/admin/keys/history
// ที่ต้อง login และ filter ได้ทั้ง action/teacherId — หน้านี้ตั้งใจให้
// เรียบง่ายกว่าตามสโคปที่ระบุใน MANIFEST)
//
// Pattern การ render แถวประวัติ (.room-modal-timeline-row ฯลฯ) ยืมมาจาก
// teacher.js/teacher.css ตรงๆ (ใช้ pattern เดียวกับ timeline ใน room
// modal) เพื่อให้หน้าตาสอดคล้องกันทั้งระบบ ไม่ต้องคิด style ใหม่
// -----------------------------------------------------------------

const PAGE_SIZE = 20; // ตรงกับ HISTORY_PAGE_SIZE_DEFAULT ฝั่ง backend

const ACTION_LABEL_TH = { borrow: "ยืม", return: "คืน" };

// -------------------------------------------------------------
// Toast (pattern เดียวกับ teacher.js/admin.js)
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

function formatDateTimeTh(iso) {
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
// อ่าน roomId จาก query string — undefined ถ้าไม่มี/parse ไม่ได้
// (ปล่อยให้ backend เป็นคนตรวจรูปแบบซ้ำอีกที ที่นี่แค่เช็คคร่าวๆ พอ
// ให้ไม่ส่งค่าที่ชัดเจนว่าผิดไปเสียเวลา round-trip เฉยๆ)
// -------------------------------------------------------------
function getRoomIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("roomId");
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

const roomId = getRoomIdFromQuery();
let currentPage = 1;

// -------------------------------------------------------------
// ปรับหัวข้อ/คำอธิบายให้ตรงกับบริบท (ทุกห้อง vs ห้องเดียว) — ชื่อห้อง
// จริงมาจากแถวประวัติแรกที่โหลดได้ (room_tags.room_name) เพราะ
// /api/keys/history/all ไม่ได้คืนชื่อห้องแยกต่างหากตอน filter — ถ้า
// ห้องนั้นไม่มีประวัติเลย (totalCount=0) จะโชว์แค่ "ห้อง #<id>" แทน
// -------------------------------------------------------------
function updatePageContext(firstRoomName) {
  const titleEl = document.getElementById("history-page-title");
  const sectionTitleEl = document.getElementById("history-section-title");
  const subEl = document.getElementById("history-section-sub");

  if (roomId === null) {
    titleEl.textContent = "ประวัติยืม-คืนทั้งหมด";
    sectionTitleEl.textContent = "ประวัติยืม-คืนล่าสุด";
    subEl.textContent = "รายการยืม-คืนทั้งหมดของทุกห้อง เรียงล่าสุดก่อน — หน้านี้เป็นหน้าสาธารณะ ไม่ต้องเข้าสู่ระบบ";
    return;
  }

  const label = firstRoomName ? firstRoomName : `ห้อง #${roomId}`;
  titleEl.textContent = `ประวัติยืม-คืน — ${label}`;
  sectionTitleEl.textContent = `ประวัติยืม-คืนของ ${label}`;
  subEl.textContent = "รายการยืม-คืนทั้งหมดของห้องนี้ เรียงล่าสุดก่อน — หน้านี้เป็นหน้าสาธารณะ ไม่ต้องเข้าสู่ระบบ";
}

// -------------------------------------------------------------
// โหลดประวัติหน้าปัจจุบัน
// -------------------------------------------------------------
const historyListEl = document.getElementById("history-list");
const prevBtn = document.getElementById("history-prev-page");
const nextBtn = document.getElementById("history-next-page");
const pageInfoEl = document.getElementById("history-page-info");

async function loadHistoryPage(page) {
  historyListEl.innerHTML = `<div class="room-modal-timeline-loading">กำลังโหลด...</div>`;
  prevBtn.disabled = true;
  nextBtn.disabled = true;

  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (roomId !== null) params.set("roomId", String(roomId));

  try {
    const res = await fetch(`/api/keys/history/all?${params.toString()}`);
    const data = await res.json();

    if (!res.ok || !data.ok) {
      historyListEl.innerHTML = `<div class="room-modal-timeline-empty">${escapeHtml(
        data.message || "โหลดประวัติไม่สำเร็จ"
      )}</div>`;
      showToast(data.message || "โหลดประวัติไม่สำเร็จ", "error");
      return;
    }

    currentPage = data.page || page;
    renderHistoryList(data.logs || []);
    renderPagination(data.page || 1, data.totalPages || 1, data.totalCount || 0);

    const firstRoomName =
      data.logs && data.logs.length > 0 && data.logs[0].room_tags ? data.logs[0].room_tags.room_name : null;
    updatePageContext(firstRoomName);
  } catch (err) {
    historyListEl.innerHTML = `<div class="room-modal-timeline-empty">เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองรีเฟรชหน้าใหม่อีกครั้ง</div>`;
    showToast("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง", "error");
  }
}

function renderHistoryList(logs) {
  if (logs.length === 0) {
    historyListEl.innerHTML = `<div class="room-modal-timeline-empty">ยังไม่มีประวัติยืม-คืน${
      roomId !== null ? "ของห้องนี้" : ""
    }</div>`;
    return;
  }

  historyListEl.innerHTML = logs
    .map((log) => {
      const actionLabel = ACTION_LABEL_TH[log.action] || log.action;
      const actionClass = log.action === "borrow" ? "is-borrow" : "is-return";
      const roomName = log.room_tags ? log.room_tags.room_name : "—";
      const teacherName = log.teachers ? log.teachers.name : "—";
      const teacherDept = log.teachers && log.teachers.department ? ` (${escapeHtml(log.teachers.department)})` : "";

      // แสดงชื่อห้องในแต่ละแถวด้วยเฉพาะตอนดูรวมทุกห้อง (roomId === null)
      // — ถ้ากรองห้องเดียวอยู่แล้ว ชื่อห้องซ้ำทุกแถวไม่ได้ให้ข้อมูลเพิ่ม
      // (เห็นในหัวข้อหน้าแล้ว) เอาพื้นที่ไปเน้นคนยืม/เวลาแทนดีกว่า
      const roomLabel = roomId === null ? `<span class="history-row-room">${escapeHtml(roomName)}</span>` : "";

      return `
        <div class="room-modal-timeline-row history-row">
          <span class="room-modal-timeline-action ${actionClass}">${escapeHtml(actionLabel)}</span>
          ${roomLabel}
          <span class="room-modal-timeline-who">${escapeHtml(teacherName)}${teacherDept}</span>
          <span class="room-modal-timeline-when">${escapeHtml(formatDateTimeTh(log.acted_at))}</span>
        </div>
      `;
    })
    .join("");
}

function renderPagination(page, totalPages, totalCount) {
  pageInfoEl.textContent = totalCount > 0 ? `หน้า ${page} / ${totalPages} (ทั้งหมด ${totalCount} รายการ)` : "หน้า 1 / 1";
  prevBtn.disabled = page <= 1;
  nextBtn.disabled = page >= totalPages;
}

prevBtn.addEventListener("click", () => {
  if (currentPage > 1) loadHistoryPage(currentPage - 1);
});

nextBtn.addEventListener("click", () => {
  loadHistoryPage(currentPage + 1);
});

// =================================================================
// Init
// =================================================================
updatePageContext(null); // ตั้งหัวข้อเบื้องต้นก่อน (เผื่อ fetch ช้า) ค่อยแก้ทีหลังถ้ารู้ชื่อห้องจริง
loadHistoryPage(1);
