// public/js/admin.js
// -----------------------------------------------------------------
// หน้าแอดมิน: ผูกกับ /api/admin/* ทั้งหมด (rooms, items, teacher-tags,
// assignments) ใช้ JWT จาก localStorage คีย์ "token" (เซ็ตไว้ตอน
// login.js เข้าสู่ระบบแอดมินสำเร็จ)
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
// Section switching (sidebar nav)
// -------------------------------------------------------------
const SECTION_META = {
  rooms: { index: "01", title: "ห้อง / กุญแจ" },
  items: { index: "02", title: "ของในห้อง" },
  teachers: { index: "03", title: "แท็กครู" },
  assignments: { index: "04", title: "มอบหมายดูแลห้อง" },
};

const navButtons = document.querySelectorAll(".admin-nav-btn");
const sectionPanels = document.querySelectorAll(".admin-section");
const sectionEyebrow = document.getElementById("section-eyebrow");
const sectionTitle = document.getElementById("section-title");

const LOADERS = {
  rooms: loadRooms,
  items: loadItemsSection,
  teachers: loadTeacherTags,
  assignments: loadAssignmentsSection,
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
  teachers: [],
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

function fillRoomOptions(selectEl, { includeAllOption } = {}) {
  const current = selectEl.value;
  selectEl.innerHTML = "";

  if (includeAllOption) {
    const optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = "ทุกห้อง";
    selectEl.appendChild(optAll);
  } else {
    const optPlaceholder = document.createElement("option");
    optPlaceholder.value = "";
    optPlaceholder.textContent = "— เลือกห้อง —";
    selectEl.appendChild(optPlaceholder);
  }

  state.rooms.forEach((room) => {
    const opt = document.createElement("option");
    opt.value = room.id;
    opt.textContent = room.room_name + (room.is_active === false ? " (ปิดใช้งาน)" : "");
    selectEl.appendChild(opt);
  });

  if (current && [...selectEl.options].some((o) => o.value === current)) {
    selectEl.value = current;
  }
}

function fillTeacherOptions(selectEl) {
  const current = selectEl.value;
  selectEl.innerHTML = '<option value="">— เลือกครู —</option>';

  state.teachers.forEach((teacher) => {
    const opt = document.createElement("option");
    opt.value = teacher.id;
    opt.textContent = teacher.name + (teacher.department ? ` (${teacher.department})` : "");
    selectEl.appendChild(opt);
  });

  if (current && [...selectEl.options].some((o) => o.value === current)) {
    selectEl.value = current;
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

  // อัปเดต dropdown ทุกที่ที่ผูกกับรายการห้อง
  fillRoomOptions(document.getElementById("item-room"));
  fillRoomOptions(document.getElementById("item-filter-room"), { includeAllOption: true });
  fillRoomOptions(document.getElementById("assign-room"));
}

function renderRoomsTable() {
  if (state.rooms.length === 0) {
    roomsTbody.innerHTML = `<tr class="row-empty"><td colspan="5">ยังไม่มีห้อง/กุญแจในระบบ — เพิ่มรายการแรกด้านบน</td></tr>`;
    return;
  }

  roomsTbody.innerHTML = state.rooms
    .map((room) => {
      const isActive = room.is_active !== false;
      return `
        <tr data-room-id="${room.id}">
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

  const { ok, data } = await apiPost("/api/admin/rooms", { roomName, tagUid, description });

  if (ok) {
    showToast("เพิ่มห้อง/กุญแจสำเร็จ", "ok");
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
    const confirmed = window.confirm(
      `ยืนยันลบ "${label}"?\nของและรายการมอบหมายครูในห้องนี้จะถูกลบไปด้วย และกู้คืนไม่ได้`
    );
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
// SECTION 02 — ของในห้อง
// =================================================================

const itemsTbody = document.getElementById("items-tbody");
const formItemCreate = document.getElementById("form-item-create");
const itemFilterRoom = document.getElementById("item-filter-room");

async function loadItemsSection() {
  // ห้องต้องพร้อมก่อน (ใช้ทำ dropdown + แสดงชื่อห้องในตาราง)
  if (state.rooms.length === 0) {
    await loadRooms();
  }
  await loadItems();
}

async function loadItems() {
  const roomTagId = itemFilterRoom.value;
  const url = roomTagId ? `/api/admin/items?roomTagId=${encodeURIComponent(roomTagId)}` : "/api/admin/items";

  const { ok, data } = await apiGet(url);

  if (!ok) {
    itemsTbody.innerHTML = `<tr class="row-empty"><td colspan="4">${escapeHtml(data.message || "โหลดข้อมูลไม่สำเร็จ")}</td></tr>`;
    return;
  }

  renderItemsTable(data.items || []);
}

function renderItemsTable(items) {
  if (items.length === 0) {
    itemsTbody.innerHTML = `<tr class="row-empty"><td colspan="4">ยังไม่มีของในระบบ — เพิ่มรายการแรกด้านบน</td></tr>`;
    return;
  }

  itemsTbody.innerHTML = items
    .map((item) => {
      const isBorrowed = item.status === "borrowed";
      const roomName = item.room_tags ? item.room_tags.room_name : "—";

      const roomSelectOptions = state.rooms
        .map(
          (room) =>
            `<option value="${room.id}" ${String(room.id) === String(item.room_tag_id) ? "selected" : ""}>${escapeHtml(room.room_name)}</option>`
        )
        .join("");

      return `
        <tr data-item-id="${item.id}">
          <td>
            <input class="edit-inline" data-field="item_name" value="${escapeHtml(item.item_name)}" ${isBorrowed ? "" : ""} />
          </td>
          <td>
            <select class="edit-inline" data-field="room_tag_id" ${isBorrowed ? "disabled title=\"กำลังถูกยืมอยู่ ย้ายห้องไม่ได้\"" : ""}>
              ${roomSelectOptions}
            </select>
          </td>
          <td>
            <span class="pill ${isBorrowed ? "pill--borrowed" : "pill--available"}">${isBorrowed ? "ถูกยืมอยู่" : "ว่าง"}</span>
          </td>
          <td class="cell-actions">
            <button class="btn btn--danger btn--sm" data-action="delete-item" data-id="${item.id}" ${isBorrowed ? "disabled title=\"กำลังถูกยืมอยู่ ลบไม่ได้\"" : ""}>ลบ</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

itemFilterRoom.addEventListener("change", loadItems);

formItemCreate.addEventListener("submit", async (e) => {
  e.preventDefault();
  const submitBtn = formItemCreate.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  const roomTagId = document.getElementById("item-room").value;
  const itemName = document.getElementById("item-name").value.trim();

  const { ok, data } = await apiPost("/api/admin/items", { roomTagId, itemName });

  if (ok) {
    showToast("เพิ่มของสำเร็จ", "ok");
    document.getElementById("item-name").value = "";
    await loadItems();
  } else {
    showToast(data.message || "เพิ่มของไม่สำเร็จ", "error");
  }

  submitBtn.disabled = false;
});

itemsTbody.addEventListener(
  "blur",
  async (e) => {
    if (!e.target.classList || !e.target.classList.contains("edit-inline")) return;
    if (e.target.tagName === "SELECT") return; // select ใช้ change event แทน

    const row = e.target.closest("tr");
    const itemId = row.dataset.itemId;
    const value = e.target.value.trim();

    if (!value) return;

    const { ok, data } = await apiPatch(`/api/admin/items/${itemId}`, { itemName: value });

    if (ok) {
      showToast("บันทึกการแก้ไขแล้ว", "ok");
    } else {
      showToast(data.message || "แก้ไขไม่สำเร็จ", "error");
      await loadItems();
    }
  },
  true
);

itemsTbody.addEventListener("change", async (e) => {
  if (e.target.dataset.field !== "room_tag_id") return;

  const row = e.target.closest("tr");
  const itemId = row.dataset.itemId;
  const roomTagId = e.target.value;

  const { ok, data } = await apiPatch(`/api/admin/items/${itemId}`, { roomTagId });

  if (ok) {
    showToast("ย้ายห้องสำเร็จ", "ok");
    await loadItems();
  } else {
    showToast(data.message || "ย้ายห้องไม่สำเร็จ", "error");
    await loadItems();
  }
});

itemsTbody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action='delete-item']");
  if (!btn) return;

  const id = btn.dataset.id;
  const confirmed = window.confirm("ยืนยันลบของชิ้นนี้? กู้คืนไม่ได้");
  if (!confirmed) return;

  btn.disabled = true;
  const { ok, data } = await apiDelete(`/api/admin/items/${id}`);
  if (ok) {
    showToast("ลบของแล้ว", "ok");
    await loadItems();
  } else {
    showToast(data.message || "ลบไม่สำเร็จ", "error");
    btn.disabled = false;
  }
});

// =================================================================
// SECTION 03 — แท็กครู
// =================================================================

const teachersTbody = document.getElementById("teachers-tbody");

async function loadTeacherTags() {
  const { ok, data } = await apiGet("/api/admin/teacher-tags");

  if (!ok) {
    teachersTbody.innerHTML = `<tr class="row-empty"><td colspan="5">${escapeHtml(data.message || "โหลดข้อมูลไม่สำเร็จ")}</td></tr>`;
    return;
  }

  const teachers = data.teachers || [];

  // เก็บไว้ใช้ dropdown ของ section มอบหมาย (teacher_tags เป็น array ใน response)
  state.teachers = teachers.map((t) => ({ id: t.id, name: t.name, department: t.department }));
  fillTeacherOptions(document.getElementById("assign-teacher"));

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
    const confirmed = window.confirm("ยืนยันลบแท็กของครูคนนี้?");
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
// SECTION 04 — มอบหมายครูดูแลห้อง
// =================================================================

const assignmentsTbody = document.getElementById("assignments-tbody");
const formAssignmentCreate = document.getElementById("form-assignment-create");
const assignTeacherSelect = document.getElementById("assign-teacher");
const assignQuotaHint = document.getElementById("assign-quota-hint");

async function loadAssignmentsSection() {
  if (state.rooms.length === 0) await loadRooms();
  if (state.teachers.length === 0) await loadTeacherTags();
  fillRoomOptions(document.getElementById("assign-room"));
  fillTeacherOptions(assignTeacherSelect);
  await loadAssignments();
}

async function loadAssignments() {
  const { ok, data } = await apiGet("/api/admin/assignments");

  if (!ok) {
    assignmentsTbody.innerHTML = `<tr class="row-empty"><td colspan="4">${escapeHtml(data.message || "โหลดข้อมูลไม่สำเร็จ")}</td></tr>`;
    return;
  }

  renderAssignmentsTable(data.assignments || []);
}

function renderAssignmentsTable(assignments) {
  if (assignments.length === 0) {
    assignmentsTbody.innerHTML = `<tr class="row-empty"><td colspan="4">ยังไม่มีการมอบหมายครูดูแลห้อง</td></tr>`;
    return;
  }

  assignmentsTbody.innerHTML = assignments
    .map((a) => {
      const teacherName = a.teachers ? a.teachers.name : "—";
      const teacherDept = a.teachers && a.teachers.department ? a.teachers.department : "";
      const roomName = a.room_tags ? a.room_tags.room_name : "—";

      return `
        <tr>
          <td>
            ${escapeHtml(teacherName)}
            ${teacherDept ? `<span class="cell-sub">${escapeHtml(teacherDept)}</span>` : ""}
          </td>
          <td>${escapeHtml(roomName)}</td>
          <td>${escapeHtml(formatDateTime(a.assigned_at))}</td>
          <td class="cell-actions">
            <button class="btn btn--danger btn--sm" data-action="delete-assignment" data-id="${a.id}">ถอดออก</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

async function refreshQuotaHint() {
  const teacherId = assignTeacherSelect.value;
  if (!teacherId) {
    assignQuotaHint.textContent = "";
    return;
  }

  const { ok, data } = await apiGet(`/api/admin/assignments/teacher/${teacherId}/room-count`);
  if (ok) {
    assignQuotaHint.textContent = `ครูคนนี้ดูแลอยู่ ${data.count}/${data.max} ห้อง`;
  } else {
    assignQuotaHint.textContent = "";
  }
}

assignTeacherSelect.addEventListener("change", refreshQuotaHint);

formAssignmentCreate.addEventListener("submit", async (e) => {
  e.preventDefault();
  const submitBtn = formAssignmentCreate.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  const teacherId = assignTeacherSelect.value;
  const roomTagId = document.getElementById("assign-room").value;

  const { ok, data } = await apiPost("/api/admin/assignments", { teacherId, roomTagId });

  if (ok) {
    showToast("มอบหมายสำเร็จ", "ok");
    document.getElementById("assign-room").value = "";
    await loadAssignments();
    await refreshQuotaHint();
  } else {
    showToast(data.message || "มอบหมายไม่สำเร็จ", "error");
  }

  submitBtn.disabled = false;
});

assignmentsTbody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action='delete-assignment']");
  if (!btn) return;

  const confirmed = window.confirm("ยืนยันถอดครูออกจากการดูแลห้องนี้?");
  if (!confirmed) return;

  btn.disabled = true;
  const { ok, data } = await apiDelete(`/api/admin/assignments/${btn.dataset.id}`);
  if (ok) {
    showToast("ถอดครูออกจากห้องแล้ว", "ok");
    await loadAssignments();
    await refreshQuotaHint();
  } else {
    showToast(data.message || "ถอดออกไม่สำเร็จ", "error");
    btn.disabled = false;
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
