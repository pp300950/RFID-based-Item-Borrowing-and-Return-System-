"""
rfid_reader_keyboard.py
=================================================================
สคริปต์อ่านค่าเครื่องอ่านบัตร RFID (R80CP / Sycreader RFID Technology)
โดยใช้วิธี "Keyboard Emulation" แล้วยิงค่าที่อ่านได้ขึ้น backend จริง
ผ่าน POST /api/tap ทันทีที่แตะบัตร (ไม่ใช่แค่โชว์ในหน้าต่างตัวเองเหมือน
เวอร์ชันเดิม)

ทำไมยังต้องใช้ Keyboard Emulation (ไม่เปลี่ยนไปอ่าน raw HID):
  เครื่องอ่านรุ่นนี้ถูกออกแบบให้ Windows มองเป็นคีย์บอร์ดมาตรฐาน (HID
  keyboard class) ทำให้ Windows ยึด driver ไว้แบบ exclusive การเปิด
  อ่าน raw HID report ตรง ๆ ผ่าน hidapi จึงเจอ OSError: read error
  ตลอดเวลา (เปิด device ได้ แต่ read() ไม่ได้) จึงต้องปล่อยให้ Windows
  จัดการมันเป็นคีย์บอร์ดตามปกติ แล้วให้โปรแกรมนี้ "รับฟัง" ค่าที่มันพิมพ์
  เข้ามาในช่อง input ที่โฟกัสค้างไว้ตลอดเวลาแทน เมื่อแตะบัตร เครื่องจะ
  พิมพ์ตัวเลขบัตรตามด้วย Enter อัตโนมัติ

สิ่งที่เปลี่ยนจากเวอร์ชันเดิม:
  - ค่าที่อ่านได้ (หลังผ่านการกรองแล้วว่าเป็นตัวเลข/ตัวอักษรอังกฤษ
    พิมพ์ใหญ่เท่านั้น) จะถูกส่งเป็น POST ไปที่ {BACKEND_URL}/api/tap
    ทันที พร้อม readerId คงที่
  - ผลลัพธ์จาก backend (สำเร็จ/error พร้อมข้อความภาษาไทย) จะถูกเอามา
    แสดงในหน้าต่างแทนที่จะแค่ echo ค่าที่อ่านได้เฉยๆ
  - ยังคงระบบกรองอักขระที่ไม่ตรงรูปแบบ + คำเตือนสลับภาษา EN ไว้เหมือน
    เดิมทุกประการ เพราะสาเหตุ (input language ผิด -> ค่าเพี้ยน) ยังคง
    มีอยู่จริงไม่ว่าจะส่งค่าต่อไปทำอะไรก็ตาม
  - [แก้ไขล่าสุด] เดิม CARD_ID_PATTERN บังคับให้เป็น "ตัวเลขล้วน" เท่านั้น
    ซึ่งเข้มงวดเกินไปสำหรับบัตรที่ UID มีตัวอักษรภาษาอังกฤษปนอยู่ด้วย
    (เช่น UID แบบ hex ที่มี A-F) จึงเปลี่ยน pattern ให้รองรับทั้ง
    ตัวเลข 0-9 และตัวอักษรอังกฤษพิมพ์ใหญ่ A-Z ร่วมกันได้

ข้อควรระวังสำคัญ:
  เครื่องอ่านส่ง "HID keycode ดิบ" ซึ่ง Windows จะตีความตาม keyboard
  layout / input language ที่ active อยู่ตอนนั้น ถ้า layout เป็น
  ภาษาไทย ตัวเลข/ตัวอักษรที่ควรได้จะกลายเป็นตัวอักษรไทยเพี้ยน ๆ แทน
  โปรแกรมนี้จึงมีระบบเตือนและกรองอักขระที่ไม่ตรงรูปแบบที่คาดไว้ออก
  อัตโนมัติ พร้อมแจ้งเตือนให้ผู้ใช้สลับภาษาเป็น EN หากตรวจพบว่าค่าที่
  ได้ผิดปกติ (เช่นมีตัวอักษรไทยปนมา)

การตั้งค่าก่อนใช้งาน:
  - แก้ BACKEND_URL ด้านล่างให้ตรงกับที่อยู่ backend จริง (default คือ
    http://localhost:3000 ตาม server.js)
  - READER_ID ตั้งเป็น "default" ตามที่ tap.js / register_session.js
    ใช้อยู่ (มีเครื่องอ่านเครื่องเดียวที่ห้องทะเบียน)
  - หากรูปแบบเลขบัตรของคุณไม่ใช่ [0-9A-Z] ล้วน (เช่นมีขีด "-" คั่น หรือ
    มีตัวอักษรพิมพ์เล็กด้วย) ให้ปรับ CARD_ID_PATTERN ด้านล่างเพิ่มเติม

วิธีใช้งาน:
    python rfid_reader_keyboard.py

ก่อนใช้งาน:
  - สลับ input language ของ Windows เป็น ENG (กด Win+Space) ก่อนแตะบัตร
  - เปิดโปรแกรมนี้ทิ้งไว้ แล้วห้ามคลิกไปที่หน้าต่างอื่นระหว่างแตะบัตร
    (โปรแกรมจะพยายามดึงโฟกัสกลับให้อัตโนมัติ)
=================================================================
"""

import json
import re
import socket
import sys
import threading
import time
import tkinter as tk
import urllib.error
import urllib.request
from tkinter import ttk, messagebox

try:
    import ctypes
    IS_WINDOWS = sys.platform.startswith("win")
except ImportError:
    IS_WINDOWS = False


# -----------------------------------------------------------------
# ค่าตั้งต้น — แก้ตรงนี้ให้ตรงกับ backend จริง
# -----------------------------------------------------------------
BACKEND_URL = "https://rfid-5iaw.onrender.com"
TAP_ENDPOINT = f"{BACKEND_URL}/api/tap"
READER_ID = "default"  # ต้องตรงกับที่ tap.js / register_session.js ใช้
REQUEST_TIMEOUT_SEC = 5

# เดิมรับเฉพาะตัวเลขล้วน (^[0-9]+$) — ตอนนี้เปลี่ยนให้รับทั้งตัวเลข
# และตัวอักษรภาษาอังกฤษ "พิมพ์ใหญ่" ร่วมกันได้ (เช่น UID แบบ hex ที่มี
# A-F หรือรหัสบัตรที่ผสมตัวอักษร-ตัวเลข) ตัวอักษรพิมพ์เล็ก a-z ไม่ผ่าน
# เพราะเครื่องอ่านชนิดนี้ส่งเป็นตัวพิมพ์ใหญ่เสมอ — ถ้าเจอพิมพ์เล็กแปลว่า
# มีอะไรผิดปกติ (เช่น input language เพี้ยน) เช่นเดียวกับที่เคยดักตัวเลข
CARD_ID_PATTERN = re.compile(r"^[0-9A-Z]+$")


def get_current_keyboard_layout_is_english():
    """
    เช็คว่า input language ปัจจุบันของ Windows เป็นภาษาอังกฤษ (EN) หรือไม่
    ใช้ WinAPI GetKeyboardLayout ผ่าน ctypes (ทำงานเฉพาะบน Windows)
    คืนค่า True/False/None (None = เช็คไม่ได้ เช่นไม่ใช่ Windows)
    """
    if not IS_WINDOWS:
        return None
    try:
        user32 = ctypes.windll.user32
        # หา thread id ของหน้าต่างที่ active อยู่
        hwnd = user32.GetForegroundWindow()
        thread_id = user32.GetWindowThreadProcessId(hwnd, 0)
        layout_id = user32.GetKeyboardLayout(thread_id)
        # ค่า low word ของ layout id คือ language identifier
        lang_id = layout_id & 0xFFFF
        # 0x0409 = English (United States), 0x0809 = English (UK)
        english_lang_ids = {0x0409, 0x0809, 0x0c09, 0x1009, 0x1409}
        return lang_id in english_lang_ids
    except Exception:
        return None


def post_tap_to_backend(tag_uid, reader_id=READER_ID, timeout=REQUEST_TIMEOUT_SEC):
    """
    ยิง POST {tagUid, readerId} ไปที่ /api/tap แบบ synchronous (เรียกจาก
    background thread เสมอ ไม่เรียกตรงจาก UI thread เพราะ network call
    จะบล็อค UI ค้าง)

    คืนค่าเป็น tuple (ok: bool, payload: dict) เสมอ ไม่ raise ออกไปนอก
    ฟังก์ชันนี้ — ฝั่งเรียกไม่ต้อง try/except ซ้ำ:
      - เชื่อมต่อ backend ไม่ได้ / timeout -> (False, {"message": ...})
      - backend ตอบ error (4xx/5xx) แต่มี JSON body -> (False, json นั้น)
      - backend ตอบสำเร็จ (2xx) -> (True, json นั้น)
    """
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
        # backend ตอบกลับมาแต่เป็น error status (400/404/409/500 ฯลฯ) —
        # ยังคงมี JSON body ที่มีข้อความภาษาไทยอธิบายสาเหตุอยู่ ให้ใช้ต่อ
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
    except Exception as err:  # กันเหนียวสุดท้าย ไม่ให้ background thread ตายเงียบๆ
        return False, {"ok": False, "message": f"เกิดข้อผิดพลาดที่ไม่คาดคิด: {err}"}


class RFIDReaderApp:
    def __init__(self, root):
        self.root = root
        self.root.title("เครื่องอ่านบัตร RFID (R80CP) — เชื่อมต่อ backend")
        self.root.geometry("640x560")
        self.root.configure(bg="#1e1e2e")
        self.root.resizable(False, False)

        self.history = []  # เก็บ log ผลลัพธ์ (จาก backend) ในเซสชันนี้

        self._build_ui()
        self._focus_input()
        self._poll_language_warning()

        # ดักไม่ให้โฟกัสหลุดจากช่อง input ง่าย ๆ
        self.root.bind("<FocusOut>", lambda e: self.root.after(50, self._focus_input))

    # ------------------------------------------------------------------ UI
    def _build_ui(self):
        title = tk.Label(
            self.root,
            text="พร้อมรับการแตะบัตร RFID",
            font=("Tahoma", 16, "bold"),
            fg="#cdd6f4",
            bg="#1e1e2e",
        )
        title.pack(pady=(18, 4))

        subtitle = tk.Label(
            self.root,
            text="อย่าคลิกออกจากหน้าต่างนี้ระหว่างแตะบัตร",
            font=("Tahoma", 10),
            fg="#a6adc8",
            bg="#1e1e2e",
        )
        subtitle.pack(pady=(0, 4))

        backend_label = tk.Label(
            self.root,
            text=f"เชื่อมต่อไปที่: {TAP_ENDPOINT}  (readerId: {READER_ID})",
            font=("Tahoma", 9),
            fg="#6c7086",
            bg="#1e1e2e",
        )
        backend_label.pack(pady=(0, 10))

        # แถบเตือนภาษา (ซ่อน/แสดงอัตโนมัติ)
        self.lang_warning = tk.Label(
            self.root,
            text="",
            font=("Tahoma", 10, "bold"),
            fg="#1e1e2e",
            bg="#f9e2af",
            wraplength=580,
            justify="center",
        )
        # จะ pack ให้เห็นเฉพาะตอนมีคำเตือนเท่านั้น (ดูใน _poll_language_warning)

        # ช่อง input ที่ใช้ดักค่าจากเครื่องอ่าน (แสดงตัวอักษรที่พิมพ์ปกติ
        # เพื่อความง่ายตอน debug — ไม่ใช้ show="*")
        self.entry_var = tk.StringVar()
        self.entry = tk.Entry(
            self.root,
            textvariable=self.entry_var,
            font=("Consolas", 14),
            justify="center",
            bg="#313244",
            fg="#cdd6f4",
            insertbackground="#cdd6f4",
            relief="flat",
        )
        self.entry.pack(fill="x", padx=40, pady=10, ipady=8)
        self.entry.bind("<Return>", self._on_enter)
        self.entry.bind("<KP_Enter>", self._on_enter)

        last_read_frame = tk.Frame(self.root, bg="#1e1e2e")
        last_read_frame.pack(pady=(4, 4))
        tk.Label(
            last_read_frame, text="ค่าล่าสุด:", font=("Tahoma", 11),
            fg="#a6adc8", bg="#1e1e2e",
        ).pack(side="left")
        self.last_value_label = tk.Label(
            last_read_frame, text="-", font=("Consolas", 14, "bold"),
            fg="#a6e3a1", bg="#1e1e2e",
        )
        self.last_value_label.pack(side="left", padx=(8, 0))

        # ข้อความสถานะจาก backend (แสดงผลลัพธ์ล่าสุดแบบเด่นชัด)
        self.status_label = tk.Label(
            self.root,
            text="",
            font=("Tahoma", 11, "bold"),
            fg="#cdd6f4",
            bg="#1e1e2e",
            wraplength=580,
            justify="center",
        )
        self.status_label.pack(pady=(4, 12))

        # ประวัติผลลัพธ์
        history_label = tk.Label(
            self.root, text="ประวัติล่าสุด", font=("Tahoma", 10, "bold"),
            fg="#cdd6f4", bg="#1e1e2e",
        )
        history_label.pack(anchor="w", padx=40)

        list_frame = tk.Frame(self.root, bg="#1e1e2e")
        list_frame.pack(fill="both", expand=True, padx=40, pady=(4, 16))

        scrollbar = ttk.Scrollbar(list_frame)
        scrollbar.pack(side="right", fill="y")

        self.history_list = tk.Listbox(
            list_frame,
            font=("Consolas", 11),
            bg="#313244",
            fg="#cdd6f4",
            relief="flat",
            yscrollcommand=scrollbar.set,
            selectbackground="#585b70",
        )
        self.history_list.pack(side="left", fill="both", expand=True)
        scrollbar.config(command=self.history_list.yview)

        status = tk.Label(
            self.root,
            text="กด Ctrl+C ในหน้าต่างนี้ หรือปิดหน้าต่างเพื่อหยุดโปรแกรม",
            font=("Tahoma", 9),
            fg="#6c7086",
            bg="#1e1e2e",
        )
        status.pack(pady=(0, 10))

    # ------------------------------------------------------------- ตรรกะหลัก
    def _focus_input(self):
        try:
            self.entry.focus_force()
        except tk.TclError:
            pass

    def _on_enter(self, event=None):
        raw_value = self.entry_var.get().strip()
        self.entry_var.set("")  # เคลียร์ช่องทันที พร้อมรับบัตรใบถัดไป

        if not raw_value:
            return

        # normalize ตัวอักษรพิมพ์เล็ก -> พิมพ์ใหญ่ก่อนตรวจสอบ เผื่อบาง
        # ระบบปฏิบัติการ/ไดรเวอร์ส่งมาเป็นพิมพ์เล็กแทน (เครื่องอ่านรุ่นนี้
        # ปกติส่งพิมพ์ใหญ่อยู่แล้ว แต่ normalize ไว้กันปัญหาจุกจิก)
        normalized_value = raw_value.upper()

        if not CARD_ID_PATTERN.match(normalized_value):
            # ค่าผิดปกติ (มักเกิดจาก input language ไม่ใช่ EN ตอนแตะบัตร
            # ทำให้มีตัวอักษรไทยหรืออักขระพิเศษปนเข้ามา)
            # -> ไม่ส่งขึ้น backend เลย เพราะรู้อยู่แล้วว่าไม่ใช่รหัสบัตรจริง
            self._handle_invalid_value(raw_value)
            return

        # ค่าปกติ ตรงตามรูปแบบที่คาดไว้ (ตัวเลข/ตัวอักษรอังกฤษพิมพ์ใหญ่)
        # -> ส่งขึ้น backend
        self.last_value_label.config(text=normalized_value, fg="#a6e3a1")
        self.status_label.config(text="กำลังส่งไปยัง backend...", fg="#f9e2af")
        self._focus_input()

        # ยิง POST ใน background thread เสมอ กัน UI ค้างระหว่างรอ network
        threading.Thread(
            target=self._post_and_handle_result,
            args=(normalized_value,),
            daemon=True,
        ).start()

    def _handle_invalid_value(self, raw_value):
        timestamp = time.strftime("%H:%M:%S")
        self.last_value_label.config(text="⚠️ ค่าผิดปกติ ดูประวัติ", fg="#f38ba8")
        self.status_label.config(text="ค่าที่อ่านได้ไม่ตรงรูปแบบที่กำหนด — ไม่ได้ส่งไปยัง backend", fg="#f38ba8")
        entry_text = f"[{timestamp}] ⚠️ ค่าที่อ่านได้ไม่ตรงรูปแบบ: {raw_value!r}"
        self.history_list.insert(0, entry_text)

        messagebox.showwarning(
            "ค่าที่อ่านได้ผิดปกติ",
            "ได้ค่าที่ไม่ตรงรูปแบบ (ตัวเลข 0-9 และตัวอักษรอังกฤษ A-Z "
            "เท่านั้น) จากเครื่องอ่าน\n\n"
            f"ค่าที่ได้: {raw_value}\n\n"
            "สาเหตุที่พบบ่อยที่สุดคือ input language ของ Windows "
            "ไม่ได้ตั้งเป็น EN ตอนแตะบัตร กรุณาสลับเป็น EN "
            "(กด Win+Space) แล้วลองแตะบัตรใหม่อีกครั้ง",
        )
        self._focus_input()

    def _post_and_handle_result(self, tag_uid):
        """รันใน background thread — ห้ามแตะ Tkinter widget ตรงๆ ที่นี่
        ต้องใช้ self.root.after(0, ...) ส่งกลับไปทำงานบน UI thread เท่านั้น
        """
        ok, payload = post_tap_to_backend(tag_uid)
        self.root.after(0, lambda: self._show_backend_result(tag_uid, ok, payload))

    def _show_backend_result(self, tag_uid, ok, payload):
        timestamp = time.strftime("%H:%M:%S")
        message = payload.get("message") or ("สำเร็จ" if ok else "เกิดข้อผิดพลาดไม่ทราบสาเหตุ")
        state = payload.get("state")

        if ok:
            self.status_label.config(text=message, fg="#a6e3a1")
            icon = "✅"
        else:
            self.status_label.config(text=message, fg="#f38ba8")
            icon = "❌"

        state_part = f" [{state}]" if state else ""
        entry_text = f"[{timestamp}] {icon} {tag_uid}{state_part} — {message}"
        self.history_list.insert(0, entry_text)
        self.history.append({"tagUid": tag_uid, "ok": ok, "payload": payload})

        self._focus_input()

    def _poll_language_warning(self):
        """เช็คภาษาที่ใช้อยู่เป็นระยะ ๆ แล้วเตือนถ้าไม่ใช่ EN"""
        is_english = get_current_keyboard_layout_is_english()

        if is_english is False:
            self.lang_warning.config(
                text="⚠️ ภาษาอินพุตปัจจุบันไม่ใช่ EN — กรุณากด Win+Space สลับเป็น EN ก่อนแตะบัตร"
            )
            if not self.lang_warning.winfo_ismapped():
                self.lang_warning.pack(fill="x", padx=20, pady=(0, 8), before=self.entry)
        else:
            if self.lang_warning.winfo_ismapped():
                self.lang_warning.pack_forget()

        # เช็คซ้ำทุก 1.5 วินาที
        self.root.after(1500, self._poll_language_warning)


def main():
    root = tk.Tk()
    app = RFIDReaderApp(root)

    def on_close():
        root.destroy()

    root.protocol("WM_DELETE_WINDOW", on_close)
    root.mainloop()


if __name__ == "__main__":
    main()