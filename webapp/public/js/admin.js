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
// SECTION 01 — ห้อง / กุญแจ
// =================================================================

const roomsTbody = document.getElementById("rooms-tbody");
const formRoomCreate = document.getElementById("form-room-create");

async function loadRooms() {
  const { ok, data } = await apiGet("/api/admin/rooms");

  if (!ok) {
    roomsTbody.innerHTML = `<tr class="row-empty"><td colspan="5">${escapeHtml(data.message || "โหลดข้อมูลไม่สำเร็จ")}</td></tr>`;
    return;
  }

  state.rooms = data.rooms || [];
  renderRoomsTable();
}

function renderRoomsTable() {
  if (state.rooms.length === 0) {
    roomsTbody.innerHTML = `<tr class="row-empty"><td colspan="6">ยังไม่มีห้อง/กุญแจในระบบ — เพิ่มรายการแรกด้านบน</td></tr>`;
    return;
  }

  roomsTbody.innerHTML = state.rooms
    .map((room) => {
      const isActive = room.is_active !== false;
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

  const { ok, data } = await apiPost("/api/admin/rooms", { roomName, tagUid, description });

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

roomsTbody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const id = btn.dataset.id;

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
