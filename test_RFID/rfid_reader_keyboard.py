"""
rfid_reader_keyboard.py
=================================================================
สคริปต์อ่านค่าเครื่องอ่านบัตร RFID (R80CP / Sycreader RFID Technology)
โดยใช้วิธี "Keyboard Emulation" แทนการเปิดอ่าน raw HID โดยตรง

ทำไมต้องเปลี่ยนวิธี:
  เครื่องอ่านรุ่นนี้ถูกออกแบบให้ Windows มองเป็นคีย์บอร์ดมาตรฐาน (HID
  keyboard class) ทำให้ Windows ยึด driver ไว้แบบ exclusive การเปิด
  อ่าน raw HID report ตรง ๆ ผ่าน hidapi จึงเจอ OSError: read error
  ตลอดเวลา (เปิด device ได้ แต่ read() ไม่ได้)

  วิธีนี้จึงเปลี่ยนมาปล่อยให้ Windows จัดการมันเป็นคีย์บอร์ดตามปกติ
  แล้วให้โปรแกรมนี้ "รับฟัง" ค่าที่มันพิมพ์เข้ามาในช่อง input ที่
  โฟกัสค้างไว้ตลอดเวลาแทน เมื่อแตะบัตร เครื่องจะพิมพ์ตัวเลขบัตร
  ตามด้วย Enter อัตโนมัติ

ข้อควรระวังสำคัญ:
  เครื่องอ่านส่ง "HID keycode ดิบ" ซึ่ง Windows จะตีความตาม keyboard
  layout / input language ที่ active อยู่ตอนนั้น ถ้า layout เป็น
  ภาษาไทย ตัวเลขที่ควรได้จะกลายเป็นตัวอักษรไทยเพี้ยน ๆ แทน
  โปรแกรมนี้จึงมีระบบเตือนและกรองอักขระที่ไม่ใช่ตัวเลขออกอัตโนมัติ
  พร้อมแจ้งเตือนให้ผู้ใช้สลับภาษาเป็น EN หากตรวจพบว่าค่าที่ได้ผิดปกติ

วิธีใช้งาน:
    python rfid_reader_keyboard.py

ก่อนใช้งาน:
  - สลับ input language ของ Windows เป็น ENG (กด Win+Space) ก่อนแตะบัตร
  - เปิดโปรแกรมนี้ทิ้งไว้ แล้วห้ามคลิกไปที่หน้าต่างอื่นระหว่างแตะบัตร
    (โปรแกรมจะพยายามดึงโฟกัสกลับให้อัตโนมัติ)
=================================================================
"""

import re
import sys
import time
import tkinter as tk
from tkinter import ttk, messagebox

try:
    import ctypes
    IS_WINDOWS = sys.platform.startswith("win")
except ImportError:
    IS_WINDOWS = False


# ปรับตรงนี้ได้ถ้ารูปแบบเลขบัตรของคุณไม่ใช่ตัวเลขล้วน
CARD_ID_PATTERN = re.compile(r"^[0-9]+$")


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


class RFIDReaderApp:
    def __init__(self, root):
        self.root = root
        self.root.title("เครื่องอ่านบัตร RFID (R80CP)")
        self.root.geometry("640x520")
        self.root.configure(bg="#1e1e2e")
        self.root.resizable(False, False)

        self.history = []  # เก็บ log บัตรที่อ่านได้ในเซสชันนี้
        self.raw_buffer_before_filter = ""  # เก็บค่าดิบไว้เผื่อ debug

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
        subtitle.pack(pady=(0, 12))

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

        # ช่อง input ที่ใช้ดักค่าจากเครื่องอ่าน (ซ่อนตัวอักษรที่พิมพ์เพื่อความสะอาดตา
        # แต่ยังคงรับ input ปกติ ไม่ใช้ show="*" เพราะอยากเห็น debug ได้ตอนพัฒนา)
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
        last_read_frame.pack(pady=(4, 16))
        tk.Label(
            last_read_frame, text="ค่าล่าสุด:", font=("Tahoma", 11),
            fg="#a6adc8", bg="#1e1e2e",
        ).pack(side="left")
        self.last_value_label = tk.Label(
            last_read_frame, text="-", font=("Consolas", 14, "bold"),
            fg="#a6e3a1", bg="#1e1e2e",
        )
        self.last_value_label.pack(side="left", padx=(8, 0))

        # ประวัติการอ่านบัตร
        history_label = tk.Label(
            self.root, text="ประวัติการอ่านล่าสุด", font=("Tahoma", 10, "bold"),
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

        timestamp = time.strftime("%H:%M:%S")

        if CARD_ID_PATTERN.match(raw_value):
            # ค่าปกติ เป็นตัวเลขล้วนตามที่คาดไว้
            self.last_value_label.config(text=raw_value, fg="#a6e3a1")
            entry_text = f"[{timestamp}] 📇 {raw_value}"
            self.history.append(raw_value)
        else:
            # ค่าผิดปกติ (มักเกิดจาก input language ไม่ใช่ EN ตอนแตะบัตร)
            self.last_value_label.config(text="⚠️ ค่าผิดปกติ ดูประวัติ", fg="#f38ba8")
            entry_text = f"[{timestamp}] ⚠️ ค่าที่อ่านได้ไม่ใช่ตัวเลข: {raw_value!r}"
            messagebox.showwarning(
                "ค่าที่อ่านได้ผิดปกติ",
                "ได้ค่าที่ไม่ใช่ตัวเลขล้วนจากเครื่องอ่าน\n\n"
                f"ค่าที่ได้: {raw_value}\n\n"
                "สาเหตุที่พบบ่อยที่สุดคือ input language ของ Windows "
                "ไม่ได้ตั้งเป็น EN ตอนแตะบัตร กรุณาสลับเป็น EN "
                "(กด Win+Space) แล้วลองแตะบัตรใหม่อีกครั้ง",
            )

        self.history_list.insert(0, entry_text)
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
