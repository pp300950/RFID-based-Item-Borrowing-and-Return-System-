"""
rfid_reader_serial.py
=================================================================
สคริปต์แยกต่างหาก — อ่านค่าเลขแท็ก RFID จาก "Serial port" (เช่น
Arduino/ESP32/โมดูล RFID-RC522 ที่ต่อ USB แล้วจำลองพอร์ตอนุกรม) แล้วยิง
POST ขึ้น backend ที่ /api/tap ทันทีที่อ่านได้ ไม่มีหน้าต่าง GUI ใดๆ
ทำงานเป็น loop รับค่าตลอดเวลาเหมือนเครื่องสแกนจริงที่ห้องทะเบียน

ต่างจาก rfid_reader_keyboard.py (เวอร์ชันเดิม) ตรงไหน:
  - เวอร์ชันเดิม: เครื่องอ่านพิมพ์ค่าเป็น "คีย์บอร์ด" (HID keyboard
    emulation) ต้องมีหน้าต่าง Tkinter คอยรับโฟกัสไว้ตลอดเวลา
  - เวอร์ชันนี้: อ่านค่าตรงจาก "Serial port" (pyserial) ไม่ต้องมี
    หน้าต่างใดๆ รับโฟกัส ไม่ต้องกังวลเรื่อง input language ของ Windows
    เพราะไม่ได้อาศัยการพิมพ์คีย์บอร์ดแล้ว

รูปแบบข้อมูลที่คาดหวังจากอุปกรณ์ (แก้ได้ถ้าอุปกรณ์จริงส่งมาไม่ตรงนี้):
  - อุปกรณ์ส่งเลขแท็กเป็นบรรทัดข้อความ ตามด้วย newline (\n หรือ \r\n)
    ทุกครั้งที่มีการแตะแท็ก เช่น "0012345678\n"
  - เลขแท็กต้องเป็นตัวเลขล้วน (ปรับ TAG_ID_PATTERN ได้ถ้าอุปกรณ์จริง
    ส่งมาเป็นรูปแบบอื่น เช่น hex)

การตั้งค่าก่อนใช้งาน (แก้ค่าคงที่ด้านล่างให้ตรงกับของจริง):
  - BACKEND_URL: URL ของ backend จริง (เช่น URL บน Render)
  - READER_ID: ต้องตรงกับที่ frontend (login.js) และ backend
    (tap.js / register_session.js) ใช้อยู่ — ปกติคือ "default"
  - SERIAL_PORT: ชื่อพอร์ตอนุกรมของอุปกรณ์
      Windows  เช่น "COM3", "COM5"
      Linux    เช่น "/dev/ttyUSB0", "/dev/ttyACM0"
      macOS    เช่น "/dev/cu.usbserial-XXXX"
    ถ้าไม่แน่ใจว่าเป็นพอร์ตไหน รันคำสั่ง:
      python -m serial.tools.list_ports
    เพื่อดูรายชื่อพอร์ตที่เสียบอยู่ทั้งหมด
  - BAUD_RATE: ต้องตรงกับที่อุปกรณ์ตั้งไว้ (ค่าที่พบบ่อยคือ 9600
    หรือ 115200 — ดูจากสเปค/โค้ดของอุปกรณ์ที่ใช้)

การติดตั้งไลบรารีที่ต้องใช้เพิ่ม (ยังไม่มีในเครื่องมาตรฐาน):
    pip install pyserial

วิธีใช้งาน:
    python rfid_reader_serial.py

โหมดทดสอบ (ไม่มีอุปกรณ์จริงต่ออยู่):
  ถ้าไม่มีอุปกรณ์ serial จริง สามารถรันโหมดจำลอง (คีย์บอร์ด -> POST
  ตรงๆ ไม่ผ่าน serial) ได้ด้วยแฟล็ก --simulate เช่น:
      python rfid_reader_serial.py --simulate
  โหมดนี้จะให้พิมพ์เลขแท็กเองใน terminal แล้วกด Enter เพื่อยิงขึ้น
  backend ทันที เพื่อทดสอบ flow ฝั่ง backend/frontend โดยไม่ต้องรอ
  อุปกรณ์จริง
=================================================================
"""

import argparse
import json
import re
import socket
import sys
import time
import urllib.error
import urllib.request

try:
    import serial
    import serial.tools.list_ports
    HAS_PYSERIAL = True
except ImportError:
    HAS_PYSERIAL = False


# -----------------------------------------------------------------
# ค่าตั้งต้น — แก้ตรงนี้ให้ตรงกับของจริงก่อนใช้งาน
# -----------------------------------------------------------------
BACKEND_URL = "https://rfid-5iaw.onrender.com"
TAP_ENDPOINT = f"{BACKEND_URL}/api/tap"
READER_ID = "default"  # ต้องตรงกับที่ tap.js / register_session.js / login.js ใช้

SERIAL_PORT = "COM3"      # แก้ให้ตรงกับพอร์ตจริงของอุปกรณ์
BAUD_RATE = 9600           # แก้ให้ตรงกับที่อุปกรณ์ตั้งไว้
SERIAL_TIMEOUT_SEC = 1     # timeout การอ่านแต่ละครั้ง (วินาที) — ไม่ใช่ timeout รวม
RECONNECT_DELAY_SEC = 3    # ถ้าเชื่อมต่อ serial หลุด รอกี่วินาทีก่อนลองใหม่

REQUEST_TIMEOUT_SEC = 5    # timeout การยิง POST ไปที่ backend

# ปรับตรงนี้ได้ถ้ารูปแบบเลขแท็กของอุปกรณ์จริงไม่ใช่ตัวเลขล้วน
TAG_ID_PATTERN = re.compile(r"^[0-9]+$")


# -----------------------------------------------------------------
# ยิง POST ขึ้น backend
# -----------------------------------------------------------------
def post_tap_to_backend(tag_uid, reader_id=READER_ID, timeout=REQUEST_TIMEOUT_SEC):
    """
    ยิง POST {tagUid, readerId} ไปที่ /api/tap แบบ synchronous

    คืนค่าเป็น tuple (ok: bool, payload: dict) เสมอ ไม่ raise ออกไปนอก
    ฟังก์ชันนี้:
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
            "message": f"เชื่อมต่อ backend ไม่สำเร็จ ({BACKEND_URL}) — ตรวจสอบว่า server เปิดอยู่หรือไม่ ({err.reason})",
        }
    except Exception as err:
        return False, {"ok": False, "message": f"เกิดข้อผิดพลาดที่ไม่คาดคิด: {err}"}


def log_line(icon, text):
    timestamp = time.strftime("%H:%M:%S")
    print(f"[{timestamp}] {icon} {text}", flush=True)


def handle_tag_read(raw_value):
    """
    รับค่าดิบ 1 บรรทัดจาก serial (หรือจาก terminal ในโหมด --simulate)
    กรอง แล้วยิงขึ้น backend พร้อม log ผลลัพธ์
    """
    raw_value = raw_value.strip()
    if not raw_value:
        return

    if not TAG_ID_PATTERN.match(raw_value):
        log_line("⚠️", f"ค่าที่อ่านได้ไม่ตรงรูปแบบเลขแท็กที่คาดไว้ ข้ามไป: {raw_value!r}")
        return

    log_line("📡", f"อ่านแท็กได้: {raw_value} — กำลังส่งไปยัง backend...")
    ok, payload = post_tap_to_backend(raw_value)

    message = payload.get("message") or ("สำเร็จ" if ok else "เกิดข้อผิดพลาดไม่ทราบสาเหตุ")
    state = payload.get("state")
    state_part = f" [{state}]" if state else ""

    if ok:
        log_line("✅", f"{raw_value}{state_part} — {message}")
    else:
        log_line("❌", f"{raw_value}{state_part} — {message}")


# -----------------------------------------------------------------
# โหมดจริง: อ่านจาก Serial port แบบ loop ต่อเนื่อง
# -----------------------------------------------------------------
def run_serial_loop():
    if not HAS_PYSERIAL:
        print("ไม่พบไลบรารี pyserial กรุณาติดตั้งก่อน: pip install pyserial", file=sys.stderr)
        sys.exit(1)

    print("=" * 60)
    print("RFID Reader (Serial mode) — ยิงขึ้น backend โดยตรง")
    print(f"Backend: {TAP_ENDPOINT}")
    print(f"Reader ID: {READER_ID}")
    print(f"Serial port: {SERIAL_PORT} @ {BAUD_RATE} baud")
    print("กด Ctrl+C เพื่อหยุดโปรแกรม")
    print("=" * 60)

    while True:  # loop นอก: เผื่อ serial หลุดแล้วต้องเชื่อมต่อใหม่
        try:
            with serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=SERIAL_TIMEOUT_SEC) as ser:
                log_line("🔌", f"เชื่อมต่อ {SERIAL_PORT} สำเร็จ พร้อมรับการแตะแท็ก")
                buffer = b""

                while True:  # loop ใน: อ่านค่าต่อเนื่องตราบใดที่ยัง connect อยู่
                    chunk = ser.readline()  # อ่านจนเจอ \n หรือจน timeout
                    if not chunk:
                        continue  # timeout เฉยๆ ไม่มีข้อมูลเข้ามา วนต่อ

                    try:
                        line = chunk.decode("utf-8", errors="ignore")
                    except Exception:
                        continue

                    handle_tag_read(line)

        except serial.SerialException as err:
            log_line("⚠️", f"เชื่อมต่อ serial ไม่ได้/หลุด ({err}) — ลองใหม่ใน {RECONNECT_DELAY_SEC} วินาที")
            time.sleep(RECONNECT_DELAY_SEC)
        except KeyboardInterrupt:
            print("\nหยุดโปรแกรมแล้ว")
            sys.exit(0)


# -----------------------------------------------------------------
# โหมดจำลอง: พิมพ์ค่าเองใน terminal แทนอุปกรณ์จริง (ไม่ต้องมี pyserial)
# -----------------------------------------------------------------
def run_simulate_loop():
    print("=" * 60)
    print("RFID Reader (โหมดจำลอง — ไม่ใช้ serial) — ยิงขึ้น backend โดยตรง")
    print(f"Backend: {TAP_ENDPOINT}")
    print(f"Reader ID: {READER_ID}")
    print("พิมพ์เลขแท็กแล้วกด Enter เพื่อจำลองการแตะบัตร")
    print("กด Ctrl+C เพื่อหยุดโปรแกรม")
    print("=" * 60)

    while True:
        try:
            raw_value = input("แตะแท็ก (พิมพ์เลข) > ")
        except (EOFError, KeyboardInterrupt):
            print("\nหยุดโปรแกรมแล้ว")
            sys.exit(0)

        handle_tag_read(raw_value)


def list_serial_ports():
    if not HAS_PYSERIAL:
        print("ไม่พบไลบรารี pyserial กรุณาติดตั้งก่อน: pip install pyserial", file=sys.stderr)
        sys.exit(1)

    ports = list(serial.tools.list_ports.comports())
    if not ports:
        print("ไม่พบพอร์ต serial ใดๆ ในเครื่องนี้")
        return

    print("พอร์ต serial ที่พบในเครื่องนี้:")
    for p in ports:
        print(f"  {p.device} — {p.description}")


def main():
    parser = argparse.ArgumentParser(description="RFID reader (serial) -> POST /api/tap")
    parser.add_argument(
        "--simulate",
        action="store_true",
        help="โหมดจำลอง: พิมพ์เลขแท็กเองใน terminal แทนอุปกรณ์ serial จริง",
    )
    parser.add_argument(
        "--list-ports",
        action="store_true",
        help="แสดงรายชื่อพอร์ต serial ที่เสียบอยู่ในเครื่องนี้แล้วออกจากโปรแกรม",
    )
    args = parser.parse_args()

    if args.list_ports:
        list_serial_ports()
        return

    if args.simulate:
        run_simulate_loop()
    else:
        run_serial_loop()


if __name__ == "__main__":
    main()
