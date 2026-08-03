"""
rfid_reader.py
=================================================================
สคริปต์อ่านค่าจากเครื่องอ่านบัตร RFID (R80CP) โดยตรงผ่าน USB HID
โดยไม่ผ่าน browser / ไม่ปนกับคีย์บอร์ดจริงที่ต่อคอมอยู่

วิธีใช้งาน:
    python rfid_reader.py

สคริปต์จะ:
  1. สแกนหาอุปกรณ์ HID ทั้งหมดที่เสียบอยู่ในเครื่อง
  2. ให้เลือกอุปกรณ์ที่เป็นเครื่องอ่าน RFID จากรายการ (เลือกครั้งเดียว
     แล้วจำค่าไว้ให้อัตโนมัติในการรันครั้งถัดไป)
  3. เปิดอ่านข้อมูลดิบจากอุปกรณ์นั้นแบบเจาะจง (ผ่าน VID/PID)
  4. แปลงรหัสปุ่มกด (HID keycode) กลับเป็นตัวเลข แล้วพิมพ์ผลลัพธ์
     ทุกครั้งที่แตะบัตร 1 ใบ
=================================================================
"""

import hid
import json
import os
import sys
import time

# ไฟล์เก็บค่าที่เคยเลือกอุปกรณ์ไว้แล้ว จะได้ไม่ต้องเลือกใหม่ทุกครั้ง
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rfid_device.json")

# ตารางแปลงรหัสปุ่มกด HID keyboard usage code -> ตัวอักษรที่พิมพ์ออกมา
# ครอบคลุมตัวเลข 0-9 และปุ่ม Enter (เผื่อกรณีเครื่องส่งอักขระอื่นมาด้วย
# เช่น ; หรือ ? ก็เพิ่มในตารางนี้ได้)
HID_KEYCODE_MAP = {
    0x1e: "1", 0x1f: "2", 0x20: "3", 0x21: "4", 0x22: "5",
    0x23: "6", 0x24: "7", 0x25: "8", 0x26: "9", 0x27: "0",
    0x28: "ENTER",       # Enter
    0x2c: " ",           # Space (เผื่อบางรุ่นใช้คั่น)
    0x33: ";",           # ;
    0x38: "?",           # ? (shift + /)
    0x36: ",",           # ,
}


def clear_screen():
    os.system("cls" if os.name == "nt" else "clear")


def list_hid_devices():
    """แสดงรายการอุปกรณ์ HID ทั้งหมดที่เสียบอยู่ในเครื่อง"""
    devices = hid.enumerate()
    if not devices:
        print("⚠️  ไม่พบอุปกรณ์ HID ใด ๆ ในเครื่องเลย ลองเช็คว่าเสียบ USB แน่นหรือยัง")
        return []
    return devices


def choose_device_interactively(devices):
    """ให้ผู้ใช้เลือกอุปกรณ์จากลิสต์ พร้อมช่วยไฮไลต์ตัวที่น่าจะใช่"""
    print("\n=== พบอุปกรณ์ HID ทั้งหมดในเครื่อง ===\n")
    for i, d in enumerate(devices):
        name = d.get("product_string") or "(ไม่ทราบชื่อ)"
        manufacturer = d.get("manufacturer_string") or ""
        vid = d.get("vendor_id")
        pid = d.get("product_id")
        hint = ""
        # ช่วยเดาว่าตัวไหนน่าจะเป็นเครื่องอ่านบัตร ไม่ใช่คีย์บอร์ดจริง
        keywords = ["rfid", "reader", "card", "r80", "hid keyboard device"]
        if any(k in name.lower() for k in keywords):
            hint = "  <-- อาจจะเป็นตัวนี้"
        print(f"[{i}] {name}  ({manufacturer})  VID={hex(vid)} PID={hex(pid)}{hint}")

    print("\nเสียบเครื่องอ่านเข้า แล้วลองแตะบัตร 1 ครั้ง ถ้าไม่รู้ว่าตัวไหน "
          "ให้ลองถอดคีย์บอร์ดจริงออกชั่วคราวเพื่อให้เหลือน้อยตัวลง แล้วรันสคริปต์ใหม่")

    while True:
        try:
            choice = input("\nพิมพ์หมายเลข [เลข] ของอุปกรณ์ที่จะใช้ แล้วกด Enter: ").strip()
            idx = int(choice)
            if 0 <= idx < len(devices):
                return devices[idx]
            print("หมายเลขไม่อยู่ในรายการ ลองใหม่อีกครั้ง")
        except ValueError:
            print("กรุณาพิมพ์เป็นตัวเลขเท่านั้น")


def load_saved_device():
    """โหลดค่าอุปกรณ์ที่เคยเลือกไว้ล่าสุด (ถ้ามี)"""
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return None
    return None


def save_device(device_info):
    """บันทึกอุปกรณ์ที่เลือกไว้ เพื่อใช้อัตโนมัติในครั้งถัดไป"""
    data = {
        "vendor_id": device_info["vendor_id"],
        "product_id": device_info["product_id"],
        "path": device_info["path"].decode() if isinstance(device_info["path"], bytes) else device_info["path"],
        "product_string": device_info.get("product_string"),
    }
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def open_device(device_info):
    """เปิดอุปกรณ์ตาม path ที่เจาะจง (เจาะจงตัวเดียว ไม่ปนกับ HID ตัวอื่น)"""
    dev = hid.device()
    path = device_info["path"]
    dev.open_path(path if isinstance(path, bytes) else path.encode())
    dev.set_nonblocking(True)
    return dev


def decode_report(report_bytes):
    """
    แปลง HID report (โดยทั่วไปยาว 8 byte: [modifier, reserved, key1..key6])
    ให้กลายเป็นตัวอักษร/None ถ้าเป็น report ตอนปล่อยปุ่ม (ค่าว่างทั้งหมด)
    """
    if not report_bytes or all(b == 0 for b in report_bytes):
        return None  # เป็น report ตอนปล่อยปุ่ม ไม่ต้องสนใจ

    # byte index 2 เป็นต้นไปคือ keycode ที่กดอยู่ (มักมีแค่ตัวเดียวต่อ 1 ครั้ง)
    for keycode in report_bytes[2:]:
        if keycode != 0 and keycode in HID_KEYCODE_MAP:
            return HID_KEYCODE_MAP[keycode]
    return None


def main():
    clear_screen()
    print("=================================================")
    print("   โปรแกรมอ่านค่าเครื่องอ่านบัตร RFID (R80CP)")
    print("=================================================\n")

    try:
        import hid  # noqa: ตรวจซ้ำว่า import ได้จริง (เผื่อ error ตอน pip install ไม่ครบ)
    except ImportError:
        print("❌ ยังไม่ได้ติดตั้งไลบรารี hidapi กรุณารัน: pip install hidapi")
        sys.exit(1)

    saved = load_saved_device()
    device_info = None

    if saved:
        print(f"พบอุปกรณ์ที่เคยเลือกไว้: {saved.get('product_string')} "
              f"(VID={hex(saved['vendor_id'])} PID={hex(saved['product_id'])})")
        use_saved = input("ใช้อุปกรณ์ตัวนี้เหมือนเดิมไหม? (y/n): ").strip().lower()
        if use_saved != "n":
            device_info = saved

    if device_info is None:
        devices = list_hid_devices()
        if not devices:
            sys.exit(1)
        device_info = choose_device_interactively(devices)
        save_device(device_info)
        print(f"\n✅ บันทึกอุปกรณ์นี้ไว้แล้ว ครั้งหน้าจะถามให้เลือกเร็วขึ้น\n")

    try:
        dev = open_device(device_info)
    except OSError as e:
        print(f"❌ เปิดอุปกรณ์ไม่ได้: {e}")
        print("   ลองรันโปรแกรมในสิทธิ์ Administrator (Windows) แล้วลองใหม่")
        sys.exit(1)

    print("\n✅ เชื่อมต่อเครื่องอ่านสำเร็จ! พร้อมรับการแตะบัตรแล้ว")
    print("   (กด Ctrl+C เพื่อหยุดโปรแกรม)\n")

    buffer = ""

    try:
        while True:
            report = dev.read(64)  # อ่านค่าดิบจากอุปกรณ์แบบไม่บล็อกโปรแกรม
            if report:
                char = decode_report(report)
                if char == "ENTER":
                    if buffer:
                        print(f"📇 อ่านบัตรได้ค่า: {buffer}")
                        buffer = ""
                elif char is not None:
                    buffer += char
            time.sleep(0.005)  # หน่วงเล็กน้อยกันกิน CPU 100%
    except KeyboardInterrupt:
        print("\n\nปิดโปรแกรมแล้ว ขอบคุณที่ใช้งานครับ 👋")
    finally:
        dev.close()


if __name__ == "__main__":
    main()
