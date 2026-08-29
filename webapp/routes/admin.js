// public/js/admin.js
// -----------------------------------------------------------------
// หน้าแอดมิน: ผูกกับ /api/admin/* ทั้งหมด (rooms, teacher-tags, keys
// status/history) ใช้ JWT จาก localStorage คีย์ "token" (เซ็ตไว้ตอน
// login.js เข้าสู่ระบบแอดมินสำเร็จ)
//
// เวอร์ชันนี้ตัด "ของในห้อง" (room_items) และ "มอบหมายดูแลห้อง"
// (teacher_room_assignments) ออกทั้งหมดตามสถาปัตยกรรมใหม่ — กุญแจทุกดอก
// คือ row เดียวใน room_tags เอง และครูคนไหนมีแท็กก็ยืมห้องไหนก็ได้
// ไม่ต้อง assign ล่วงหน้า แทนที่ด้วย 2 section ใหม่: สถานะกุญแจ + ประวัติ
//
// ไม่ได้ใช้ framework ใดๆ — vanilla DOM + fetch เพื่อให้เบาและ debug ง่าย
// โครงสร้าง: apiFetch (ผู้ช่วยกลาง) -> loadX()/renderX() ต่อ section ->
// bind form submit + event delegation สำหรับปุ่มในตาราง
// -----------------------------------------------------------------

const TOKEN_KEY = "token";

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function goToLogin() {
  window.location.href = "/";
}

// -------------------------------------------------------------
// apiFetch: ผู้ช่วยกลางสำหรับเรียก /api/admin/* ทุกจุด
// - แนบ Authorization header อัตโนมัติ
// - ถ้า 401 -> token หมดอายุ/ไม่ถูกต้อง -> เด้งกลับหน้า login ทันที
// - คืนค่า { ok, status, data } เสมอ ไม่ throw (ผู้เรียกเช็ค ok เอง)
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
const apiPost = (url, body) => apiFetch(url, { method: "POST", body: JSON.stringify(body) });
const apiPatch = (url, body) => apiFetch(url, { method: "PATCH", body: JSON.stringify(body) });
const apiDelete = (url) => apiFetch(url, { method: "DELETE" });

// -------------------------------------------------------------
// apiUpload: เหมือน apiFetch แต่ส่ง FormData (ไม่ตั้ง Content-Type เอง
// เพื่อให้ browser ใส่ multipart boundary ให้อัตโนมัติ)
// -------------------------------------------------------------
async function apiUpload(url, formData, method = "POST") {
  const token = getToken();

  if (!token) {
    goToLogin();
    return { ok: false, status: 401, data: { ok: false, message: "กรุณาเข้าสู่ระบบ" } };
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
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

// -------------------------------------------------------------
// Toast
// -------------------------------------------------------------
const toastEl = document.getElementById("toast");
let toastTimer = null;

function showToast(message, type) {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.className = "admin-toast is-visible " + (type === "ok" ? "ok" : "error");
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("is-visible");
  }, 3200);
}

// -------------------------------------------------------------
// Confirm dialog (แทน window.confirm ของเบราว์เซอร์ด้วยการ์ดสไตล์เดียวกับเว็บ)
//   ใช้แบบ: const confirmed = await showConfirm("ยืนยันลบ...?");
//   มีปุ่มกากบาทมุมขวาบน + ปุ่มยกเลิก/ยืนยัน กด Esc หรือคลิกฉากหลังก็ปิดได้
//   (นับเป็น "ยกเลิก")
// -------------------------------------------------------------
let confirmOverlayEl = null;
let confirmResolve = null;

function ensureConfirmDialog() {
  if (confirmOverlayEl) return;

  confirmOverlayEl = document.createElement("div");
  confirmOverlayEl.className = "confirm-overlay";
  confirmOverlayEl.innerHTML = `
    <div class="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-message">
      <button type="button" class="confirm-close" aria-label="ปิด">&times;</button>
      <p id="confirm-message" class="confirm-message"></p>
      <div class="confirm-actions">
        <button type="button" class="btn btn--ghost confirm-cancel">ยกเลิก</button>
        <button type="button" class="btn btn--danger confirm-ok">ยืนยัน</button>
      </div>
    </div>
  `;
  document.body.appendChild(confirmOverlayEl);

  const resolveWith = (value) => {
    confirmOverlayEl.classList.remove("is-visible");
    document.removeEventListener("keydown", onKeydown);
    if (confirmResolve) {
      confirmResolve(value);
      confirmResolve = null;
    }
  };

  const onKeydown = (e) => {
    if (e.key === "Escape") resolveWith(false);
  };

  confirmOverlayEl.querySelector(".confirm-close").addEventListener("click", () => resolveWith(false));
  confirmOverlayEl.querySelector(".confirm-cancel").addEventListener("click", () => resolveWith(false));
  confirmOverlayEl.querySelector(".confirm-ok").addEventListener("click", () => resolveWith(true));
  confirmOverlayEl.addEventListener("click", (e) => {
    if (e.target === confirmOverlayEl) resolveWith(false);
  });

  confirmOverlayEl._resolveWith = resolveWith;
  confirmOverlayEl._onKeydown = onKeydown;
}

function showConfirm(message) {
  ensureConfirmDialog();
  confirmOverlayEl.querySelector("#confirm-message").textContent = message;
  confirmOverlayEl.classList.add("is-visible");
  document.addEventListener("keydown", confirmOverlayEl._onKeydown);

  return new Promise((resolve) => {
    confirmResolve = resolve;
  });
}

// -------------------------------------------------------------
// Section switching (sidebar nav)
// -------------------------------------------------------------
const SECTION_META = {
  rooms: { index: "01", title: "ห้อง / กุญแจ" },
  teachers: { index: "02", title: "แท็กครู" },
  keys: { index: "03", title: "สถานะกุญแจ" },
  history: { index: "04", title: "ประวัติยืม-คืน" },
};

const navButtons = document.querySelectorAll(".admin-nav-btn");
const sectionPanels = document.querySelectorAll(".admin-section");
const sectionEyebrow = document.getElementById("section-eyebrow");
const sectionTitle = document.getElementById("section-title");

const LOADERS = {
  rooms: loadRooms,
  teachers: loadTeacherTags,
  keys: loadKeysStatus,
  history: loadKeysHistory,
};

const loadedOnce = new Set();

function switchSection(section) {
  navButtons.forEach((btn) => btn.classList.toggle("is-active", btn.dataset.section === section));
  sectionPanels.forEach((panel) => panel.classList.toggle("is-active", panel.dataset.sectionPanel === section));

  const meta = SECTION_META[section];
  sectionEyebrow.textContent = `SECTION ${meta.index}`;
  sectionTitle.textContent = meta.title;

  // โหลดข้อมูลของ section นั้นทุกครั้งที่สลับเข้ามา เพื่อให้เห็นข้อมูลล่าสุด
  const loader = LOADERS[section];
  if (loader) loader();
}

navButtons.forEach((btn) => {
  btn.addEventListener("click", () => switchSection(btn.dataset.section));
});

document.getElementById("logout-btn").addEventListener("click", () => {
  localStorage.removeItem(TOKEN_KEY);
  goToLogin();
});

// -------------------------------------------------------------
// Shared state: cache รายการห้อง/ครู ไว้ให้ dropdown ของหลาย section ใช้ร่วมกัน
// -------------------------------------------------------------
const state = {
  rooms: [],
};

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



// =================================================================
// Borrow window — helper ที่ใช้ร่วมกันทั้งฟอร์มเพิ่มห้อง (create-form
// ในหน้า) และ popover แก้ไขในตาราง (SECTION 01) เพราะ 2 ที่นี้มี markup
// เหมือนกันทุกจุด (.bw-days-row/.bw-day-btn/data-bw-start/data-bw-end)
// ต่างกันแค่ container — ฟังก์ชันด้านล่างรับ root element เข้ามาแทน
// การ query แบบ hardcode id เดียว
// =================================================================

const DAY_LABELS_TH = { 0: "อา", 1: "จ", 2: "อ", 3: "พ", 4: "พฤ", 5: "ศ", 6: "ส" };
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // จ-อา ให้อ่านง่ายแบบปฏิทินไทยทั่วไป

// ผูก click ให้ปุ่มวัน toggle .is-selected ภายใน root ที่กำหนด (เรียกครั้งเดียวตอน setup)
function bindDayToggle(root) {
  const daysRow = root.querySelector("[data-bw-days]");
  daysRow.addEventListener("click", (e) => {
    const btn = e.target.closest(".bw-day-btn");
    if (!btn) return;
    btn.classList.toggle("is-selected");
  });
}

// เซ็ตค่าเริ่มต้นของ editor จาก room ที่มีอยู่ (หรือเคลียร์ถ้าไม่ส่ง room มา)
function setBorrowWindowEditorValue(root, room) {
  const days = room && Array.isArray(room.borrow_window_days) ? room.borrow_window_days : null;
  root.querySelectorAll(".bw-day-btn").forEach((btn) => {
    const d = parseInt(btn.dataset.day, 10);
    btn.classList.toggle("is-selected", !!(days && days.includes(d)));
  });
  root.querySelector("[data-bw-start]").value = (room && room.borrow_window_start) ? room.borrow_window_start.slice(0, 5) : "";
  root.querySelector("[data-bw-end]").value = (room && room.borrow_window_end) ? room.borrow_window_end.slice(0, 5) : "";
}

// อ่านค่าปัจจุบันจาก editor -> payload สำหรับ apiPost/apiPatch
// คืนค่า { ok, message } หรือ { ok: true, payload }
function readBorrowWindowEditorValue(root) {
  const selectedDays = Array.from(root.querySelectorAll(".bw-day-btn.is-selected")).map((btn) =>
    parseInt(btn.dataset.day, 10)
  );
  const startVal = root.querySelector("[data-bw-start]").value; // "" หรือ "HH:MM"
  const endVal = root.querySelector("[data-bw-end]").value;

  if ((startVal && !endVal) || (!startVal && endVal)) {
    return { ok: false, message: "กรุณากรอกเวลาเริ่มและสิ้นสุดให้ครบทั้งคู่ (หรือเว้นว่างทั้งคู่)" };
  }

  return {
    ok: true,
    payload: {
      borrowWindowDays: selectedDays.length > 0 ? selectedDays : null,
      borrowWindowStart: startVal || null,
      borrowWindowEnd: endVal || null,
    },
  };
}

// สรุปช่วงเวลาเป็นข้อความไทยอ่านง่าย เช่น "ยืมได้: จ-ศ 08:00-16:00"
// ใช้ทั้งในตัวปุ่มสรุปของตาราง — ไม่จำเป็นต้อง contiguous run กัน
// (ถ้าเลือกวันไม่ติดกัน เช่น จ,พ,ศ ก็แค่ไล่คั่นด้วยจุลภาค ไม่พยายามหา
// ช่วงต่อเนื่องแบบ "จ-ศ" ให้ซับซ้อนเกินจำเป็นสำหรับ use case นี้)
function formatBorrowWindowSummary(room) {
  const days = Array.isArray(room.borrow_window_days) ? room.borrow_window_days : null;
  const start = room.borrow_window_start ? room.borrow_window_start.slice(0, 5) : null;
  const end = room.borrow_window_end ? room.borrow_window_end.slice(0, 5) : null;

  if (!days && !start && !end) {
    return { text: "ยืมได้ทุกวันทุกเวลา", hasWindow: false };
  }

  const daysLabel = days
    ? DAY_ORDER.filter((d) => days.includes(d)).map((d) => DAY_LABELS_TH[d]).join(",")
    : "ทุกวัน";
  const timeLabel = start && end ? `${start}-${end}` : "ทุกเวลา";

  return { text: `${daysLabel} ${timeLabel}`, hasWindow: true };
}

// =================================================================
// SECTION 01 — ห้อง / กุญแจ
// =================================================================

const roomsTbody = document.getElementById("rooms-tbody");
const formRoomCreate = document.getElementById("form-room-create");
const createFormBwEditor = formRoomCreate.querySelector("[data-borrow-window-editor]");
bindDayToggle(createFormBwEditor);

createFormBwEditor.querySelector("[data-bw-clear]").addEventListener("click", () => {
  setBorrowWindowEditorValue(createFormBwEditor, null);
});

async function loadRooms() {
  // renderRoomsTable() แทนที่ innerHTML ทั้งตาราง ปุ่มที่ popover ผูก
  // ตำแหน่งไว้ (bwPopoverTriggerBtn) จะหลุดจาก DOM ทันที — ปิด popover
  // ก่อนเสมอกันมันค้างลอยอยู่โดยไม่มีปุ่มอ้างอิงจริงแล้ว (ฟังก์ชัน/
  // ตัวแปรนี้ประกาศอยู่ท้ายไฟล์ แต่ loadRooms() ถูกเรียกจริงหลัง script
  // ทั้งไฟล์รันจบแล้วเท่านั้น — ปลอดภัยจาก temporal dead zone)
  if (bwPopoverRoomId !== null) {
    closeBwPopover();
  }

  const { ok, data } = await apiGet("/api/admin/rooms");

  if (!ok) {
    roomsTbody.innerHTML = `<tr class="row-empty"><td colspan="7">${escapeHtml(data.message || "โหลดข้อมูลไม่สำเร็จ")}</td></tr>`;
    return;
  }

  state.rooms = data.rooms || [];
  renderRoomsTable();
}

// ปุ่มสรุปช่วงเวลายืมในตาราง — ตัวปุ่มเองเก็บ data-id ไว้ให้ event
// delegation ที่ roomsTbody หาแถว/ห้องที่ตรงกันได้ตอนคลิกเปิด popover
function renderBorrowWindowCell(room) {
  const { text, hasWindow } = formatBorrowWindowSummary(room);
  return `
    <button type="button" class="bw-summary-btn ${hasWindow ? "has-window" : ""}" data-action="edit-borrow-window" data-id="${room.id}">
      ${escapeHtml(text)}
    </button>
  `;
}

function renderRoomsTable() {
  if (state.rooms.length === 0) {
    roomsTbody.innerHTML = `<tr class="row-empty"><td colspan="7">ยังไม่มีห้อง/กุญแจในระบบ — เพิ่มรายการแรกด้านบน</td></tr>`;
    return;
  }

  roomsTbody.innerHTML = state.rooms
    .map((room) => {
      // [Fix] เดิมเทียบ room.is_active !== false ซึ่งเป็น true เสมอถ้า
      // backend ส่ง is_active มาเป็นเลข 0 (ไม่ใช่ boolean false) — mysql2
      // มักคืนคอลัมน์ TINYINT(1) เป็น 0/1 ไม่ใช่ boolean เสมอไป ทำให้ปุ่ม
      // "ปิดใช้งาน" กดสำเร็จจริงฝั่ง DB แต่ตารางไม่เคยโชว์สถานะปิดเลย
      // ใช้ !! บังคับแปลงเป็น boolean ตรงๆ กันปัญหา type mismatch นี้
      const isActive = !!room.is_active;
      const thumbHtml = room.image_url
        ? `<img class="room-thumb" src="${escapeHtml(room.image_url)}" alt="${escapeHtml(room.room_name)}" />`
        : `<div class="room-thumb-placeholder">ไม่มีรูป</div>`;

      return `
        <tr data-room-id="${room.id}">
          <td>
            <div class="room-thumb-cell">
              ${thumbHtml}
              <label class="room-thumb-upload-label">
                ${room.image_url ? "เปลี่ยนรูป" : "เพิ่มรูป"}
                <input type="file" class="room-thumb-upload-input" data-action="upload-room-image" data-id="${room.id}" accept="image/*" />
              </label>
              <button type="button" class="room-thumb-manage-btn" data-action="manage-room-images" data-id="${room.id}" data-name="${escapeHtml(room.room_name)}">
                จัดการรูป (หลายรูป)
              </button>
            </div>
          </td>
          <td>
            <input class="edit-inline" data-field="room_name" value="${escapeHtml(room.room_name)}" />
          </td>
          <td>
            <input class="edit-inline" data-field="tag_uid" value="${escapeHtml(room.tag_uid || "")}" placeholder="ยังไม่ผูกแท็ก" />
          </td>
          <td>
            <input class="edit-inline" data-field="description" value="${escapeHtml(room.description || "")}" placeholder="—" />
          </td>
          <td>
            ${renderBorrowWindowCell(room)}
          </td>
          <td>
            <span class="pill ${isActive ? "pill--active" : "pill--inactive"}">${isActive ? "ใช้งานอยู่" : "ปิดใช้งาน"}</span>
          </td>
          <td class="cell-actions">
            <button class="btn btn--ghost btn--sm" data-action="toggle-room-active" data-id="${room.id}" data-active="${isActive}">
              ${isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
            </button>
            <button class="btn btn--danger btn--sm" data-action="delete-room" data-id="${room.id}">ลบ</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

formRoomCreate.addEventListener("submit", async (e) => {
  e.preventDefault();
  const submitBtn = formRoomCreate.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  const roomName = document.getElementById("room-name").value.trim();
  const tagUid = document.getElementById("room-tag").value.trim();
  const description = document.getElementById("room-desc").value.trim();
  const imageInput = document.getElementById("room-image");
  const imageFile = imageInput.files && imageInput.files[0] ? imageInput.files[0] : null;

  const bwResult = readBorrowWindowEditorValue(createFormBwEditor);
  if (!bwResult.ok) {
    showToast(bwResult.message, "error");
    submitBtn.disabled = false;
    return;
  }

  const { ok, data } = await apiPost("/api/admin/rooms", {
    roomName,
    tagUid,
    description,
    ...bwResult.payload,
  });

  if (ok) {
    // ถ้ามีเลือกไฟล์รูปมาด้วย อัปโหลดต่อทันทีให้ห้องที่เพิ่งสร้าง
    if (imageFile && data.room && data.room.id) {
      const fd = new FormData();
      fd.append("image", imageFile);
      const uploadResult = await apiUpload(`/api/admin/rooms/${data.room.id}/image`, fd);
      if (!uploadResult.ok) {
        showToast("เพิ่มห้องสำเร็จ แต่อัปโหลดรูปไม่สำเร็จ — ลองอัปโหลดใหม่ในตารางด้านล่าง", "error");
      } else {
        showToast("เพิ่มห้อง/กุญแจพร้อมรูปสำเร็จ", "ok");
      }
    } else {
      showToast("เพิ่มห้อง/กุญแจสำเร็จ", "ok");
    }
    formRoomCreate.reset();
    setBorrowWindowEditorValue(createFormBwEditor, null);
    await loadRooms();
  } else {
    showToast(data.message || "เพิ่มห้องไม่สำเร็จ", "error");
  }

  submitBtn.disabled = false;
});

// แก้ไขแบบ inline: บันทึกตอน blur (ออกจากช่อง) ถ้าค่าจริงเปลี่ยน
roomsTbody.addEventListener(
  "blur",
  async (e) => {
    if (!e.target.classList || !e.target.classList.contains("edit-inline")) return;

    const row = e.target.closest("tr");
    const roomId = row.dataset.roomId;
    const field = e.target.dataset.field;
    const value = e.target.value.trim();

    const room = state.rooms.find((r) => String(r.id) === String(roomId));
    if (!room) return;

    const currentValue = room[field] || "";
    if (value === currentValue) return; // ไม่เปลี่ยนแปลง ไม่ต้องยิง request

    const payload = {};
    if (field === "room_name") payload.roomName = value;
    if (field === "tag_uid") payload.tagUid = value;
    if (field === "description") payload.description = value;

    const { ok, data } = await apiPatch(`/api/admin/rooms/${roomId}`, payload);

    if (ok) {
      showToast("บันทึกการแก้ไขแล้ว", "ok");
      await loadRooms();
    } else {
      showToast(data.message || "แก้ไขไม่สำเร็จ", "error");
      e.target.value = currentValue; // คืนค่าเดิมถ้า error
    }
  },
  true
);

// อัปโหลด/เปลี่ยนรูปห้องแบบ inline ในตาราง (input[type=file] ซ่อนอยู่
// หลัง label "เพิ่มรูป"/"เปลี่ยนรูป")
roomsTbody.addEventListener("change", async (e) => {
  const input = e.target.closest('input[data-action="upload-room-image"]');
  if (!input) return;

  const file = input.files && input.files[0];
  if (!file) return;

  const roomId = input.dataset.id;
  const label = input.closest(".room-thumb-upload-label");
  const originalText = label ? label.firstChild.textContent : "";
  if (label) label.firstChild.textContent = "กำลังอัปโหลด...";

  const fd = new FormData();
  fd.append("image", file);

  const { ok, data } = await apiUpload(`/api/admin/rooms/${roomId}/image`, fd);

  if (ok) {
    showToast("อัปโหลดรูปห้องสำเร็จ", "ok");
    await loadRooms();
  } else {
    showToast(data.message || "อัปโหลดรูปไม่สำเร็จ", "error");
    if (label) label.firstChild.textContent = originalText;
  }
});

// -------------------------------------------------------------
// Popover แก้ไขช่วงเวลายืม — เปลือกเดียวใน DOM (#bw-popover) ใช้ซ้ำทุก
// แถว ย้ายตำแหน่งไปลอยใต้ปุ่มที่กดทุกครั้งที่เปิด เหมือน pattern ของ
// confirm-dialog (สร้าง/bind event ครั้งเดียว, เก็บ "ห้องที่กำลังแก้อยู่"
// ไว้ในตัวแปรปิด (closure) ระดับโมดูลแทนที่จะสร้าง element ใหม่ทุกครั้ง)
// -------------------------------------------------------------
const bwPopoverEl = document.getElementById("bw-popover");
bindDayToggle(bwPopoverEl);

let bwPopoverRoomId = null;
let bwPopoverTriggerBtn = null;

function closeBwPopover() {
  bwPopoverEl.classList.remove("is-visible");
  document.removeEventListener("mousedown", onBwPopoverOutsideClick, true);
  document.removeEventListener("keydown", onBwPopoverKeydown);
  bwPopoverRoomId = null;
  bwPopoverTriggerBtn = null;
}

function onBwPopoverOutsideClick(e) {
  if (bwPopoverEl.contains(e.target)) return;
  closeBwPopover();
}

function onBwPopoverKeydown(e) {
  if (e.key === "Escape") closeBwPopover();
}

function openBwPopover(triggerBtn, room) {
  bwPopoverRoomId = room.id;
  bwPopoverTriggerBtn = triggerBtn;

  setBorrowWindowEditorValue(bwPopoverEl, room);

  // จัดตำแหน่งลอยใต้ปุ่มที่กด (fixed positioning เทียบกับ viewport
  // เพราะ #bw-popover ประกาศ position:fixed ใน CSS — ใช้ค่าจาก
  // getBoundingClientRect ตรงๆ ได้เลย ไม่ต้องบวก scrollX/Y เอง)
  const rect = triggerBtn.getBoundingClientRect();
  bwPopoverEl.style.top = `${rect.bottom + 8}px`;
  bwPopoverEl.style.left = `${Math.min(rect.left, window.innerWidth - 320)}px`;

  bwPopoverEl.classList.add("is-visible");

  // ใช้ capture phase + setTimeout กันคลิกที่เปิด popover ตัวมันเอง
  // ไปโดน outside-click handler ทันทีในรอบเดียวกัน (event bubbling
  // เดียวกับที่ทำให้เปิดปิดสลับกันไปมาถ้าไม่กันจุดนี้)
  setTimeout(() => {
    document.addEventListener("mousedown", onBwPopoverOutsideClick, true);
    document.addEventListener("keydown", onBwPopoverKeydown);
  }, 0);
}

bwPopoverEl.querySelector("[data-bw-clear]").addEventListener("click", () => {
  setBorrowWindowEditorValue(bwPopoverEl, null);
});

bwPopoverEl.querySelector("[data-bw-cancel]").addEventListener("click", () => {
  closeBwPopover();
});

bwPopoverEl.querySelector("[data-bw-save]").addEventListener("click", async () => {
  const roomId = bwPopoverRoomId;
  if (!roomId) return;

  const bwResult = readBorrowWindowEditorValue(bwPopoverEl);
  if (!bwResult.ok) {
    showToast(bwResult.message, "error");
    return;
  }

  const saveBtn = bwPopoverEl.querySelector("[data-bw-save]");
  saveBtn.disabled = true;

  const { ok, data } = await apiPatch(`/api/admin/rooms/${roomId}`, bwResult.payload);

  saveBtn.disabled = false;

  if (ok) {
    showToast("บันทึกช่วงเวลายืมแล้ว", "ok");
    closeBwPopover();
    await loadRooms();
  } else {
    showToast(data.message || "บันทึกไม่สำเร็จ", "error");
  }
});

roomsTbody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const id = btn.dataset.id;

  if (btn.dataset.action === "edit-borrow-window") {
    const room = state.rooms.find((r) => String(r.id) === String(id));
    if (!room) return;
    if (bwPopoverRoomId === room.id) {
      closeBwPopover();
    } else {
      openBwPopover(btn, room);
    }
    return;
  }

  if (btn.dataset.action === "toggle-room-active") {
    const currentlyActive = btn.dataset.active === "true";
    btn.disabled = true;
    const { ok, data } = await apiPatch(`/api/admin/rooms/${id}`, { isActive: !currentlyActive });
    if (ok) {
      showToast(currentlyActive ? "ปิดใช้งานห้องแล้ว" : "เปิดใช้งานห้องแล้ว", "ok");
      await loadRooms();
    } else {
      showToast(data.message || "เปลี่ยนสถานะไม่สำเร็จ", "error");
      btn.disabled = false;
    }
    return;
  }

  if (btn.dataset.action === "delete-room") {
    const room = state.rooms.find((r) => String(r.id) === String(id));
    const label = room ? room.room_name : "ห้องนี้";
    const confirmed = await showConfirm(`ยืนยันลบ "${label}"? ประวัติการยืม-คืนที่เกี่ยวข้องจะถูกลบไปด้วย และกู้คืนไม่ได้`);
    if (!confirmed) return;

    btn.disabled = true;
    const { ok, data } = await apiDelete(`/api/admin/rooms/${id}`);
    if (ok) {
      showToast("ลบห้อง/กุญแจแล้ว", "ok");
      await loadRooms();
    } else {
      showToast(data.message || "ลบไม่สำเร็จ", "error");
      btn.disabled = false;
    }
  }
});

// =================================================================
// Modal จัดการรูปหลายรูปต่อห้อง (Task 2b)
// -----------------------------------------------------------------
// เปิดจากปุ่ม "จัดการรูป (หลายรูป)" ในตาราง SECTION 01 — ใช้ endpoint
// ต่อไปนี้:
//   - อ่านรายการรูปปัจจุบัน: GET /api/keys/status (public, ไม่ต้อง
//     auth) ซึ่ง embed room_images(id, image_url, sort_order) มาด้วย
//     อยู่แล้ว — ไม่มี endpoint แอดมินโดยเฉพาะสำหรับ "ดึงรูปของห้อง
//     เดียว" (มีแต่ POST เพิ่ม/DELETE ลบ/PATCH reorder ไม่มี GET)
//     จึงยืมมาใช้จุดนี้แทนที่จะเพิ่ม backend endpoint ใหม่
//     ข้อจำกัดที่ตามมา: endpoint นี้ filter is_active=true เท่านั้น
//     (ดู routes/keys.js) — ถ้าห้องถูกปิดใช้งานอยู่ (is_active=false)
//     จะไม่มีใน response นี้เลย โมดอลจะโชว์ข้อความแจ้งเตือนแทนกริดว่าง
//     เปล่าที่ไม่มีคำอธิบาย (ดู loadManagedImages ด้านล่าง)
//   - เพิ่มรูป: POST /api/admin/rooms/:id/images (field "images", ได้
//     หลายไฟล์พร้อมกัน สูงสุด 10 ไฟล์/ครั้ง)
//   - ลบรูป: DELETE /api/admin/rooms/:id/images/:imageId
//   - จัดลำดับใหม่: PATCH /api/admin/rooms/:id/images/reorder
//     body { order: [imageId, ...] } ต้องส่งครบทุกรูปของห้องนั้น
//
// Drag-to-reorder ใช้ HTML5 native drag-and-drop (draggable="true" +
// dragstart/dragover/drop) ไม่พึ่ง library ภายนอก — state ระหว่างลาก
// เก็บแค่ index ที่กำลังลากอยู่ใน closure ตัวแปรเดียว (ไม่ต้องซับซ้อน
// กว่านี้ เพราะกริดรูปมีจำนวนน้อย ไม่ใช่ list ยาวเป็นร้อยรายการ)
// -------------------------------------------------------------
const imagesModalOverlay = document.getElementById("images-modal-overlay");
const imagesModalGrid = document.getElementById("images-modal-grid");
const imagesModalTitle = document.getElementById("images-modal-title");
const imagesModalClose = document.getElementById("images-modal-close");
const imagesModalUploadInput = document.getElementById("images-modal-upload-input");
const imagesModalUploadLabel = document.getElementById("images-modal-upload-label");

let managedRoomId = null;
let managedRoomName = "";
let managedImages = []; // [{ id, image_url, sort_order }, ...] เรียงตาม sort_order เสมอ
let dragFromIndex = null;

function openImagesModal(roomId, roomName) {
  managedRoomId = roomId;
  managedRoomName = roomName;
  imagesModalTitle.textContent = `จัดการรูปภาพ — ${roomName}`;
  imagesModalGrid.innerHTML = `<div class="images-modal-empty">กำลังโหลด...</div>`;
  imagesModalOverlay.classList.add("is-visible");
  document.addEventListener("keydown", onImagesModalKeydown);
  loadManagedImages();
}

function closeImagesModal() {
  imagesModalOverlay.classList.remove("is-visible");
  document.removeEventListener("keydown", onImagesModalKeydown);
  managedRoomId = null;
  managedImages = [];
}

function onImagesModalKeydown(e) {
  if (e.key === "Escape") closeImagesModal();
}

imagesModalClose.addEventListener("click", closeImagesModal);
imagesModalOverlay.addEventListener("click", (e) => {
  if (e.target === imagesModalOverlay) closeImagesModal();
});

// ดึงรายการรูปปัจจุบันของห้องที่กำลังจัดการอยู่ จาก public endpoint
// (ดูหมายเหตุยาวด้านบนหัว section นี้ — ไม่มี endpoint แอดมินโดยเฉพาะ)
async function loadManagedImages() {
  try {
    const res = await fetch("/api/keys/status");
    const data = await res.json();

    if (!res.ok || !data.ok) {
      imagesModalGrid.innerHTML = `<div class="images-modal-empty">โหลดรายการรูปไม่สำเร็จ — ลองปิดแล้วเปิดใหม่</div>`;
      return;
    }

    const matched = (data.keys || []).find((k) => String(k.id) === String(managedRoomId));

    if (!matched) {
      // ห้องนี้ไม่อยู่ใน response — สาเหตุที่เป็นไปได้มากสุดคือห้องถูก
      // ปิดใช้งานอยู่ (/api/keys/status กรอง is_active=true เท่านั้น)
      // ไม่ใช่ว่าห้องไม่มีอยู่จริง (เพิ่งเห็นในตารางเมื่อกี้ก่อนกดปุ่ม)
      const room = state.rooms.find((r) => String(r.id) === String(managedRoomId));
      const isInactive = room && room.is_active === false;
      imagesModalGrid.innerHTML = `<div class="images-modal-empty">${
        isInactive
          ? "ห้องนี้ถูกปิดใช้งานอยู่ — เปิดใช้งานห้องก่อนเพื่อดู/จัดการรูปภาพ"
          : "ไม่พบข้อมูลรูปภาพของห้องนี้"
      }</div>`;
      managedImages = [];
      return;
    }

    managedImages = (matched.room_images || []).slice().sort((a, b) => a.sort_order - b.sort_order);
    renderManagedImagesGrid();
  } catch (err) {
    imagesModalGrid.innerHTML = `<div class="images-modal-empty">เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง</div>`;
  }
}

function renderManagedImagesGrid() {
  if (managedImages.length === 0) {
    imagesModalGrid.innerHTML = `<div class="images-modal-empty">ห้องนี้ยังไม่มีรูปภาพ — เพิ่มรูปด้านล่าง</div>`;
    return;
  }

  imagesModalGrid.innerHTML = managedImages
    .map(
      (img, index) => `
        <div class="images-modal-tile" draggable="true" data-index="${index}" data-image-id="${img.id}">
          <img class="images-modal-tile-img" src="${escapeHtml(img.image_url)}" alt="รูปที่ ${index + 1}" />
          <span class="images-modal-tile-order ${index === 0 ? "is-primary" : ""}">${
        index === 0 ? "หลัก" : index + 1
      }</span>
          <button type="button" class="images-modal-tile-delete" data-action="delete-room-image" data-image-id="${img.id}" aria-label="ลบรูปนี้">&times;</button>
        </div>
      `
    )
    .join("");
}

// -------------------------------------------------------------
// เพิ่มรูป — เลือกไฟล์แล้วอัปโหลดทันที (multi-file input)
// -------------------------------------------------------------
imagesModalUploadInput.addEventListener("change", async () => {
  const files = imagesModalUploadInput.files;
  if (!files || files.length === 0) return;

  if (!managedRoomId) return;

  const originalLabel = imagesModalUploadLabel.textContent;
  imagesModalUploadLabel.textContent = "กำลังอัปโหลด...";

  const fd = new FormData();
  Array.from(files).forEach((file) => fd.append("images", file));

  const { ok, data } = await apiUpload(`/api/admin/rooms/${managedRoomId}/images`, fd);

  imagesModalUploadLabel.textContent = originalLabel;
  imagesModalUploadInput.value = ""; // เคลียร์ input กันเลือกไฟล์ชุดเดิมซ้ำแล้วไม่ trigger change

  if (ok) {
    showToast(`เพิ่มรูปภาพสำเร็จ (${data.images ? data.images.length : files.length} ไฟล์)`, "ok");
    await loadManagedImages();
    await loadRooms(); // อัปเดต thumbnail หลักในตารางด้วย เผื่อห้องนี้ยังไม่เคยมีรูปมาก่อน
  } else {
    showToast(data.message || "อัปโหลดรูปไม่สำเร็จ", "error");
  }
});

// -------------------------------------------------------------
// ลบรูป — event delegation บนกริด (tile ถูก re-render ทุกครั้ง)
// -------------------------------------------------------------
imagesModalGrid.addEventListener("click", async (e) => {
  const btn = e.target.closest('button[data-action="delete-room-image"]');
  if (!btn) return;

  const imageId = btn.dataset.imageId;
  if (!managedRoomId || !imageId) return;

  btn.disabled = true;

  const { ok, data } = await apiDelete(`/api/admin/rooms/${managedRoomId}/images/${imageId}`);

  if (ok) {
    showToast("ลบรูปภาพแล้ว", "ok");
    await loadManagedImages();
    await loadRooms();
  } else {
    showToast(data.message || "ลบรูปไม่สำเร็จ", "error");
    btn.disabled = false;
  }
});

// -------------------------------------------------------------
// Drag-to-reorder — native HTML5 DnD บน tile แต่ละใบ
// dragstart: จำ index ที่เริ่มลาก
// dragover: ต้อง preventDefault เสมอ (ไม่งั้น drop event จะไม่ยิง) +
//   ใส่ class บอกตำแหน่งที่จะวาง (visual feedback)
// drop: สลับตำแหน่งใน managedImages array ตาม index ต้นทาง/ปลายทาง
//   แล้ว render ใหม่ทันที (optimistic) ก่อนค่อยยิง PATCH reorder จริง
//   ไปเก็บที่ server — ถ้า PATCH ล้มเหลว โหลดข้อมูลจริงจาก server
//   กลับมาทับ (ไม่ manual revert เอง กันเคส state เพี้ยนไปมากกว่าเดิม)
// -------------------------------------------------------------
imagesModalGrid.addEventListener("dragstart", (e) => {
  const tile = e.target.closest(".images-modal-tile");
  if (!tile) return;
  dragFromIndex = parseInt(tile.dataset.index, 10);
  tile.classList.add("is-dragging");
  e.dataTransfer.effectAllowed = "move";
});

imagesModalGrid.addEventListener("dragend", (e) => {
  const tile = e.target.closest(".images-modal-tile");
  if (tile) tile.classList.remove("is-dragging");
  imagesModalGrid.querySelectorAll(".is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
});

imagesModalGrid.addEventListener("dragover", (e) => {
  const tile = e.target.closest(".images-modal-tile");
  if (!tile) return;
  e.preventDefault(); // จำเป็น — ไม่งั้น browser จะไม่ยิง drop event ให้เลย
  e.dataTransfer.dropEffect = "move";

  imagesModalGrid.querySelectorAll(".is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
  if (parseInt(tile.dataset.index, 10) !== dragFromIndex) {
    tile.classList.add("is-drop-target");
  }
});

imagesModalGrid.addEventListener("drop", async (e) => {
  const tile = e.target.closest(".images-modal-tile");
  if (!tile || dragFromIndex === null) return;
  e.preventDefault();

  const toIndex = parseInt(tile.dataset.index, 10);
  if (toIndex === dragFromIndex) return;

  // ย้ายตำแหน่งใน array (splice ออกจากที่เดิม แทรกที่ใหม่)
  const moved = managedImages.splice(dragFromIndex, 1)[0];
  managedImages.splice(toIndex, 0, moved);
  dragFromIndex = null;

  renderManagedImagesGrid(); // optimistic update ให้เห็นผลทันที ไม่ต้องรอ network

  const order = managedImages.map((img) => img.id);
  const { ok, data } = await apiPatch(`/api/admin/rooms/${managedRoomId}/images/reorder`, { order });

  if (ok) {
    showToast("จัดลำดับรูปภาพแล้ว", "ok");
    await loadRooms(); // thumbnail หลักในตารางอาจเปลี่ยนถ้าลำดับที่ 1 เปลี่ยน
  } else {
    showToast(data.message || "จัดลำดับไม่สำเร็จ — โหลดข้อมูลเดิมกลับมาแล้ว", "error");
    await loadManagedImages(); // ดึงของจริงจาก server กลับมาทับ optimistic state ที่ผิดพลาด
  }
});

// เปิด modal จากปุ่มในตาราง SECTION 01 — เพิ่ม case นี้เข้าไปใน
// roomsTbody click handler เดิม (ผูก addEventListener เพิ่มอีกตัว
// แทนที่จะแก้ handler เดิมโดยตรง เพื่อไม่ต้องแก้โครงสร้าง if-chain
// ที่มีอยู่แล้วในนั้น — event delegation รองรับหลาย listener ซ้อนกัน
// บน container เดียวกันได้ปกติ ไม่ชนกัน)
roomsTbody.addEventListener("click", (e) => {
  const btn = e.target.closest('button[data-action="manage-room-images"]');
  if (!btn) return;
  openImagesModal(btn.dataset.id, btn.dataset.name);
});

// =================================================================
// SECTION 02 — แท็กครู
// =================================================================

const teachersTbody = document.getElementById("teachers-tbody");

async function loadTeacherTags() {
  const { ok, data } = await apiGet("/api/admin/teacher-tags");

  if (!ok) {
    teachersTbody.innerHTML = `<tr class="row-empty"><td colspan="5">${escapeHtml(data.message || "โหลดข้อมูลไม่สำเร็จ")}</td></tr>`;
    return;
  }

  const teachers = data.teachers || [];
  renderTeachersTable(teachers);
}

function renderTeachersTable(teachers) {
  if (teachers.length === 0) {
    teachersTbody.innerHTML = `<tr class="row-empty"><td colspan="5">ยังไม่มีครูในระบบ (ครูต้องสมัครบัญชีเองก่อนที่หน้า login)</td></tr>`;
    return;
  }

  teachersTbody.innerHTML = teachers
    .map((teacher) => {
      const tag = Array.isArray(teacher.teacher_tags) ? teacher.teacher_tags[0] : teacher.teacher_tags;
      const hasTag = !!(tag && tag.tag_uid);

      return `
        <tr data-teacher-id="${teacher.id}">
          <td>${escapeHtml(teacher.name)}</td>
          <td>${escapeHtml(teacher.department || "—")}</td>
          <td>${escapeHtml(teacher.teacher_code)}</td>
          <td>
            <div class="tag-edit-row">
              <input type="text" class="tag-input" value="${escapeHtml(tag ? tag.tag_uid : "")}" placeholder="ยังไม่มีแท็ก" />
            </div>
          </td>
          <td class="cell-actions">
            <button class="btn btn--admin btn--sm" data-action="save-teacher-tag" data-id="${teacher.id}" data-has-tag="${hasTag}">
              ${hasTag ? "บันทึก" : "ผูกแท็ก"}
            </button>
            ${hasTag ? `<button class="btn btn--danger btn--sm" data-action="delete-teacher-tag" data-id="${teacher.id}">ลบแท็ก</button>` : ""}
          </td>
        </tr>
      `;
    })
    .join("");
}

teachersTbody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const teacherId = btn.dataset.id;
  const row = btn.closest("tr");

  if (btn.dataset.action === "save-teacher-tag") {
    const input = row.querySelector(".tag-input");
    const tagUid = input.value.trim();

    if (!tagUid) {
      showToast("กรุณากรอกเลขแท็ก", "error");
      return;
    }

    const hasTag = btn.dataset.hasTag === "true";
    btn.disabled = true;

    const { ok, data } = hasTag
      ? await apiPatch(`/api/admin/teacher-tags/${teacherId}`, { tagUid })
      : await apiPost("/api/admin/teacher-tags", { teacherId, tagUid });

    if (ok) {
      showToast(hasTag ? "แก้ไขเลขแท็กแล้ว" : "ผูกแท็กสำเร็จ", "ok");
      await loadTeacherTags();
    } else {
      showToast(data.message || "บันทึกไม่สำเร็จ", "error");
      btn.disabled = false;
    }
    return;
  }

  if (btn.dataset.action === "delete-teacher-tag") {
    const confirmed = await showConfirm("ยืนยันลบแท็กของครูคนนี้?");
    if (!confirmed) return;

    btn.disabled = true;
    const { ok, data } = await apiDelete(`/api/admin/teacher-tags/${teacherId}`);
    if (ok) {
      showToast("ลบแท็กแล้ว", "ok");
      await loadTeacherTags();
    } else {
      showToast(data.message || "ลบไม่สำเร็จ", "error");
      btn.disabled = false;
    }
  }
});

// =================================================================
// SECTION 03 — สถานะกุญแจ
// =================================================================

const keysTbody = document.getElementById("keys-tbody");
const keysFilterStatus = document.getElementById("keys-filter-status");

let allKeysCache = [];

async function loadKeysStatus() {
  const { ok, data } = await apiGet("/api/admin/keys/status");

  if (!ok) {
    keysTbody.innerHTML = `<tr class="row-empty"><td colspan="5">${escapeHtml(data.message || "โหลดสถานะกุญแจไม่สำเร็จ")}</td></tr>`;
    return;
  }

  allKeysCache = data.keys || [];
  renderKeysTable();
}

function renderKeysTable() {
  const filterVal = keysFilterStatus.value;
  const filtered = filterVal ? allKeysCache.filter((k) => k.status === filterVal) : allKeysCache;

  if (filtered.length === 0) {
    keysTbody.innerHTML = `<tr class="row-empty"><td colspan="5">ไม่พบกุญแจที่ตรงกับเงื่อนไข</td></tr>`;
    return;
  }

  keysTbody.innerHTML = filtered
    .map((key) => {
      const isBorrowed = key.status === "borrowed";
      const holderName = isBorrowed && key.borrowed_by ? key.borrowed_by.name : "—";
      const thumbHtml = key.image_url
        ? `<img class="room-thumb" src="${escapeHtml(key.image_url)}" alt="${escapeHtml(key.room_name)}" />`
        : `<div class="room-thumb-placeholder">ไม่มีรูป</div>`;

      return `
        <tr>
          <td>${thumbHtml}</td>
          <td>${escapeHtml(key.room_name)}</td>
          <td>${escapeHtml(key.tag_uid || "ยังไม่ผูกแท็ก")}</td>
          <td>
            <span class="pill ${isBorrowed ? "pill--borrowed" : "pill--available"}">
              ${isBorrowed ? "ถูกยืมอยู่" : "ว่าง"}
            </span>
          </td>
          <td>${escapeHtml(holderName)}</td>
          <td>${isBorrowed ? escapeHtml(formatDateTime(key.borrowed_at)) : "—"}</td>
        </tr>
      `;
    })
    .join("");
}

keysFilterStatus.addEventListener("change", renderKeysTable);

// =================================================================
// SECTION 04 — ประวัติยืม-คืน
// =================================================================

const historyTbody = document.getElementById("history-tbody");
const historyFilterAction = document.getElementById("history-filter-action");

async function loadKeysHistory() {
  const action = historyFilterAction.value;
  const url = action ? `/api/admin/keys/history?action=${encodeURIComponent(action)}` : "/api/admin/keys/history";

  const { ok, data } = await apiGet(url);

  if (!ok) {
    historyTbody.innerHTML = `<tr class="row-empty"><td colspan="4">${escapeHtml(data.message || "โหลดประวัติไม่สำเร็จ")}</td></tr>`;
    return;
  }

  renderHistoryTable(data.logs || []);
}

function renderHistoryTable(logs) {
  if (logs.length === 0) {
    historyTbody.innerHTML = `<tr class="row-empty"><td colspan="4">ยังไม่มีประวัติการยืม-คืน</td></tr>`;
    return;
  }

  historyTbody.innerHTML = logs
    .map((log) => {
      const roomName = log.room_tags ? log.room_tags.room_name : "—";
      const teacherName = log.teachers ? log.teachers.name : "—";
      const actionLabel = log.action === "borrow" ? "ยืม" : "คืน";
      const actionClass = log.action === "borrow" ? "pill--borrowed" : "pill--available";

      return `
        <tr>
          <td>${escapeHtml(roomName)}</td>
          <td>${escapeHtml(teacherName)}</td>
          <td><span class="pill ${actionClass}">${actionLabel}</span></td>
          <td>${escapeHtml(formatDateTime(log.acted_at))}</td>
        </tr>
      `;
    })
    .join("");
}

historyFilterAction.addEventListener("change", loadKeysHistory);

// -------------------------------------------------------------
// ปุ่ม export ประวัติยืม-คืน (CSV/DOCX)
// -----------------------------------------------------------------
// endpoint /api/admin/keys/history/export ต้อง auth (JWT) เหมือน
// /api/admin/* ทุกจุด — ใช้ <a href> ธรรมดาไม่ได้เพราะแนบ Authorization
// header ไม่ได้ ต้อง fetch ด้วยมือ (คล้าย apiFetch แต่ตั้งใจไม่ใช้
// apiFetch เดิมตรงๆ เพราะ apiFetch คาดหวัง response เป็น JSON เสมอ
// (เรียก res.json() ตรงๆ) ในขณะที่ endpoint นี้ตอบกลับเป็นไฟล์ดิบ
// (CSV/DOCX blob) — ใช้ path คล้าย apiUpload ที่คุยกับ response แบบ
// binary ได้แทน) แล้วอ่านเป็น Blob มา trigger download ด้วย object URL
// ชั่วคราว ส่ง filter action ปัจจุบันของตาราง (เหมือนที่ loadKeysHistory
// ใช้) ไปด้วย เพื่อให้ไฟล์ที่ได้ตรงกับสิ่งที่กำลังดูอยู่บนจอ
// -------------------------------------------------------------
const btnExportHistory = document.getElementById("btn-export-history");
const historyExportFormat = document.getElementById("history-export-format");

function buildExportFilename(disposition, fallback) {
  // ดึงชื่อไฟล์จาก Content-Disposition header ที่ export.js เซ็ตไว้
  // (attachment; filename="key-history-YYYY-MM-DD.csv") กันเผื่อ parse
  // ไม่ได้ (header หาย/รูปแบบเปลี่ยน) ใช้ fallback name แทน ไม่ throw
  if (!disposition) return fallback;
  const match = /filename="?([^"]+)"?/.exec(disposition);
  return match ? match[1] : fallback;
}

btnExportHistory.addEventListener("click", async () => {
  const format = historyExportFormat.value;
  const action = historyFilterAction.value;

  const params = new URLSearchParams({ format });
  if (action) params.set("action", action);

  const token = getToken();
  if (!token) {
    goToLogin();
    return;
  }

  btnExportHistory.disabled = true;
  const originalLabel = btnExportHistory.textContent;
  btnExportHistory.textContent = "กำลังส่งออก...";

  try {
    const res = await fetch(`/api/admin/keys/history/export?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      goToLogin();
      return;
    }

    if (!res.ok) {
      // error กรณีนี้ response เป็น JSON (จาก express res.status().json())
      // ไม่ใช่ไฟล์ — parse แยกจาก success case ด้านล่าง
      let message = "ส่งออกไม่สำเร็จ";
      try {
        const errData = await res.json();
        message = errData.message || message;
      } catch (e) {
        // เงียบไว้ — ใช้ message default
      }
      showToast(message, "error");
      return;
    }

    const blob = await res.blob();
    const fallbackExt = format === "docx" ? "docx" : "csv";
    const filename = buildExportFilename(
      res.headers.get("Content-Disposition"),
      `key-history.${fallbackExt}`
    );

    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);

    showToast("ดาวน์โหลดไฟล์แล้ว", "ok");
  } catch (err) {
    showToast("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง", "error");
  } finally {
    btnExportHistory.disabled = false;
    btnExportHistory.textContent = originalLabel;
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
  await loadRooms();
})();
