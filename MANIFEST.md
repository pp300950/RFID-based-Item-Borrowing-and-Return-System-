# MANIFEST — RFID Key System: Admin/Room/History Upgrade

## Scope (confirmed brief)
1. **Admin — Keys status/history table**: log distinguishes "currently borrowed"
   from raw borrow/return events more clearly; CSV + Word export buttons for logs.
2. **Public room detail**: click room card → borrow history timeline (last 10,
   "view more" links to new public history page); multiple images per room
   (admin-controlled count) with lightbox; allowed borrow time window shown
   with clock/calendar icon.
3. **Admin — Teacher management**: full edit (name, department), not just tag.
4. **New public page**: `/history.html` — all-rooms borrow/return log, public,
   no login (paginated).
5. Full responsive/mobile across all touched pages.

## Decisions locked in
- Multi-image: new table `room_images` (1 room → many rows, ordered).
- Borrow time window: **enforced** at `/api/tap` (not just displayed) — borrow
  blocked outside window; return always allowed regardless of window.
- Room detail timeline: last 10 entries inline, "ดูทั้งหมด" links to
  `/history.html?roomId=X`.
- New public history page is separate from admin history (admin keeps its own
  filtered/exportable view; public page is read-only, paginated, no auth).

## Schema changes (schema.sql migration)
- `room_tags` add: `borrow_window_days` (int[], 0=Sun..6=Sat, null=no restriction),
  `borrow_window_start` (time, null), `borrow_window_end` (time, null).
- New table `room_images`: id, room_tag_id (FK cascade), image_url, sort_order,
  created_at. Index on (room_tag_id, sort_order).
- No changes to `key_logs`, `teachers`, `teacher_tags` structurally — "currently
  borrowed" status is derived from `room_tags.status`, not a new log field
  (avoids duplicating state). Admin log view will visually join against current
  status instead of adding a column.

## File list

| File | Purpose | Interface/Export | Depends on | Status |
|---|---|---|---|---|
| schema.sql | Add `room_images` table, borrow-window columns, migration block | `room_tags` +cols: `borrow_window_days smallint[]` (0=Sun..6=Sat, null=unrestricted), `borrow_window_start time`, `borrow_window_end time` (null+null=unrestricted). New table `room_images(id, room_tag_id FK cascade, image_url text, sort_order int, created_at)`, indexed on (room_tag_id, sort_order). `room_tags.image_url` (single, legacy) kept as-is, untouched. | — | done |
| routes/admin_rooms.js | Add image CRUD (multi), borrow-window fields on create/update | router: GET/POST/PATCH/DELETE /rooms, POST /rooms/:id/image, POST /rooms/:id/images, DELETE /rooms/:id/images/:imageId, PATCH /rooms/:id/images/reorder | schema.sql | in progress (2a done, 2b/2c pending) |
| routes/admin_teachers.js | Add PATCH for name/department (not just tag) | router: existing + PATCH /teachers/:id | schema.sql | pending |
| routes/admin_keys.js | History query enriched with is_currently_borrowed flag | router: GET /keys/status, GET /keys/history (adds isCurrentlyBorrowed per row) | schema.sql | pending |
| routes/keys.js | Add borrow-window + images to status; room history; public all-room history | router: GET /keys/status, GET /keys/:id/history, GET /keys/history/all | schema.sql | pending |
| routes/tap.js | Enforce borrow-window check before allowing borrow | router: POST /tap (adds `outside_window` state), GET /tap/session, POST /tap/session/clear | schema.sql | pending |
| routes/export.js (NEW) | GET /api/admin/keys/history/export?format=csv\|docx | router: GET /keys/history/export | admin_keys.js data shape | pending |
| server.js | Mount export.js under admin-protected group | (entry point, no exports) | export.js | pending |
| public/js/teacher.js | Room card click → detail modal (lightbox, time window, 10-item timeline + link) | openRoomDetail(key), closeRoomDetail(), initTeacherPage() | keys.js API | pending |
| public/teacher.html | Add modal markup container | (static HTML) | teacher.js | pending |
| public/css/teacher.css | Modal, lightbox, timeline, time-window badge styles; responsive pass | (styles only) | — | pending |
| public/history.html (NEW) | Public all-rooms log page | (static HTML) | history.js | pending |
| public/js/history.js (NEW) | Fetch + render paginated public history | loadHistory(page), renderHistoryRows(rows), initHistoryPage() | keys.js API | pending |
| public/css/history.css (NEW) | Styles for history page | (styles only) | style.css | pending |
| public/admin.html | Add: export buttons, teacher edit modal trigger, borrow-window + multi-image fields | (static HTML) | admin.js | pending |
| public/js/admin.js | Wire export buttons; teacher edit modal; room image list mgmt; borrow-window inputs | openTeacherEditModal(id), submitTeacherEdit(), renderRoomImages(images), bindExportButtons() | admin_rooms.js, admin_teachers.js, export.js | pending |
| public/css/admin.css | Teacher-edit modal, image-list manager UI, export button styles; responsive pass | (styles only) | — | pending |

## Not touched
- auth.js, middleware_auth.js, register_session.js, login.html, login.js,
  style.css (base tokens only, extended not rewritten) — no changes needed for
  this brief.

## Open technical note for Phase 2
- Word export: will use a lightweight docx-generation approach in Node
  (no Python skill available server-side at runtime — this is a live Express
  route, not a one-off document task). Will use `docx` npm package.
- CSV export: plain string-building, no dependency needed.

---

## PHASE 2 — Estimate & Task Split

Split rule applied: <150 lines & single responsibility → 1 task. >150 lines or
multiple responsibilities → split into layers (a) types/signatures (b) core
logic (c) error/edge cases. Since this is JS/SQL/HTML (not strongly typed),
layer (a) becomes "route stubs + schema" where applicable.

### Backend

**1. schema.sql** — ~40 new lines (2 ALTERs + 1 CREATE TABLE + migration block).
   Single responsibility → **1 task.**
   - Task 1: `schema.sql` — add `room_images` table + borrow-window columns + migration notes.

**2. routes/admin_rooms.js** — currently 230 lines; adding image CRUD (4 endpoints)
   + borrow-window fields (2 endpoints touched) ≈ +140 lines → ~370 lines total,
   multiple responsibilities → **split into 3 tasks:**
   - Task 2a: Add borrow-window fields to POST/PATCH /rooms (small, extends existing handlers).
   - Task 2b: Image CRUD — POST /rooms/:id/images (add, multi), DELETE /rooms/:id/images/:imageId.
   - Task 2c: Image reorder — PATCH /rooms/:id/images/reorder; keep existing single-image
     upload endpoint as-is for backward compat (used by old admin.js until 2b lands).

**3. routes/admin_teachers.js** — currently 165 lines; adding 1 PATCH endpoint
   (~35 lines) → single responsibility → **1 task.**
   - Task 3: `PATCH /teachers/:id` (name, department — separate from tag PATCH).

**4. routes/admin_keys.js** — currently 80 lines; adding derived field to
   existing queries (~15 lines) → **1 task.**
   - Task 4: Enrich `/keys/status` and `/keys/history` with `isCurrentlyBorrowed`.

**5. routes/keys.js** — currently 35 lines; adding room images/window to status
   (~10 lines) + 2 new endpoints (history per room, public all-room history,
   ~60 lines) → multiple responsibilities → **split into 2 tasks:**
   - Task 5a: Extend `/keys/status` response shape (images array, window fields).
   - Task 5b: New `GET /keys/:id/history` (last 10 + count) and
     `GET /keys/history/all` (paginated, public).

**6. routes/tap.js** — currently 260 lines; adding window-check logic before
   borrow (~25 lines, touches one code path) → single responsibility → **1 task.**
   - Task 6: Add `isWithinBorrowWindow(roomTag)` helper + gate on borrow branch only.

**7. routes/export.js (NEW)** — CSV (~40 lines) + DOCX (~60 lines) + route
   wiring (~20 lines) ≈ 120 lines but two distinct generation concerns →
   **split into 2 tasks:**
   - Task 7a: Route + CSV generation (no new deps).
   - Task 7b: DOCX generation (adds `docx` npm dependency).

**8. server.js** — 1-line require + 1 app.use block → **1 task** (Task 8), bundled
   with 7a since it's trivial wiring.

### Frontend — Teacher/public pages

**9. public/js/teacher.js** — currently 195 lines; adding modal open/close,
   lightbox, timeline render, window-badge render ≈ +160 lines → ~355 lines,
   multiple responsibilities → **split into 3 tasks:**
   - Task 9a: Modal shell — open/close wiring, fetch room history, basic render (no lightbox yet).
   - Task 9b: Lightbox for multi-image gallery inside modal.
   - Task 9c: Borrow-window badge rendering (icon + human-readable schedule text).

**10. public/teacher.html** — modal container markup (~40 lines) → **1 task**
    (Task 10, must land before 9a can be tested visually but stub can be added
    alongside 9a).

**11. public/css/teacher.css** — modal/lightbox/timeline/badge styles + responsive
    (~180 lines) → split by concern → **split into 2 tasks:**
    - Task 11a: Modal + lightbox + timeline styles.
    - Task 11b: Responsive/mobile pass across teacher.css (existing + new rules).

**12. public/history.html (NEW)** — ~60 lines, single page → **1 task.**

**13. public/js/history.js (NEW)** — fetch + pagination + render ≈ 110 lines,
    single responsibility (one page's logic) → **1 task.**

**14. public/css/history.css (NEW)** — ~100 lines incl. responsive → **1 task**
    (small enough to keep responsive inline rather than splitting).

### Frontend — Admin

**15. public/admin.html** — export buttons (~10 lines) + teacher edit modal
    markup (~30 lines) + room form additions for window/images (~40 lines) →
    multiple sections but purely additive markup → **split into 2 tasks**
    (matches the JS split below so each HTML chunk lands with its JS):
    - Task 15a: Export buttons + teacher edit modal markup.
    - Task 15b: Room form additions (borrow-window inputs + image list manager container).

**16. public/js/admin.js** — currently 685 lines (already large); adding
    teacher edit (~90 lines), image list management (~120 lines), export
    button wiring (~40 lines), borrow-window form handling (~50 lines) ≈
    +300 lines → clearly multiple responsibilities → **split into 4 tasks:**
    - Task 16a: Export button wiring (calls Task 7 endpoint, triggers download).
    - Task 16b: Teacher edit modal — open/populate/submit (uses Task 3 endpoint).
    - Task 16c: Room image list manager — render existing images, add/remove/reorder
      (uses Task 2b/2c endpoints).
    - Task 16d: Borrow-window inputs on room create/edit form (uses Task 2a endpoint).

**17. public/css/admin.css** — currently 520 lines; teacher-edit modal (~50 lines,
    can mostly reuse `.confirm-*` patterns), image-list manager UI (~90 lines),
    export button styles (~15 lines), responsive pass (~60 lines) →
    **split into 2 tasks:**
    - Task 17a: Teacher-edit modal + export button styles (small, reuses existing tokens).
    - Task 17b: Image-list manager styles + full responsive/mobile pass for admin.css.

### Ordered task list (respects dependencies)

| # | Task | Layer | File | Status |
|---|---|---|---|---|
| 1 | room_images table + borrow-window columns | schema | schema.sql | done |
| 2a | Borrow-window fields on room create/update | logic | routes/admin_rooms.js | done |
| 2b | Image CRUD (add/delete) | logic | routes/admin_rooms.js | pending |
| 2c | Image reorder | logic | routes/admin_rooms.js | pending |
| 3 | Teacher PATCH (name/department) | logic | routes/admin_teachers.js | pending |
| 4 | isCurrentlyBorrowed enrichment | logic | routes/admin_keys.js | pending |
| 5a | /keys/status: images + window fields | logic | routes/keys.js | pending |
| 5b | Room history + public all-room history | logic | routes/keys.js | pending |
| 6 | Borrow-window enforcement | logic | routes/tap.js | pending |
| 7a | Export route + CSV | logic | routes/export.js | pending |
| 8 | Mount export.js | wiring | server.js | pending |
| 7b | DOCX export | logic | routes/export.js | pending |
| 9a | Room detail modal shell | logic | public/js/teacher.js | pending |
| 10 | Modal container markup | markup | public/teacher.html | pending |
| 11a | Modal/lightbox/timeline styles | styles | public/css/teacher.css | pending |
| 9b | Lightbox gallery | logic | public/js/teacher.js | pending |
| 9c | Borrow-window badge render | logic | public/js/teacher.js | pending |
| 11b | Teacher.css responsive pass | styles | public/css/teacher.css | pending |
| 12 | history.html | markup | public/history.html | pending |
| 13 | history.js | logic | public/js/history.js | pending |
| 14 | history.css | styles | public/css/history.css | pending |
| 15a | Export buttons + teacher-edit modal markup | markup | public/admin.html | pending |
| 16a | Export button wiring | logic | public/js/admin.js | pending |
| 16b | Teacher edit modal logic | logic | public/js/admin.js | pending |
| 17a | Teacher-edit modal + export button styles | styles | public/css/admin.css | pending |
| 15b | Room form additions markup | markup | public/admin.html | pending |
| 16c | Room image list manager | logic | public/js/admin.js | pending |
| 16d | Borrow-window inputs on room form | logic | public/js/admin.js | pending |
| 17b | Image-list styles + admin.css responsive pass | styles | public/css/admin.css | pending |

### Key decisions from completed tasks
- **Task 1**: `room_tags.image_url` (legacy single-image column) is kept, not
  dropped/migrated — new multi-image UI will read from `room_images` and can
  ignore or backfill `image_url` later. Return actions are never gated by
  `borrow_window_*` — only borrow. Both migration (upgrade existing DB) and
  fresh-create paths updated identically.
- **Task 2a**: Added `validateBorrowWindow(body)` helper in `admin_rooms.js`,
  shared by `POST /rooms` and `PATCH /rooms/:id`. Body keys are
  `borrowWindowDays` (array of 0-6, or `null` to clear, or omitted to leave
  untouched), `borrowWindowStart`/`borrowWindowEnd` (must be provided together
  — both `null` to clear, or both `"HH:MM"`/`"HH:MM:SS"` strings; providing
  only one is a 400 error). No `start < end` ordering check, since overnight
  windows (e.g. 22:00–06:00) are valid and left for `tap.js` (Task 6) to
  interpret. `borrowWindowDays` values are de-duped and sorted before insert.
  Image CRUD (2b/2c) not touched — existing single-image upload endpoint
  (`POST /rooms/:id/image`) still works as before.

---
Status: **Phase 2 complete. Task 2a/28 done (2 total).** Say "do task N" to continue
(suggested next: Task 2b — image CRUD add/delete on admin_rooms.js, needs the
`room_images` table shape from Task 1 plus the existing multer/Storage upload
pattern already in this file).
