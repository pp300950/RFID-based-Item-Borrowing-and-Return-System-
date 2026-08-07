"""
rfid_bridge.py
=================================================================
เวอร์ชันใหม่ของ rfid_reader_keyboard.py — เปลี่ยนหน้าจอ Tkinter เดิม
เป็นหน้าเว็บเต็มจอ (HTML/CSS/JS) ที่มี animation และ countdown สวยๆ
แทน โดยตัวโปรแกรม Python นี้ทำหน้าที่เป็น "bridge" 2 อย่างเหมือนเดิม
ทุกประการ ไม่เปลี่ยน logic หลัก:

  1. ดักค่าที่เครื่องอ่าน RFID พิมพ์เข้ามาแบบ keyboard emulation
     (ต้องมีหน้าต่างนี้โฟกัสอยู่ตลอดเวลา เหมือนเวอร์ชัน Tkinter เดิม)
  2. กรอง/ตรวจสอบรูปแบบค่า (CARD_ID_PATTERN) แล้วยิง POST ไปที่
     {BACKEND_URL}/api/tap เหมือนเดิมทุกประการ

สิ่งที่เปลี่ยน:
  - หน้าต่างรับค่า (Tkinter) ตอนนี้เป็นหน้าต่างเล็กๆ ที่แทบไม่ต้องมอง
    เลย เพราะงานแสดงผลทั้งหมดย้ายไปที่ display.html ซึ่งเปิดแยกต่างหาก
    ในเบราว์เซอร์แบบเต็มจอ (kiosk mode ก็ได้)
  - ผลลัพธ์จาก backend (/api/tap) และสถานะ session (/api/tap/session)
    จะถูก push ไปหา display.html แบบ real-time ผ่าน Server-Sent
    Events (SSE) ที่ endpoint GET /events แทนที่จะโชว์ใน Listbox
  - Bridge นี้ยัง poll GET /api/tap/session ของ backend จริงเป็นระยะ
    เพื่อรู้เวลาที่เหลือของ session แล้วส่งต่อให้ display.html นับถอยหลัง
    ได้ตรงกับ backend จริงเป๊ะๆ (ไม่ใช่นับถอยหลังเดาเอาเองฝั่ง frontend)

สถาปัตยกรรม:

    เครื่องอ่าน RFID (keyboard emulation)
              │  พิมพ์ตัวอักษร + Enter
              ▼
    หน้าต่าง Tkinter เล็กๆ (invisible-ish, ต้องโฟกัสค้างไว้)
              │  กรอง pattern, normalize
              ▼
    POST https://rfid-5iaw.onrender.com/api/tap   (backend จริง)
              │  ผลลัพธ์ ok/state/message
              ▼
    Flask (ในไฟล์นี้, localhost:5055)
              │  SSE: GET /events
              ▼
    เบราว์เซอร์ — display.html (เต็มจอ, สวยๆ, countdown)

การตั้งค่าก่อนใช้งาน:
  - แก้ BACKEND_URL ให้ตรงกับ backend จริง (ตาม server.js)
  - READER_ID ต้องตรงกับที่ tap.js ใช้ (ปกติคือ "default")

วิธีใช้งาน:
    pip install flask --break-system-packages   (ครั้งแรกครั้งเดียว)
    python rfid_bridge.py
    เปิดเบราว์เซอร์ไปที่ http://localhost:5055 แล้วกด F11 เพื่อเต็มจอ
    (หน้าต่าง Tkinter เล็กๆ ที่เด้งขึ้นมาคือช่องรับค่าจากเครื่องอ่าน
     ต้องปล่อยให้โฟกัสอยู่ตลอด — ย่อได้แต่ห้ามปิด)
=================================================================
"""

import json
import queue
import re
import socket
import sys
import threading
import time
import tkinter as tk
import urllib.error
import urllib.request
from tkinter import ttk

from flask import Flask, Response, render_template, request

try:
    import ctypes
    IS_WINDOWS = sys.platform.startswith("win")
except ImportError:
    IS_WINDOWS = False


# -----------------------------------------------------------------
# ค่าตั้งต้น — คงเดิมจาก rfid_reader_keyboard.py ทุกประการ
# -----------------------------------------------------------------
BACKEND_URL = "https://rfid-5iaw.onrender.com"
TAP_ENDPOINT = f"{BACKEND_URL}/api/tap"
SESSION_ENDPOINT = f"{BACKEND_URL}/api/tap/session"
READER_ID = "default"
REQUEST_TIMEOUT_SEC = 5

CARD_ID_PATTERN = re.compile(r"^[0-9A-Z]+$")

# bridge (ไฟล์นี้) ฟังที่พอร์ตนี้ ให้เบราว์เซอร์เปิด display.html จากตรงนี้
BRIDGE_HOST = "127.0.0.1"
BRIDGE_PORT = 5055

# ระยะ poll สถานะ session จาก backend จริง (ให้ countdown ฝั่งจอตรงกับ
# backend เป๊ะๆ แทนที่จะนับถอยหลังเดาเองฝั่ง frontend อย่างเดียว)
SESSION_POLL_INTERVAL_SEC = 1.0


# -----------------------------------------------------------------
# ตัวกลางส่ง event ไปหน้าเว็บ: ทุก client (แท็บเบราว์เซอร์) ที่เปิด
# /events ไว้จะได้รับทุก event ผ่าน queue ของตัวเอง
# -----------------------------------------------------------------
_subscribers = []
_subscribers_lock = threading.Lock()


def broadcast(event_type, data):
    payload = json.dumps({"type": event_type, "data": data}, ensure_ascii=False)
    with _subscribers_lock:
        dead = []
        for q in _subscribers:
            try:
                q.put_nowait(payload)
            except queue.Full:
                dead.append(q)
        for q in dead:
            _subscribers.remove(q)


# -----------------------------------------------------------------
# เรียก backend จริง (เหมือนเดิมจาก rfid_reader_keyboard.py)
# -----------------------------------------------------------------
def post_tap_to_backend(tag_uid, reader_id=READER_ID, timeout=REQUEST_TIMEOUT_SEC):
    body = json.dumps({"tagUid": tag_uid, "readerId": reader_id}).encode("utf-8")
    req = urllib.request.Request(
        TAP_ENDPOINT,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return True, json.loads(raw)
    except urllib.error.HTTPError as err:
        try:
            raw = err.read().decode("utf-8")
            payload = json.loads(raw)
        except Exception:
            payload = {"ok": False, "message": f"Backend ตอบ error (HTTP {err.code})"}
        return False, payload
    except (socket.timeout, TimeoutError):
        return False, {"ok": False, "message": "เชื่อมต่อ backend หมดเวลา (timeout)"}
    except urllib.error.URLError as err:
        return False, {
            "ok": False,
            "message": f"เชื่อมต่อ backend ไม่สำเร็จ ({BACKEND_URL}) — ตรวจสอบว่า server เปิดอยู่หรือไม่\n{err.reason}",
        }
    except Exception as err:
        return False, {"ok": False, "message": f"เกิดข้อผิดพลาดที่ไม่คาดคิด: {err}"}


def get_session_from_backend(reader_id=READER_ID, timeout=REQUEST_TIMEOUT_SEC):
    """GET /api/tap/session?readerId=... คืนค่า dict เสมอ ไม่ raise"""
    url = f"{SESSION_ENDPOINT}?readerId={reader_id}"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw)
    except Exception:
        return {"ok": False, "active": False}


def clear_session_on_backend(reader_id=READER_ID, timeout=REQUEST_TIMEOUT_SEC):
    body = json.dumps({"readerId": reader_id}).encode("utf-8")
    req = urllib.request.Request(
        f"{BACKEND_URL}/api/tap/session/clear",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=timeout)
    except Exception:
        pass


# -----------------------------------------------------------------
# background thread: poll session อยู่เรื่อยๆ แล้ว broadcast สถานะไปให้
# หน้าเว็บทุกครั้งที่มีการเปลี่ยนแปลง (active -> inactive หรือกลับกัน)
# -----------------------------------------------------------------
def session_poll_loop():
    last_active = None
    while True:
        session = get_session_from_backend()
        active = bool(session.get("active"))

        if active:
            broadcast("session_update", {
                "active": True,
                "teacher": session.get("teacher"),
                "expiresInMs": session.get("expiresInMs"),
            })
        elif last_active:
            # เพิ่งตกจาก active -> ไม่ active (หมดอายุ) — แจ้งครั้งเดียว
            broadcast("session_update", {"active": False})

        last_active = active
        time.sleep(SESSION_POLL_INTERVAL_SEC)


# -----------------------------------------------------------------
# Windows keyboard layout check (เหมือนเดิม)
# -----------------------------------------------------------------
def get_current_keyboard_layout_is_english():
    if not IS_WINDOWS:
        return None
    try:
        user32 = ctypes.windll.user32
        hwnd = user32.GetForegroundWindow()
        thread_id = user32.GetWindowThreadProcessId(hwnd, 0)
        layout_id = user32.GetKeyboardLayout(thread_id)
        lang_id = layout_id & 0xFFFF
        english_lang_ids = {0x0409, 0x0809, 0x0c09, 0x1009, 0x1409}
        return lang_id in english_lang_ids
    except Exception:
        return None


# ===================================================================
# ส่วนที่ 1: หน้าต่าง Tkinter เล็กๆ — ยังต้องมีอยู่จริง เพราะเครื่องอ่าน
# ส่งค่าเป็น "การพิมพ์คีย์บอร์ด" ต้องมีช่อง input ที่โฟกัสอยู่เสมอถึงจะ
# ดักค่าได้ (ข้อจำกัดเดียวกับเวอร์ชันเดิม ย้ายจากเบราว์เซอร์ไปแทนไม่ได้
# เพราะเบราว์เซอร์ปกติไม่ยอมให้ JS ฟัง raw keyboard เหมือน native app)
# ===================================================================
class CaptureWindow:
    def __init__(self, root):
        self.root = root
        self.root.title("ตัวรับค่าเครื่องอ่าน RFID — ห้ามปิดหน้าต่างนี้")
        self.root.geometry("420x160")
        self.root.configure(bg="#11111b")
        self.root.attributes("-topmost", True)

        tk.Label(
            root,
            text="หน้าจอแสดงผลจริงอยู่ในเบราว์เซอร์\nที่ http://localhost:5055",
            font=("Tahoma", 11, "bold"),
            fg="#cdd6f4", bg="#11111b", justify="center",
        ).pack(pady=(14, 4))

        tk.Label(
            root,
            text="ห้ามคลิกออกจากหน้าต่างนี้ระหว่างแตะบัตร\n(ย่อหน้าต่างได้ แต่ห้ามปิด)",
            font=("Tahoma", 9),
            fg="#a6adc8", bg="#11111b", justify="center",
        ).pack(pady=(0, 8))

        self.lang_warning = tk.Label(
            root, text="", font=("Tahoma", 9, "bold"),
            fg="#11111b", bg="#f9e2af", wraplength=380, justify="center",
        )

        self.entry_var = tk.StringVar()
        self.entry = tk.Entry(root, textvariable=self.entry_var, font=("Consolas", 1))
        # ช่อง input จริงถูกทำให้เล็กจิ๋ว (มองแทบไม่เห็น) เพราะไม่ต้อง
        # แสดงผลอะไรที่นี่แล้ว — การแสดงผลทั้งหมดไปอยู่ที่ display.html
        self.entry.place(x=-100, y=-100, width=1, height=1)
        self.entry.bind("<Return>", self._on_enter)
        self.entry.bind("<KP_Enter>", self._on_enter)

        self._focus_input()
        self.root.bind("<FocusOut>", lambda e: self.root.after(50, self._focus_input))
        self._poll_language_warning()

    def _focus_input(self):
        try:
            self.entry.focus_force()
        except tk.TclError:
            pass

    def _on_enter(self, event=None):
        raw_value = self.entry_var.get().strip()
        self.entry_var.set("")

        if not raw_value:
            return

        normalized_value = raw_value.upper()

        if not CARD_ID_PATTERN.match(normalized_value):
            broadcast("invalid_value", {"raw": raw_value})
            self._focus_input()
            return

        broadcast("tap_sent", {"tagUid": normalized_value})
        self._focus_input()

        threading.Thread(
            target=self._post_and_broadcast,
            args=(normalized_value,),
            daemon=True,
        ).start()

    def _post_and_broadcast(self, tag_uid):
        ok, payload = post_tap_to_backend(tag_uid)
        broadcast("tap_result", {
            "tagUid": tag_uid,
            "ok": ok,
            "state": payload.get("state"),
            "message": payload.get("message"),
            "teacher": payload.get("teacher"),
            "room": payload.get("room"),
        })

    def _poll_language_warning(self):
        is_english = get_current_keyboard_layout_is_english()
        if is_english is False:
            self.lang_warning.config(
                text="⚠️ ภาษาอินพุตไม่ใช่ EN — กด Win+Space ก่อนแตะบัตร"
            )
            if not self.lang_warning.winfo_ismapped():
                self.lang_warning.pack(pady=(0, 4))
            broadcast("lang_warning", {"is_english": False})
        else:
            if self.lang_warning.winfo_ismapped():
                self.lang_warning.pack_forget()
            broadcast("lang_warning", {"is_english": True})
        self.root.after(1500, self._poll_language_warning)


def run_tkinter():
    root = tk.Tk()
    CaptureWindow(root)
    root.mainloop()


# ===================================================================
# ส่วนที่ 2: Flask server — เสิร์ฟ display.html + SSE endpoint
# ===================================================================
app = Flask(__name__)


@app.route("/")
def index():
    return render_template("display.html", reader_id=READER_ID, backend_url=BACKEND_URL)


@app.route("/events")
def events():
    def stream():
        q = queue.Queue(maxsize=50)
        with _subscribers_lock:
            _subscribers.append(q)
        try:
            # ping แรกให้ client รู้ว่าเชื่อมสำเร็จ
            yield "event: connected\ndata: {}\n\n"
            while True:
                try:
                    payload = q.get(timeout=15)
                    yield f"data: {payload}\n\n"
                except queue.Empty:
                    # heartbeat กัน connection ถูกตัดเพราะ idle
                    yield ": heartbeat\n\n"
        finally:
            with _subscribers_lock:
                if q in _subscribers:
                    _subscribers.remove(q)

    return Response(stream(), mimetype="text/event-stream")


@app.route("/api/clear-session", methods=["POST"])
def clear_session():
    """ปุ่ม 'เสร็จสิ้น' บนหน้าจอเว็บเรียกมาที่นี่ -> ส่งต่อไปปิด session จริง"""
    threading.Thread(target=clear_session_on_backend, daemon=True).start()
    return {"ok": True}


def run_flask():
    app.run(host=BRIDGE_HOST, port=BRIDGE_PORT, debug=False, use_reloader=False)


def main():
    threading.Thread(target=session_poll_loop, daemon=True).start()
    threading.Thread(target=run_flask, daemon=True).start()

    print(f"เปิดเบราว์เซอร์ไปที่ http://{BRIDGE_HOST}:{BRIDGE_PORT} แล้วกด F11 เพื่อเต็มจอ")
    print("หน้าต่างเล็กๆ ที่เด้งขึ้นมาคือตัวรับค่าจากเครื่องอ่าน ห้ามปิด (ย่อได้)")

    run_tkinter()  # ต้องรันบน main thread (ข้อจำกัดของ Tkinter)


if __name__ == "__main__":
    main()
