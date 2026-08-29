/** =====================================================
 * ESP32 TFT_eSPI Multi-Brand Air Conditioner Monitor 
 * Project: V.V.Prom Smart Test Inverter Analyzer
 * Board: ESP32 (Display 480x320)
 * =====================================================
 */
#include <SPI.h>
#include <TFT_eSPI.h>
#include <LittleFS.h>   // เพิ่มบรรทัดนี้
#include "soc/gpio_struct.h"

// ================= HARDWARE CONFIG =================
#define TFT_BL 32     
#define BUZZER_PIN 27 

TFT_eSPI tft = TFT_eSPI();

// ================= DAIKIN SNIFFER CONFIG =================
#define CHANNEL_PIN 17
#define MAX_EDGES 10000
#define TIMEOUT_US 320000
#define BIT_WIDTH_US 805
#define AC_SCALE_FACTOR 2.0 

// ================= HAIER & EMINENT CONFIG & VARIABLES =================
#define HAIER_RX_PIN 17            
#define OFFSET 64             
#define AMP_LIMIT 12.0                

#define VBUS_STANDBY 315.0      
#define VBUS_MIN 225.0                          
#define VBUS_DROP_FACTOR 0.45                   

#define FAN_BASE_RPM 300                        
#define FAN_MAX_RPM 900                         
#define FAN_HZ_FACTOR 5.0                       
#define FAN_AMP_FACTOR 20.0                     

#define HEATSINK_BASE_TEMP 35                   
#define HEATSINK_MAX_TEMP 95                    
#define HEATSINK_HZ_FACTOR 0.3                  
#define HEATSINK_AMP_FACTOR 2.0                 

// Daikin Telemetry Variables (Raw)
float lastTemp6 = 0.0;
float lastTemp9 = 0.0;
float lastTemp12 = 0.0;
float lastCompFreq = 0.0;
float lastDcBus = 0.0;
float lastEevSteps = 0.0;
float lastAmpsBase = 0.0; 
float lastAmpsScaled = 0.0; 
float lastIpmTemp = 0.0; 
String lastErrorCode = "00";

// Smoothed Variables
float f_freq = 0, f_amp = 0, f_out_t = 0, f_coil = 0, f_disch = 0;
float f_ipm_t = 0, f_dc_bus = 0, f_eev = 0, f_fan = 0;

static uint32_t edgeTimes[MAX_EDGES];
static uint8_t edgeStates[MAX_EDGES];
static uint32_t edgeCount = 0;

// ================= GLOBAL VARIABLES =================
int currentMode = 0;   
int selectedBrand = 0; 
int currentPage = 0;   
String currentSubMode = ""; 

uint16_t MY_BG, MY_TEXT;

// Monitor UI Variables 
String ac_status = "OFF";
String ac_freq = "";
String ac_amp = "";
String ac_out_t = "";
String ac_coil = "";
String ac_disch = "";
String ac_ipm_t = "";
String ac_dc_bus = "";
String ac_eev = "";
String ac_fan = "";
String ac_press_l = "";
String ac_press_h = "";
String ac_error_code = "";
String ac_error_code_raw = "";   // เก็บเฉพาะ "รหัส" ล้วนๆ เช่น "E5" หรือ "00" ไว้แปลภาษาทีหลัง
String last_diagnostic_en = "";
String last_diagnostic_th = "";

// TIMER VARIABLES (ตัวแปรระบบจับเวลาเพิ่มเติม)
unsigned long timerStartTime = 0;
String ac_timer = "00:00:00";
String p_ac_timer = "";

// ตัวแปรเก็บค่าเก่า
String p_ac_status = "", p_ac_freq = "", p_ac_amp = "", p_ac_out_t = "";
String p_ac_coil = "", p_ac_disch = "", p_ac_ipm_t = "", p_ac_dc_bus = "";
String p_ac_eev = "", p_ac_fan = "", p_ac_press_l = "", p_ac_press_h = "";
String p_ac_error_code = "";

// Indoor UI Variables
String ac_in_status = "OFF";
String ac_in_model = "";
String ac_in_set = "";
String ac_in_room = "";
String ac_in_coil = "";
String ac_in_fan = "";

String p_ac_in_status = "", p_ac_in_model = "", p_ac_in_set = "";
String p_ac_in_room = "", p_ac_in_coil = "", p_ac_in_fan = "";

// ================= SCOPE VARIABLES =================
int scopeTimebase = 5;      
bool isScopeRunning = true; 
const int SCOPE_X = 10;
const int SCOPE_Y = 40;
const int SCOPE_W = 460;
const int SCOPE_H = 200;
int scopeX_pos = 0;
int last_scopeY = SCOPE_Y + SCOPE_H - 30; 
int currentSignalState = 0;   

// ================= BUTTON CONFIG =================
const int btnW = 140, btnH = 70;  
const int colX[3] = {15, 170, 325};  
const int rowY[3] = {45, 125, 205};  

const int subBtnW = 200, subBtnH = 80;
const int subBtnX_1 = 30, subBtnX_2 = 250, subBtnY = 160;

const int backBtnW = 100, backBtnH = 40;
const int backBtnX = 365, backBtnY = 15;

const String brandNames[24] = {
  "DAIKIN",     "HAIER",       "MITSUBISHI",
  "HEAVY DUTY", "CARRIER",     "MIDEA",
  "EMINENT",    "SAMSUNG",     "LG",          
  "PANASONIC",  "GREE",        "AUX",         
  "TCL",        "HITACHI",     "SHARP",       
  "YORK",       "TOSHIBA",     "AIR CANDY",   
  "BEKO",       "TASAKI",      "STAR AIRE",   
  "UNIAIR",     "SAIJO DENKI", "SINGER"
};

uint16_t brandColors[24]; 

// Signal Variables
bool signalConnected = false;      
bool isCommError = false;   // true = สัญญาณขาดจริง, ใช้แยกจาก error code ปกติ  
unsigned long lastSignalBlink = 0;   
unsigned long lastSignalReceived = 0;
bool signalStateOn = false;          
bool forceIconUpdate = true; 

// ================= ERROR LANGUAGE TOGGLE =================
bool errorShowThai = false;   // false = English (default), true = Thai

const int signalBlinkInterval = 500; 
const int signalTimeout = 2000;      

// ================= FUNCTION DECLARATIONS =================
void drawSplashScreen();
void drawMainMenu();
void drawBrandScreen(int brandIndex);
void drawDevScreen(int brandIndex); 
void drawMonitoringScreen(int brandIndex, String modeTitle);
void drawScopeScreen(int brandIndex);
void updateScopeSignal();
void draw3DButton(int x, int y, int w, int h, uint16_t btnColor, uint16_t screenBgColor, String text, bool isPressed, bool isBlackText);
void beep();
void setThaiFont();
String getDaikinErrorDesc(String code);
String getDaikinErrorDescThai(String code);
String getDaikinErrorDesc(String code);
void drawSignalIcon(int x, int y, uint16_t colorOn, uint16_t colorOff, bool stateOn);
void updateSignalMonitorBlink(int brandIndex, String modeTitle);
void feedSignal(); 
void handleAirconCommunication(int brandIndex, String mode);
void sendAirconCommand(int brandIndex, String command);
void updateMonitoringValues();
void smoothValue(float &smoothed, float target, float factor, float snapThreshold);
String calculatePressH(float temp);
String calculatePressL(float temp);

// ================= PRESSURE H LOOKUP TABLE (R-32) =================
struct PressurePoint { float temp; float press; };
const PressurePoint pressLookupTable[] = {
  {-40.0, 11.0}, {-37.2, 14.4}, {-34.4, 18.2}, {-31.7, 22.3},
  {-28.9, 26.8}, {-26.1, 31.7}, {-23.3, 37.1}, {-20.6, 42.9},
  {-17.8, 49.3}, {-15.0, 56.1}, {-12.2, 63.5}, {-9.4, 71.5},
  {-6.7, 80.0}, {-3.9, 89.2}, {-1.1, 99.1}, {1.7, 109.7},
  {4.4, 121.0}, {7.2, 133.0}, {10.0, 145.9}, {12.8, 159.5},
  {15.6, 174.1}, {18.3, 189.5}, {21.1, 205.8}, {23.9, 223.2},
  {26.7, 241.5}, {29.4, 260.9}, {32.2, 281.3}, {35.0, 302.9},
  {37.8, 325.7}, {40.6, 349.6}, {43.3, 374.9}, {46.1, 401.4},
  {48.9, 429.3}, {51.7, 458.6}, {54.4, 489.4}, {57.2, 521.8},
  {60.0, 555.7}, {62.8, 591.4}, {65.6, 628.8}
};
const int PRESS_TABLE_SIZE = sizeof(pressLookupTable) / sizeof(pressLookupTable[0]);

String calculatePressH(float temp) {
  if (temp < 37.8) return "";
  if (temp < pressLookupTable[0].temp) return String((int)(pressLookupTable[0].press + 0.5));
  if (temp > pressLookupTable[PRESS_TABLE_SIZE - 1].temp) return String((int)(pressLookupTable[PRESS_TABLE_SIZE - 1].press + 0.5));
  
  for (int i = 0; i < PRESS_TABLE_SIZE - 1; i++) {
    if (temp >= pressLookupTable[i].temp && temp <= pressLookupTable[i+1].temp) {
      float x0 = pressLookupTable[i].temp, y0 = pressLookupTable[i].press;
      float x1 = pressLookupTable[i+1].temp, y1 = pressLookupTable[i+1].press;
      float interpolated = y0 + (temp - x0) * (y1 - y0) / (x1 - x0);
      return String((int)(interpolated + 0.5)); // แสดงค่าแบบไม่มีจุดทศนิยม
    }
  }
  return "";
}

String calculatePressL(float temp) {
  if (temp < 12.8) return "";
  if (temp < pressLookupTable[0].temp) return String((int)(pressLookupTable[0].press + 0.5));
  if (temp > pressLookupTable[PRESS_TABLE_SIZE - 1].temp) return String((int)(pressLookupTable[PRESS_TABLE_SIZE - 1].press + 0.5));
  
  for (int i = 0; i < PRESS_TABLE_SIZE - 1; i++) {
    if (temp >= pressLookupTable[i].temp && temp <= pressLookupTable[i+1].temp) {
      float x0 = pressLookupTable[i].temp, y0 = pressLookupTable[i].press;
      float x1 = pressLookupTable[i+1].temp, y1 = pressLookupTable[i+1].press;
      float interpolated = y0 + (temp - x0) * (y1 - y0) / (x1 - x0);
      return String((int)(interpolated + 0.5)); // แสดงค่าแบบไม่มีจุดทศนิยม
    }
  }
  return "";
}

// ================= DAIKIN DECODER FUNCTIONS =================
struct DataPoint { float hz; float amps; };
const DataPoint ampLookupTable[] = {
  {11.0, 0.60}, {22.0, 0.44}, {32.0, 0.46}, {44.0, 0.52},
  {68.0, 0.62}, {80.0, 0.87}, {86.0, 0.80}, {88.0, 0.82}
};
const int TABLE_SIZE = sizeof(ampLookupTable) / sizeof(ampLookupTable[0]);

float calculateBaseAmps(float hz) {
  if (hz == 0.0) return 0.0;
  if (hz <= ampLookupTable[0].hz) return ampLookupTable[0].amps;
  if (hz >= ampLookupTable[TABLE_SIZE - 1].hz) return ampLookupTable[TABLE_SIZE - 1].amps;
  for (int i = 0; i < TABLE_SIZE - 1; i++) {
    if (hz >= ampLookupTable[i].hz && hz <= ampLookupTable[i+1].hz) {
      float x0 = ampLookupTable[i].hz, y0 = ampLookupTable[i].amps;
      float x1 = ampLookupTable[i+1].hz, y1 = ampLookupTable[i+1].amps;
      return y0 + (hz - x0) * (y1 - y0) / (x1 - x0);
    }
  }
  return 0.0;
}

float decodeTemperature(uint8_t rawByte) {
  uint8_t rev = 0;
  for (int i = 0; i < 8; i++) {
    if (rawByte & (1 << i)) rev |= (1 << (7 - i));
  }
  uint8_t inv = ~rev; return inv / 2.0;
}

float decodeCompressorFreq(uint8_t rawByte) {
  uint8_t rev = 0;
  for (int i = 0; i < 8; i++) {
    if (rawByte & (1 << i)) rev |= (1 << (7 - i));
  }
  uint8_t inv = ~rev; return inv / 2.0;
}

String decodeDaikinError(uint8_t rawByte) {
  uint8_t rev = 0;
  for (int i = 0; i < 8; i++) {
    if (rawByte & (1 << i)) rev |= (1 << (7 - i));
  }
  uint8_t val = ~rev;
  switch(val) {
    case 0: return "00";
    case 1: return "A1"; case 2: return "A3"; case 3: return "A5"; case 4: return "A6";
    case 5: return "A7"; case 6: return "A9"; case 7: return "AF"; case 8: return "C4";
    case 9: return "C5"; case 10: return "C7"; case 11: return "C9"; case 12: return "CJ";
    case 13: return "U0"; case 14: return "U2"; case 15: return "U4"; case 16: return "U5";
    case 17: return "U7"; case 18: return "U8"; case 19: return "U9"; case 20: return "UA";
    case 21: return "UC"; case 22: return "UH"; case 23: return "E1"; case 24: return "E3";
    case 25: return "E4"; case 32: return "E5"; case 27: return "E6"; case 28: return "E7";
    case 29: return "E8"; case 30: return "F3"; case 31: return "F6"; case 26: return "H3";
    case 130: return "H6"; case 110: return "H7"; case 35: return "H8"; case 68: return "H9";
    case 72: return "J3"; case 38: return "J5"; case 70: return "J6"; case 40: return "J8";
    case 41: return "L1"; case 42: return "L3"; case 43: return "L4"; case 44: return "L5";
    case 45: return "L8"; case 46: return "L9"; case 47: return "LC"; case 48: return "P1";
    case 49: return "P4"; case 50: return "PJ"; case 136: return "H0";
    default: return String(val);
  }
}

// ================= ERROR DESCRIPTIONS: ENGLISH (default) =================
String getDaikinErrorDesc(String code) {
  if(code == "00") return "Normal";
  if(code == "A1") return "Indoor PCB defect";
  if(code == "A3") return "Drain pump abnormal";
  if(code == "A5") return "Antifreeze protection";
  if(code == "A6") return "Indoor fan motor error";
  if(code == "A7") return "Swing motor error";
  if(code == "A9") return "EEV error";
  if(code == "AF") return "Drain level over limit";
  if(code == "C4") return "Indoor coil thermistor error";
  if(code == "C5") return "Gas pipe thermistor error";
  if(code == "C7") return "Louver limit switch error";
  if(code == "C9") return "Room temp sensor error";
  if(code == "CJ") return "Remote thermistor error";
  if(code == "U0") return "Refrigerant shortage";
  if(code == "U2") return "Voltage abnormal";
  if(code == "U4") return "Indoor-Outdoor comm error";
  if(code == "U5") return "Remote comm error";
  if(code == "U7") return "Outdoor comm error";
  if(code == "U8") return "Main-Sub remote comm error";
  if(code == "U9") return "System comm error";
  if(code == "UA") return "Field setting error";
  if(code == "UC") return "Address setting error";
  if(code == "UH") return "System malfunction";
  if(code == "E1") return "Outdoor PCB error";
  if(code == "E3") return "High pressure error";
  if(code == "E4") return "Low pressure error";
  if(code == "E5") return "Compressor overload";
  if(code == "E6") return "Compressor overcurrent";
  if(code == "E7") return "Outdoor fan motor error";
  if(code == "E8") return "Input overcurrent";
  if(code == "F3") return "Discharge temp too high";
  if(code == "F6") return "High pressure control";
  if(code == "H0") return "Compressor sensor fault";
  if(code == "H3") return "High pressure switch error";
  if(code == "H6") return "Compressor position error";
  if(code == "H7") return "Outdoor fan signal error";
  if(code == "H8") return "CT sensor error";
  if(code == "H9") return "Outdoor air thermistor error";
  if(code == "J3") return "Discharge thermistor error";
  if(code == "J5") return "Suction thermistor error";
  if(code == "J6") return "Outdoor coil thermistor error";
  if(code == "J8") return "Liquid pipe thermistor error";
  if(code == "L1") return "Inverter PCB error";
  if(code == "L3") return "Control box temp too high";
  if(code == "L4") return "Heat sink overheat";
  if(code == "L5") return "Inverter comp overcurrent";
  if(code == "L8") return "Inverter comp overload";
  if(code == "L9") return "Compressor locked";
  if(code == "LC") return "Inverter-Outdoor comm error";
  if(code == "P1") return "Inverter voltage unbalanced";
  if(code == "P4") return "Heat sink thermistor error";
  if(code == "PJ") return "Capacity setting error";
  return "Unknown code";
}

// ================= ERROR DESCRIPTIONS: THAI (shown on tap) =================
String getDaikinErrorDescThai(String code) {
  if(code == "00") return "ทำงานปกติ";
  if(code == "A1") return "บอร์ดคอยล์เย็นเสีย";
  if(code == "A3") return "ปั๊มน้ำทิ้งผิดปกติ";
  if(code == "A5") return "ป้องกันน้ำแข็งเกาะ";
  if(code == "A6") return "พัดลมคอยล์เย็นเสีย";
  if(code == "A7") return "มอเตอร์สวิงผิดปกติ";
  if(code == "A9") return "วาล์ว EEV ผิดปกติ";
  if(code == "AF") return "น้ำทิ้งล้น";
  if(code == "C4") return "เซนเซอร์คอยล์เย็นเสีย";
  if(code == "C5") return "เซนเซอร์ท่อแก๊สเสีย";
  if(code == "C7") return "สวิตช์บานสวิงเสีย";
  if(code == "C9") return "เซนเซอร์อุณหภูมิห้อง";
  if(code == "CJ") return "เซนเซอร์รีโมทผิดปกติ";
  if(code == "U0") return "น้ำยาแอร์ขาด";
  if(code == "U2") return "แรงดันไฟตก-เกิน";
  if(code == "U4") return "สื่อสารคอยล์เย็น-ร้อนผิดปกติ";
  if(code == "U5") return "สื่อสารรีโมทผิดปกติ";
  if(code == "U7") return "สื่อสารคอยล์ร้อนผิดปกติ";
  if(code == "U8") return "สื่อสารรีโมทหลัก-รอง";
  if(code == "U9") return "สื่อสารระบบผิดปกติ";
  if(code == "UA") return "ตั้งค่าระบบผิดพลาด";
  if(code == "UC") return "ตั้งค่า Address ผิด";
  if(code == "UH") return "ระบบทำงานผิดพลาด";
  if(code == "E1") return "บอร์ดคอยล์ร้อนเสีย";
  if(code == "E3") return "แรงดันน้ำยาสูงเกิน";
  if(code == "E4") return "แรงดันน้ำยาต่ำเกิน";
  if(code == "E5") return "คอมเพรสเซอร์โหลดเกิน";
  if(code == "E6") return "กระแสคอมเพรสเซอร์เกิน";
  if(code == "E7") return "พัดลมคอยล์ร้อนเสีย";
  if(code == "E8") return "กระแสไฟเข้าเกิน";
  if(code == "F3") return "อุณภูมิท่อส่งสูงเกิน";
  if(code == "F6") return "แรงดันขณะทำความเย็นสูง";
  if(code == "H0") return "เซนเซอร์ระบบคอมเพรสเซอร์ขัดข้อง";
  if(code == "H3") return "สวิตช์แรงดันสูงผิดปกติ";
  if(code == "H6") return "ตรวจจับตำแหน่งคอมฯ ผิดพลาด";
  if(code == "H7") return "สัญญาณพัดลมคอยล์ร้อนเสีย";
  if(code == "H8") return "เซนเซอร์กระแสไฟผิดปกติ";
  if(code == "H9") return "เซนเซอร์อุณหภูมิภายนอก";
  if(code == "J3") return "เซนเซอร์ท่อส่งเสีย";
  if(code == "J5") return "เซนเซอร์ท่อดูดเสีย";
  if(code == "J6") return "เซนเซอร์คอยล์ร้อนเสีย";
  if(code == "J8") return "เซนเซอร์ท่อของเหลวเสีย";
  if(code == "L1") return "บอร์ดอินเวอร์เตอร์เสีย";
  if(code == "L3") return "อุณหภูมิกล่องคอนโทรลสูง";
  if(code == "L4") return "ฮีตซิงก์ร้อนเกิน";
  if(code == "L5") return "กระแสคอมฯ อินเวอร์เตอร์เกิน";
  if(code == "L8") return "คอมฯ อินเวอร์เตอร์โหลดเกิน";
  if(code == "L9") return "คอมเพรสเซอร์ล็อค";
  if(code == "LC") return "สื่อสารอินเวอร์เตอร์-คอยล์ร้อนเสีย";
  if(code == "P1") return "แรงดันไฟอินเวอร์เตอร์ไม่สมดุล";
  if(code == "P4") return "เซนเซอร์ฮีตซิงก์ผิดปกติ";
  if(code == "PJ") return "ตั้งค่าขนาดความจุผิดพลาด";
  return "รหัสไม่ตรงกับการสื่อสาร";
}

void processBits(String bits) {
  if (bits.length() < 40) return;
  uint8_t headerVal = 0;
  if (bits.length() >= 8) {
    headerVal = (uint8_t)strtol(bits.substring(0, 8).c_str(), NULL, 2);
  }
  
  bool isValidTelemetryPacket = false;

  if (headerVal == 190) {
    isValidTelemetryPacket = true;
    for (int i = 0; i < bits.length(); i += 8) {
      String b = bits.substring(i, i+8);
      uint8_t val = (uint8_t)strtol(b.c_str(), NULL, 2);
      int currentByte = i / 8;
      
      if (currentByte == 6) {
        float temp = decodeTemperature(val);
        if (temp >= 6.0 && temp <= 60.0) lastTemp6 = temp;
      } else if (currentByte == 9) {
        float temp = decodeTemperature(val);
        if (temp >= 6.0 && temp <= 95.0 && temp != 77.0) lastTemp9 = temp;
      } else if (currentByte == 12) {
        float temp = decodeTemperature(val);
        if (temp >= 6.0 && temp <= 127.0 && temp != 81.0) lastTemp12 = temp;
      } else if (currentByte == 15) {
        float freq = decodeCompressorFreq(val);
        if (freq <= 100.0) {
          lastCompFreq = freq;
          if (lastCompFreq == 0) lastDcBus = 0.0;
          else {
            lastDcBus = 319.0 - (lastCompFreq * 0.9);
            if(lastDcBus < 0) lastDcBus = 0;
          }
        }
      } else if (currentByte == 18) {
        lastErrorCode = decodeDaikinError(val);
      }
    }
  }

  if (isValidTelemetryPacket) {
    if (lastCompFreq == 0) lastEevSteps = 0;
    else {
      lastEevSteps = lastCompFreq * 4.8;
      if (lastEevSteps > 480) lastEevSteps = 480;
    }
    
    lastAmpsBase = calculateBaseAmps(lastCompFreq);
    lastAmpsScaled = lastAmpsBase * AC_SCALE_FACTOR;

    if (lastCompFreq == 0) {
      lastIpmTemp = (lastTemp9 > 0) ? (lastTemp9 + 2.0) : 32.0; 
    } else {
      lastIpmTemp = (lastTemp9 * 0.5) + (lastCompFreq * 0.6) + 5.0;
      if (lastIpmTemp > 95.0) lastIpmTemp = 95.0; 
    }
  }
}

void decodeEdges() {
  if (edgeCount < 2) return;
  String packetBits = "";
  for (uint32_t i = 0; i < edgeCount - 1; i++) {
    uint32_t duration = edgeTimes[i+1] - edgeTimes[i];
    uint8_t state = edgeStates[i];
    int bitCount = round((float)duration / BIT_WIDTH_US);
    
    if (bitCount > 20) {
      if (packetBits.length() > 30) processBits(packetBits);
      packetBits = "";
    } else {
      for (int b = 0; b < bitCount; b++) {
        packetBits += (state ? '1' : '0');
      }
    }
  }
  if (packetBits.length() > 30) processBits(packetBits);
}

void capture() {
  uint32_t startMicros = micros();
  uint8_t lastState = (GPIO.in >> CHANNEL_PIN) & 1;
  edgeCount = 0;
  edgeTimes[edgeCount] = 0;
  edgeStates[edgeCount] = lastState;
  edgeCount++;
  
  while (edgeCount < MAX_EDGES) {
    uint32_t now = micros();
    uint8_t state = (GPIO.in >> CHANNEL_PIN) & 1;
    if (state != lastState) {
      edgeTimes[edgeCount] = now - startMicros;
      edgeStates[edgeCount] = state;
      edgeCount++;
      lastState = state;
    }
    if (now - startMicros > TIMEOUT_US) break;
  }
}

// =====================================================
// SETUP
// =====================================================
void setup() {
  Serial.begin(115200);

  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, HIGH);

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  pinMode(CHANNEL_PIN, INPUT_PULLUP);

  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS Mount Failed");
  }

  tft.init();
  tft.setRotation(1);      
  tft.invertDisplay(true); 

  tft.setAttribute(UTF8_SWITCH, true); 
  tft.loadFont("Thai20", LittleFS);    

  uint16_t calData[5] = { 275, 3620, 264, 3535, 1 };
  tft.setTouch(calData);

  brandColors[0]  = tft.color565(0, 150, 255);   // DAIKIN
  brandColors[1]  = tft.color565(0, 100, 200);   // HAIER
  brandColors[2]  = tft.color565(220, 20, 40);   // MITSUBISHI
  brandColors[3]  = tft.color565(255, 180, 0);   // HEAVY DUTY
  brandColors[4]  = tft.color565(0, 85, 166);    // CARRIER
  brandColors[5]  = tft.color565(0, 180, 220);   // MIDEA
  brandColors[6]  = tft.color565(0, 128, 0);     // EMINENT
  brandColors[7]  = tft.color565(20, 40, 160);   // SAMSUNG
  brandColors[8]  = tft.color565(165, 0, 52);    // LG
  brandColors[9]  = tft.color565(0, 70, 180);    // PANASONIC
  brandColors[10] = tft.color565(0, 150, 100);   // GREE
  brandColors[11] = tft.color565(30, 130, 210);  // AUX
  brandColors[12] = tft.color565(220, 20, 30);   // TCL
  brandColors[13] = tft.color565(240, 90, 40);   // HITACHI
  brandColors[14] = tft.color565(210, 0, 0);     // SHARP
  brandColors[15] = tft.color565(230, 150, 0);   // YORK
  brandColors[16] = tft.color565(220, 0, 0);     // TOSHIBA
  brandColors[17] = tft.color565(255, 120, 0);   // AIR CANDY
  brandColors[18] = tft.color565(0, 114, 206);   // BEKO
  brandColors[19] = tft.color565(0, 160, 170);   // TASAKI
  brandColors[20] = tft.color565(0, 160, 220);   // STAR AIRE
  brandColors[21] = tft.color565(120, 0, 180);   // UNIAIR
  brandColors[22] = tft.color565(0, 140, 70);    // SAIJO DENKI
  brandColors[23] = tft.color565(50, 180, 255);  // SINGER

  drawSplashScreen();
  drawMainMenu();
}

// =====================================================
// MAIN LOOP
// =====================================================
void loop() {
  uint16_t t_x = 0, t_y = 0;
  bool pressed = tft.getTouch(&t_x, &t_y);

  if (pressed) {
    int real_x = (t_y * 3) / 2;
    int real_y = 320 - ((t_x * 2) / 3);
    real_x = constrain(real_x, 0, 480);
    real_y = constrain(real_y, 0, 320);

    if (currentMode == 0) {
      int clickedGrid = -1;
      for (int i = 0; i < 9; i++) {
        int c = i % 3, r = i / 3;
        int x = colX[c], y = rowY[r];
        if (real_x >= x && real_x <= (x + btnW) && real_y >= y && real_y <= (y + btnH + 5)) {
          clickedGrid = i; break;
        }
      }
      if (clickedGrid != -1) {
        int c = clickedGrid % 3, r = clickedGrid / 3;
        if (clickedGrid == 8) {
          String btnText = (currentPage == 0) ? "PAGE 2 ->" : (currentPage == 1 ? "PAGE 3 ->" : "<- PAGE 1");
          draw3DButton(colX[c], rowY[r], btnW, btnH, tft.color565(120, 130, 140), MY_BG, btnText, true, false);
          beep(); delay(150);
          currentPage = (currentPage + 1) % 3;
          drawMainMenu();
        } 
        else {
          int bIdx = clickedGrid + (currentPage * 8);
          if (bIdx < 24) { 
            draw3DButton(colX[c], rowY[r], btnW, btnH, brandColors[bIdx], MY_BG, brandNames[bIdx], true, (bIdx == 3));
            beep(); delay(150);
            selectedBrand = bIdx; 
            currentMode = selectedBrand + 1;
            drawBrandScreen(selectedBrand); delay(200); 
          }
        }
      }
    }
    else if (currentMode >= 1 && currentMode <= 24) { 
      bool isBlack = (selectedBrand == 3); 
      uint16_t bgCol = brandColors[selectedBrand];

      if (real_x >= backBtnX && real_x <= (backBtnX + backBtnW) && real_y >= backBtnY && real_y <= (backBtnY + backBtnH + 5)) {
        draw3DButton(backBtnX, backBtnY, backBtnW, backBtnH, bgCol, bgCol, "BACK", true, isBlack);
        beep(); delay(150); drawMainMenu(); delay(200); return;
      }
      
      if (real_x >= subBtnX_1 && real_x <= (subBtnX_1 + subBtnW) && real_y >= subBtnY && real_y <= (subBtnY + subBtnH + 5)) {
        draw3DButton(subBtnX_1, subBtnY, subBtnW, subBtnH, bgCol, bgCol, "INDOOR / OUTDOOR", true, isBlack);
        beep(); delay(150); 
        currentSubMode = "INDOOR / OUTDOOR";
        currentMode = 26; 
        drawDevScreen(selectedBrand); delay(200); return;
      }
      if (real_x >= subBtnX_2 && real_x <= (subBtnX_2 + subBtnW) && real_y >= subBtnY && real_y <= (subBtnY + subBtnH + 5)) {
        draw3DButton(subBtnX_2, subBtnY, subBtnW, subBtnH, bgCol, bgCol, "OUTDOOR", true, isBlack);
        beep(); delay(150); 
        currentSubMode = "OUTDOOR";
        currentMode = 26; 
        drawDevScreen(selectedBrand); delay(200); return;
      }
    }
    else if (currentMode == 26) {
      bool isBlack = (selectedBrand == 3); 
      uint16_t bgCol = brandColors[selectedBrand];

      if (real_x >= backBtnX && real_x <= (backBtnX + backBtnW) && real_y >= backBtnY && real_y <= (backBtnY + backBtnH + 5)) {
        draw3DButton(backBtnX, backBtnY, backBtnW, backBtnH, bgCol, bgCol, "BACK", true, isBlack);
        beep(); delay(150); 
        currentMode = selectedBrand + 1;
        drawBrandScreen(selectedBrand); delay(200); return;
      }

      if (real_x >= 40 && real_x <= 230 && real_y >= 235 && real_y <= 285) {
        draw3DButton(40, 235, 190, 50, bgCol, bgCol, "MONITOR UI", true, isBlack);
        beep(); delay(150); 
        currentMode = 30;
        
        lastSignalReceived = millis(); 
        forceIconUpdate = true; 
        
        // เริ่มจับเวลาทันทีเมื่อกดเข้าหน้า MONITOR UI
        timerStartTime = millis(); 
        p_ac_timer = "";

        drawMonitoringScreen(selectedBrand, currentSubMode); delay(200); return;
      }

      if (real_x >= 250 && real_x <= 440 && real_y >= 235 && real_y <= 285) {
        draw3DButton(250, 235, 190, 50, bgCol, bgCol, "SCOPE", true, isBlack);
        beep(); delay(150); 
        currentMode = 40;
        drawScopeScreen(selectedBrand); delay(200); return;
      }
    }
    else if (currentMode == 30) {
      bool isBlack = (selectedBrand == 3); 
      uint16_t bgCol = brandColors[selectedBrand];
      uint16_t COLOR_BG = tft.color565(255, 255, 255);

      // ===== แตะที่แถบ ERROR CODE เพื่อสลับภาษา EN -> TH =====
      bool tappedErrorRow = false;
      if (currentSubMode == "OUTDOOR") {
        if (real_y >= 205 && real_y <= 320) tappedErrorRow = true;   // ขยายกันคลาดเคลื่อน
      } else {
        if (real_y >= 260 && real_y <= 320) tappedErrorRow = true;   // ขยายกันคลาดเคลื่อน
      }

      static unsigned long lastErrorTapTime = 0;
      if (tappedErrorRow) {
        if (millis() - lastErrorTapTime > 500) {   // กันกดค้าง/กดรัว
          lastErrorTapTime = millis();
          beep();
          errorShowThai = !errorShowThai;
          p_ac_error_code = "__FORCE__";

          // คำนวณข้อความ error ใหม่ทันที ไม่ต้องรอ loop รอบถัดไป
          if (isCommError) {
            ac_error_code = errorShowThai ? "สัญญาณสื่อสารขัดข้อง" : "Comm Error";
          }
          else if (selectedBrand == 0) {
            // DAIKIN: rebuild จาก raw code ปัจจุบัน
            ac_error_code = errorShowThai
              ? (ac_error_code_raw + " (" + getDaikinErrorDescThai(ac_error_code_raw) + ")")
              : (ac_error_code_raw + " (" + getDaikinErrorDesc(ac_error_code_raw) + ")");
          }
          else if (selectedBrand == 1 || selectedBrand == 6 || selectedBrand == 15 || selectedBrand == 17 || selectedBrand == 23) {
            // HAIER, EMINENT, YORK, AIR CANDY, SINGER: rebuild จาก diagnostic ล่าสุด
            if (ac_error_code_raw != "" && ac_error_code_raw != "00") {
              ac_error_code = errorShowThai
                ? (ac_error_code_raw + " : " + last_diagnostic_th)
                : (ac_error_code_raw + " : " + last_diagnostic_en);
            }
          }
        }
        return;   // return เสมอเมื่อแตะโซนนี้ ไม่ว่าจะ toggle จริงหรือไม่ กันไม่ให้ตกไปโดน logic ย้อนกลับ
      }

      if (currentSubMode == "OUTDOOR") {
        if (real_y >= 240) { 
          if (real_x < 160) {
            draw3DButton(colX[0], 255, btnW, 55, bgCol, COLOR_BG, "START", true, isBlack);
            beep(); delay(120);
            draw3DButton(colX[0], 255, btnW, 55, bgCol, COLOR_BG, "START", false, isBlack);
            sendAirconCommand(selectedBrand, "START");
            return;
          } 
          else if (real_x >= 160 && real_x < 320) {
            draw3DButton(colX[1], 255, btnW, 55, bgCol, COLOR_BG, "FREQ +", true, isBlack);
            beep(); delay(120);
            draw3DButton(colX[1], 255, btnW, 55, bgCol, COLOR_BG, "FREQ +", false, isBlack);
            sendAirconCommand(selectedBrand, "FREQ+");
            return;
          } 
          else if (real_x >= 320) {
            draw3DButton(colX[2], 255, btnW, 55, bgCol, COLOR_BG, "STOP", true, isBlack);
            beep(); delay(120);
            draw3DButton(colX[2], 255, btnW, 55, bgCol, COLOR_BG, "STOP", false, isBlack);
            sendAirconCommand(selectedBrand, "STOP");
            return;
          }
        }
        else {
          beep(); currentMode = 26; signalConnected = false; 
          drawDevScreen(selectedBrand); delay(300); return;
        }
      } 
      else {
        if (real_y < 260) {   // กันโซน ERROR CODE ไม่ให้โดนตีความเป็นการย้อนกลับ
          beep(); currentMode = 26; signalConnected = false; 
          drawDevScreen(selectedBrand); delay(300);
        }
      }
    }
    else if (currentMode == 40) {
      if (real_y >= 260 && real_y <= 310) {
        if (real_x >= 8 && real_x <= 88) {
          beep(); delay(150);
          currentMode = 26; 
          drawDevScreen(selectedBrand);
          return;
        }
        else if (real_x >= 104 && real_x <= 184) {
          beep(); scopeTimebase = 1; drawScopeScreen(selectedBrand);
        }
        else if (real_x >= 200 && real_x <= 280) {
          beep(); scopeTimebase = 5; drawScopeScreen(selectedBrand);
        }
        else if (real_x >= 296 && real_x <= 376) {
          beep(); scopeTimebase = 10; drawScopeScreen(selectedBrand);
        }
        else if (real_x >= 392 && real_x <= 472) {
          beep(); delay(100);
          isScopeRunning = !isScopeRunning;
          draw3DButton(392, 260, 80, 50, isScopeRunning ? tft.color565(0, 180, 0) : tft.color565(180, 0, 0), tft.color565(0, 0, 0), isScopeRunning ? "RUN" : "STOP", false, false);
        }
      }
    }
  }

  if (currentMode == 30) {
  updateSignalMonitorBlink(selectedBrand, currentSubMode);
  handleAirconCommunication(selectedBrand, currentSubMode);
  
  isCommError = (millis() - lastSignalReceived > 15000);
  
  if (isCommError) {
    ac_error_code = errorShowThai ? "สัญญาณสื่อสารขัดข้อง" : "Comm Error";
  }
  // ถ้าไม่ comm error แล้ว ac_error_code จะถูกคำนวณใหม่จาก handleAirconCommunication() 
  // ให้เป็นค่า error code จริงจากเครื่องเสมอ ไม่ถูกค้างด้วยข้อความเก่า
  
  updateMonitoringValues();
} else if (currentMode == 40) {
    updateScopeSignal(); 
  }
}

// =====================================================
// COMMUNICATION & SMOOTHING 
// =====================================================
void smoothValue(float &smoothed, float target, float factor, float snapThreshold) {
  smoothed = (smoothed * factor) + (target * (1.0 - factor));
  if (abs(smoothed - target) < snapThreshold) {
    smoothed = target;
  }
}

void handleAirconCommunication(int brandIndex, String mode) {
  if (brandIndex == 0) { // DAIKIN
    capture();
    decodeEdges();
    
    if (edgeCount > 2) {
      feedSignal(); 
    }
    
    if (lastCompFreq > 0) {
      ac_status = "ON";
      ac_in_status = "ON";
    } else {
      ac_status = "OFF";
      ac_in_status = "OFF";
    }
    
    static bool isFirstOpen = true;
    if (isFirstOpen || (f_freq == 0 && lastCompFreq > 0)) {
      f_freq = lastCompFreq;
      f_amp = lastAmpsScaled;
      f_out_t = lastTemp6;
      f_coil = lastTemp9;
      f_disch = lastTemp12;
      f_ipm_t = lastIpmTemp;
      f_dc_bus = lastDcBus;
      f_eev = lastEevSteps;
      f_fan = (lastCompFreq >= 44.0) ? (lastCompFreq * 9.5) : 0;
      if (lastCompFreq > 0) isFirstOpen = false; 
    }

    static unsigned long lastSmoothTimer = 0;
    if (millis() - lastSmoothTimer >= 200) { 
      lastSmoothTimer = millis();

      smoothValue(f_freq, lastCompFreq, 0.8, 0.5);
      smoothValue(f_amp, lastAmpsScaled, 0.8, 0.05);
      smoothValue(f_out_t, lastTemp6, 0.8, 0.5);
      smoothValue(f_coil, lastTemp9, 0.8, 0.5);

      float heat_cooldown_factor = (lastCompFreq == 0) ? 0.98 : 0.85;
      float disch_cooldown_factor = (lastCompFreq == 0) ? 0.98 : 0.80;

      smoothValue(f_disch, lastTemp12, disch_cooldown_factor, 0.1); 
      smoothValue(f_ipm_t, lastIpmTemp, heat_cooldown_factor, 0.1);
      
      smoothValue(f_dc_bus, lastDcBus, 0.85, 1.0);
      smoothValue(f_eev, lastEevSteps, 0.85, 1.0);
      
      float targetFan = (lastCompFreq >= 44.0) ? (lastCompFreq * 9.5) : 0;
      smoothValue(f_fan, targetFan, 0.85, 5.0);
    }

    ac_freq = String((int)f_freq) + " Hz";
    ac_amp = String((int)f_amp) + " A";
    ac_out_t = String((int)f_out_t) + " C"; 
    ac_coil = String((int)f_coil) + " C";
    ac_disch = String((int)f_disch) + " C";
    ac_ipm_t = String((int)f_ipm_t) + " C";
    ac_dc_bus = String((int)f_dc_bus) + " V";
    ac_eev = String((int)f_eev) + " step"; 
    ac_fan = String((int)f_fan) + " RPM";
    
    // อัปเดตแรงดัน H จาก out T (f_out_t) ไม่มีจุดทศนิยม และแรงดัน L จาก coil T (f_coil)
    ac_press_h = (f_out_t > 0) ? calculatePressH(f_out_t) : "";
    ac_press_l = (f_coil > 0) ? calculatePressL(f_coil) : "";
    
    if (lastErrorCode == "00" || lastErrorCode == "") {
      ac_error_code_raw = "00";
    } else {
      ac_error_code_raw = lastErrorCode;
    }
    ac_error_code = errorShowThai
      ? (ac_error_code_raw + " (" + getDaikinErrorDescThai(ac_error_code_raw) + ")")
      : (ac_error_code_raw + " (" + getDaikinErrorDesc(ac_error_code_raw) + ")");
  } 
  else if (brandIndex == 1 || brandIndex == 6 || brandIndex == 15 || brandIndex == 17 || brandIndex == 23) { // HAIER, EMINENT, YORK, AIR CANDY & SINGER
    String packet = "";
    unsigned long duration;
    int bitCount = 0;
    
    while (true) {  
      duration = pulseIn(HAIER_RX_PIN, LOW, 1000000);  
      if (duration == 0) break;  
      packet += (duration > 5000 ? "1" : "0");  
      bitCount++;  
    }  
      
    if (bitCount >= 64) {  
      feedSignal(); 
      
      auto parseByte = [&](int start) {  
        int val = 0;  
        for (int i = 0; i < 8; i++) {  
          if ((start + i) < packet.length() && packet[start + i] == '1') val |= (1 << i);  
        }  
        return val;  
      };  
        
      int statusByte = parseByte(8);  
      int hz = parseByte(16);  
      int p1_raw = parseByte(24);  
      int p2_raw = parseByte(32);  
      int amp_raw = parseByte(40);  
      int p3_raw = parseByte(48);  
      int fan_raw = parseByte(56);  
      int eev_raw = parseByte(64);  
        
      float currentAmp = amp_raw / 10.0;  
      int p1_temp = (p1_raw == 0) ? -999 : p1_raw - OFFSET;  
      int p2_temp = (p2_raw == 0) ? -999 : p2_raw - OFFSET;  
      int eev_steps = eev_raw * 2;  
        
      float vbus = VBUS_STANDBY - (hz * VBUS_DROP_FACTOR);  
      if (vbus < VBUS_MIN) vbus = VBUS_MIN;  
      if (hz == 0) vbus = VBUS_STANDBY;  
        
      int fan_rpm = 0;  
      String fan_status = "";  
      if (fan_raw > 0) {  
        fan_rpm = fan_raw * 10;  
        fan_status = "";  
      } else {  
        fan_status = "";  
        if (hz == 0) {  
          fan_rpm = 0;  
        } else {  
          fan_rpm = FAN_BASE_RPM + (hz * FAN_HZ_FACTOR) + (currentAmp * FAN_AMP_FACTOR);  
          if (fan_rpm > FAN_MAX_RPM) fan_rpm = FAN_MAX_RPM;  
        }  
      }  
        
      int p3_temp = 0;  
      String p3_status = "";  
      if (p3_raw > 0) {  
        p3_temp = p3_raw - OFFSET;  
        p3_status = "";  
      } else {  
        p3_status = "";  
        int base_t = (p1_raw > 0 && p1_temp > -20) ? p1_temp : HEATSINK_BASE_TEMP;  
        if (hz == 0) {  
          p3_temp = base_t;  
        } else {  
          p3_temp = base_t + (hz * HEATSINK_HZ_FACTOR) + (currentAmp * HEATSINK_AMP_FACTOR);  
          if (p3_temp > HEATSINK_MAX_TEMP) p3_temp = HEATSINK_MAX_TEMP;  
        }  
      }  
        
      String sysMode = "OFF";  
      String errorDisplay = "--";  
      String diagnostic = "";  
      String diagnosticThai = "";  
        
      if (currentAmp > AMP_LIMIT) {  
        errorDisplay = "F2";  
        diagnostic = "OVERCURRENT PROTECTION";  
        diagnosticThai = "ป้องกันกระแสเกิน";
      }  
      else if (statusByte == 19) {  
        errorDisplay = "F28";  
        diagnostic = "COMPRESSOR STARTUP FAIL";  
        diagnosticThai = "คอมเพรสเซอร์สตาร์ทไม่ติด";
      }  
      else if (statusByte == 9) {  
        errorDisplay = "F8";  
        diagnostic = "OUTDOOR FAN ERROR";  
        diagnosticThai = "พัดลมคอยล์ร้อนผิดปกติ";
      }  
      
      else if ((statusByte == 4 || statusByte == 2) && hz == 0 && currentAmp == 0) {  
        errorDisplay = "F1";  
        diagnostic = "IPM FAIL / NO DRIVE";  
        diagnosticThai = "IPM เสีย / ไม่มีสัญญาณขับ";
      }  
      else {  
        switch (statusByte) {  
          case 0: diagnostic = (hz > 0) ? "COMPRESSOR RUNNING" : "READY"; diagnosticThai = (hz > 0) ? "คอมเพรสเซอร์กำลังทำงาน" : "พร้อมทำงาน"; break;
          case 1: errorDisplay = "E15"; diagnostic = "Communication Error"; diagnosticThai = "สื่อสารผิดพลาด"; break;
          case 2: errorDisplay = "F1"; diagnostic = "IPM Module Protection"; diagnosticThai = "ป้องกันโมดูล IPM"; break;
          case 3: errorDisplay = "F22"; diagnostic = "AC Current Overload"; diagnosticThai = "กระแสไฟ AC เกิน"; break;
          case 4: errorDisplay = "F11"; diagnostic = "Compressor Sync Out"; diagnosticThai = "คอมเพรสเซอร์หลุดซิงค์"; break;
          case 5: errorDisplay = "F3"; diagnostic = "Internal Comm Error"; diagnosticThai = "สื่อสารภายในผิดพลาด"; break;
          case 6: errorDisplay = "F20"; diagnostic = "Voltage Abnormal"; diagnosticThai = "แรงดันไฟผิดปกติ"; break;
          case 7: errorDisplay = "F12"; diagnostic = "Outdoor EEPROM Error"; diagnosticThai = "EEPROM คอยล์ร้อนผิดปกติ"; break;
          case 8: errorDisplay = "F4"; diagnostic = "Exhaust Temp Too High"; diagnosticThai = "อุณหภูมิท่อส่งสูงเกิน"; break;
          case 9: errorDisplay = "F8"; diagnostic = "Outdoor Fan Motor Error"; diagnosticThai = "พัดลมคอยล์ร้อนผิดปกติ"; break;
          case 10: errorDisplay = "F21"; diagnostic = "Defrost Sensor Error"; diagnosticThai = "เซนเซอร์ละลายน้ำแข็งผิดปกติ"; break;
          case 12: errorDisplay = "F6"; diagnostic = "Ambient Sensor Fault"; diagnosticThai = "เซนเซอร์อุณหภูมิภายนอกผิดปกติ"; break;
          case 13: errorDisplay = "F23"; diagnostic = "DC Bus Overcurrent"; diagnosticThai = "กระแส DC Bus เกิน"; break;
          case 18: errorDisplay = "F2"; diagnostic = "Compressor Drive Abnormal"; diagnosticThai = "วงจรขับคอมเพรสเซอร์ผิดปกติ"; break;
          case 19: errorDisplay = "F28"; diagnostic = "Compressor Startup Fail"; diagnosticThai = "คอมเพรสเซอร์สตาร์ทไม่ติด"; break;
          case 24: errorDisplay = "F25"; diagnostic = "Current Detection Circuit Error"; diagnosticThai = "วงจรตรวจจับกระแสผิดปกติ"; break;
          case 35: errorDisplay = "E7"; diagnostic = "Indoor/Outdoor Communication Fault"; diagnosticThai = "สื่อสารคอยล์เย็น-ร้อนผิดปกติ"; break;
          case 48: errorDisplay = "FC"; diagnostic = "Driver Board Error"; diagnosticThai = "บอร์ดขับมอเตอร์ผิดปกติ"; break;
          default:  
            if (hz > 0) { diagnostic = "COMPRESSOR RUNNING"; diagnosticThai = "คอมเพรสเซอร์กำลังทำงาน"; }
            break;  
        }  
      }  
        
      sysMode = (hz > 0) ? "ON" : "OFF";  

      ac_status = sysMode;
      ac_in_status = sysMode; 

      ac_out_t = (p1_raw == 0) ? "ERR" : String(p1_temp) + " C";
      ac_disch = (p2_raw == 0) ? "ERR" : String(p2_temp) + " C";
      ac_coil = "--"; 
      
      if (hz == 0) {
        ac_freq = "--";
        ac_amp = "--";
        ac_ipm_t = "--";
        ac_dc_bus = "--";
        ac_eev = "--";
        ac_fan = "--";
        ac_press_h = "";
      } else {
        ac_freq = String(hz) + " Hz";
        ac_amp = String(currentAmp, 1) + " A";
        ac_ipm_t = String(p3_temp) + " C " + p3_status;
        ac_dc_bus = String(vbus, 1) + " V";
        ac_eev = String(eev_steps) + " step";
        ac_fan = String(fan_rpm) + " rpm" + fan_status;
        ac_press_h = (p1_raw > 0 && p1_temp > -20) ? calculatePressH((float)p1_temp) : "";
      }
      
      ac_error_code_raw = (errorDisplay == "--") ? "00" : errorDisplay;
      last_diagnostic_en = diagnostic;
      last_diagnostic_th = diagnosticThai;

      if (errorDisplay == "--" || errorDisplay == "00") {
        ac_error_code = "00"; 
      } else {
        ac_error_code = errorShowThai
          ? (errorDisplay + " : " + diagnosticThai)
          : (errorDisplay + " : " + diagnostic);
      }
    }
    else {
      // ไม่มี packet ใหม่ในรอบนี้ แต่ยังต้องอัปเดตข้อความ error ตามภาษาที่เลือกจากค่าล่าสุดที่เก็บไว้
      if (ac_error_code_raw != "" && ac_error_code_raw != "00") {
        ac_error_code = errorShowThai
          ? (ac_error_code_raw + " : " + last_diagnostic_th)
          : (ac_error_code_raw + " : " + last_diagnostic_en);
      }
    }
  }
  else {
    ac_status = "OFF";
    ac_in_status = "OFF";
    ac_freq = ""; ac_amp = ""; ac_out_t = "";
    ac_coil = ""; ac_disch = ""; ac_ipm_t = "";
    ac_dc_bus = ""; ac_eev = ""; ac_fan = "";
    ac_press_l = ""; ac_press_h = "";
    ac_error_code = "";
  }
}

void sendAirconCommand(int brandIndex, String command) {
  Serial.print("Command Sent: "); Serial.println(command);
}

// =====================================================
// SCOPE REAL DATA 
// =====================================================
void updateScopeSignal() {
  if (!isScopeRunning) return;

  uint16_t COLOR_SIGNAL = tft.color565(0, 255, 0); 
  uint16_t COLOR_BG = tft.color565(0, 0, 0);
  uint16_t COLOR_GRID = tft.color565(0, 80, 0);

  if (selectedBrand == 0 || selectedBrand == 1 || selectedBrand == 6 || selectedBrand == 15 || selectedBrand == 17 || selectedBrand == 23) {
    currentSignalState = (GPIO.in >> CHANNEL_PIN) & 1;
  } else {
    currentSignalState = 0;
  }

  int current_scopeY = (currentSignalState == 1) ? (SCOPE_Y + 30) : (SCOPE_Y + SCOPE_H - 30);

  if (scopeX_pos > 0) {
    if (last_scopeY != current_scopeY) {
      tft.drawLine(SCOPE_X + scopeX_pos - 1, last_scopeY, SCOPE_X + scopeX_pos - 1, current_scopeY, COLOR_SIGNAL);
    }
    tft.drawLine(SCOPE_X + scopeX_pos - 1, current_scopeY, SCOPE_X + scopeX_pos, current_scopeY, COLOR_SIGNAL);
  }

  last_scopeY = current_scopeY;
  scopeX_pos++;

  if (scopeX_pos >= SCOPE_W) {
    scopeX_pos = 0;
    tft.fillRect(SCOPE_X, SCOPE_Y, SCOPE_W, SCOPE_H, COLOR_BG);
    for (int i = 20; i < SCOPE_W; i += 20) {
      tft.drawFastVLine(SCOPE_X + i, SCOPE_Y, SCOPE_H, COLOR_GRID);
    }
    for (int i = 20; i < SCOPE_H; i += 20) {
      tft.drawFastHLine(SCOPE_X, SCOPE_Y + i, SCOPE_W, COLOR_GRID);
    }
  }

  delay(2); 
}

// =====================================================
// SIGNAL INDICATOR FUNCTION 
// =====================================================
void feedSignal() {
  signalConnected = true;
  lastSignalReceived = millis();
}

void drawSignalIcon(int x, int y, uint16_t colorOn, uint16_t colorOff, bool stateOn) {
  uint16_t activeColor = stateOn ? colorOn : colorOff;
  uint16_t COLOR_HEADER = tft.color565(230, 235, 240); 

  tft.fillRect(x, y, 40, 16, COLOR_HEADER);
  tft.fillRoundRect(x + 4, y + 2, 12, 12, 6, activeColor); 
  tft.fillRect(x + 10, y + 2, 6, 12, activeColor);         
  tft.fillRect(x, y + 6, 4, 4, activeColor);               

  tft.fillRoundRect(x + 18, y + 2, 12, 12, 6, activeColor); 
  tft.fillRect(x + 18, y + 2, 6, 12, activeColor);          
  tft.fillRect(x + 30, y + 6, 4, 4, activeColor);           
}

void updateSignalMonitorBlink(int brandIndex, String modeTitle) {
  if (currentMode != 30) return;

  unsigned long currentMillis = millis();
  uint16_t COLOR_BRAND = brandColors[brandIndex];
  uint16_t COLOR_OFF = tft.color565(190, 195, 200); 

  if (signalConnected && (currentMillis - lastSignalReceived > signalTimeout)) {
    signalConnected = false; 
    signalStateOn = false; 
    forceIconUpdate = true; 

    if (brandIndex != 1 && brandIndex != 6 && brandIndex != 15 && brandIndex != 17 && brandIndex != 23) { 
      ac_status = "OFF";
      ac_freq = "";
      ac_amp = "";
      ac_out_t = "";
      ac_coil = "";
      ac_disch = "";
      ac_ipm_t = "";
      ac_dc_bus = "";
      ac_eev = "";
      ac_fan = "";
      ac_press_l = "";
      ac_press_h = "";
      ac_error_code = "";

      ac_in_status = "OFF";
      ac_in_model = "";
      ac_in_set = "";
      ac_in_room = "";
      ac_in_coil = "";
      ac_in_fan = "";
    }
  }

  if (signalConnected) {
    if (currentMillis - lastSignalBlink >= signalBlinkInterval) {
      lastSignalBlink = currentMillis;
      signalStateOn = !signalStateOn; 
      forceIconUpdate = true; 
    }
  }

  if (forceIconUpdate) {
    forceIconUpdate = false;
    if (modeTitle == "OUTDOOR") {
      drawSignalIcon(165, 40, COLOR_BRAND, COLOR_OFF, signalConnected && signalStateOn);
    } else {
      drawSignalIcon(165, 40, COLOR_BRAND, COLOR_OFF, signalConnected && signalStateOn);
      drawSignalIcon(165, 185, COLOR_BRAND, COLOR_OFF, signalConnected && signalStateOn);
    }
  }
}

// =====================================================
// SPLASH SCREEN
// =====================================================
void drawSplashScreen() {
  uint16_t BG_COLOR      = tft.color565(10, 18, 32);   
  uint16_t ICE_CYAN      = tft.color565(0, 220, 255);  
  uint16_t COLD_BLUE     = tft.color565(0, 110, 210);  
  uint16_t WHITE         = tft.color565(255, 255, 255); 
  uint16_t TEXT_MUTED    = tft.color565(140, 170, 200); 
  uint16_t BAR_BG        = tft.color565(25, 40, 65);   

  tft.fillScreen(BG_COLOR);

  tft.drawRect(8, 8, 464, 304, COLD_BLUE);
  tft.drawRect(10, 10, 460, 300, tft.color565(20, 35, 60));

  int cLen = 18;
  tft.fillRect(6, 6, cLen, 4, ICE_CYAN);
  tft.fillRect(6, 6, 4, cLen, ICE_CYAN);
  tft.fillRect(474 - cLen, 6, cLen, 4, ICE_CYAN);
  tft.fillRect(470, 6, 4, cLen, ICE_CYAN);
  tft.fillRect(6, 310, cLen, 4, ICE_CYAN);
  tft.fillRect(6, 314 - cLen, 4, cLen, ICE_CYAN);
  tft.fillRect(474 - cLen, 310, cLen, 4, ICE_CYAN);
  tft.fillRect(470, 314 - cLen, 4, cLen, ICE_CYAN);

  int cx = 240, cy = 85;  
  tft.drawCircle(cx, cy, 42, tft.color565(20, 50, 90));
  tft.drawCircle(cx, cy, 36, COLD_BLUE);
  tft.drawCircle(cx, cy, 28, ICE_CYAN);
  tft.fillCircle(cx, cy, 4, WHITE);

  tft.drawFastHLine(cx - 22, cy, 44, ICE_CYAN);
  tft.drawFastVLine(cx, cy - 22, 44, ICE_CYAN);
  tft.drawLine(cx - 15, cy - 15, cx + 15, cy + 15, ICE_CYAN);
  tft.drawLine(cx - 15, cy + 15, cx + 15, cy - 15, ICE_CYAN);

  tft.setTextDatum(MC_DATUM);
  tft.setFreeFont(&FreeSansBold18pt7b);
  tft.setTextColor(COLD_BLUE);
  tft.drawString("V.V.Prom", cx + 2, 157); 
  tft.setTextColor(WHITE);
  tft.drawString("V.V.Prom", cx, 155);

  tft.setFreeFont(&FreeSansBold9pt7b);
  tft.setTextColor(ICE_CYAN);
  tft.drawString("SMART TEST INVERTER", cx, 192);

  tft.setFreeFont(&FreeSans9pt7b);
  tft.setTextColor(TEXT_MUTED);
  tft.drawString("AIR CONDITIONER DIAGNOSTIC TOOL", cx, 215);

  int barX = 100, barY = 265, barW = 280, barH = 10;
  tft.setTextDatum(BC_DATUM);
  tft.drawString("INITIALIZING SYSTEM...", cx, 258);

  tft.drawRoundRect(barX - 2, barY - 2, barW + 4, barH + 4, 4, COLD_BLUE);
  tft.fillRoundRect(barX, barY, barW, barH, 3, BAR_BG);

  beep();
  for (int i = 0; i <= barW; i += 4) { 
    tft.fillRoundRect(barX, barY, i, barH, 3, ICE_CYAN);
    delay(50); 
  }

  tft.fillRect(20, 240, 440, 60, BG_COLOR); 
  tft.setTextColor(ICE_CYAN);
  tft.drawString("SYSTEM READY", cx, 255);
  tft.setTextColor(TEXT_MUTED);
  tft.drawString("- TAP SCREEN TO START -", cx, 280);

  uint16_t touch_x, touch_y;
  while (!tft.getTouch(&touch_x, &touch_y)) { delay(50); }
  
  beep(); delay(150); 
}

// =====================================================
// UI UTILITY FUNCTIONS
// =====================================================
void beep() {
  digitalWrite(BUZZER_PIN, HIGH);
  delay(80); 
  digitalWrite(BUZZER_PIN, LOW);
}

void setThaiFont() {
  tft.setTextFont(1);     
  tft.setTextSize(1);
}

uint16_t getDarker(uint16_t color) {
    uint16_t r = (color >> 11) & 0x1F, g = (color >> 5) & 0x3F, b = color & 0x1F;
    return ((r * 2 / 3) << 11) | ((g * 2 / 3) << 5) | (b * 2 / 3);
}

uint16_t getLighter(uint16_t color) {
    uint16_t r = (color >> 11) & 0x1F, g = (color >> 5) & 0x3F, b = color & 0x1F;
    r = r + ((31 - r) / 2); g = g + ((63 - g) / 2); b = b + ((31 - b) / 2);
    return (r << 11) | (g << 5) | b;
}

void draw3DButton(int x, int y, int w, int h, uint16_t btnColor, uint16_t screenBgColor, String text, bool isPressed, bool isBlackText) {
  int radius = 8, shadowDepth = 5; 
  uint16_t darkColor = getDarker(btnColor), lightColor = getLighter(btnColor), outlineColor = tft.color565(60, 60, 60); 
  tft.setFreeFont(&FreeSansBold9pt7b);
  tft.setTextDatum(MC_DATUM); 
  uint16_t textColor = isBlackText ? tft.color565(20, 20, 20) : tft.color565(255, 255, 255);

  if (isPressed) {
    tft.fillRect(x - 1, y - 1, w + 2, shadowDepth + 1, screenBgColor);
    tft.fillRoundRect(x, y + shadowDepth, w, h, radius, outlineColor);
    tft.fillRoundRect(x + 1, y + shadowDepth + 1, w - 2, h - 2, radius - 1, darkColor);
    tft.drawRoundRect(x + 1, y + shadowDepth + 1, w - 2, h - 2, radius - 1, getDarker(darkColor));
    tft.setTextColor(textColor);
    tft.drawString(text, x + (w / 2), y + shadowDepth + (h / 2));
  } else {
    tft.fillRoundRect(x, y + shadowDepth, w, h, radius, outlineColor);
    tft.fillRoundRect(x + 1, y + shadowDepth, w - 2, h - 1, radius - 1, darkColor);
    tft.fillRoundRect(x, y, w, h, radius, outlineColor);
    tft.fillRoundRect(x + 1, y + 1, w - 2, h - 2, radius - 1, btnColor);
    tft.drawRoundRect(x + 2, y + 2, w - 4, h - 4, radius - 2, lightColor);
    tft.drawLine(x + 3, y + h - 3, x + w - 4, y + h - 3, btnColor);
    tft.drawLine(x + w - 3, y + 3, x + w - 3, y + h - 3, btnColor);
    
    if (!isBlackText) {
      tft.setTextColor(getDarker(darkColor));
      tft.drawString(text, x + (w / 2) + 1, y + (h / 2) + 1); 
    }
    tft.setTextColor(textColor);
    tft.drawString(text, x + (w / 2), y + (h / 2));
  }
}

void drawMainMenu() {
  currentMode = 0;
  MY_BG = tft.color565(255, 255, 255); 
  tft.fillScreen(MY_BG);
  tft.setTextDatum(MC_DATUM);
  tft.setTextColor(tft.color565(0, 0, 0));
  tft.setFreeFont(&FreeSansBold12pt7b);
  tft.drawString("SELECT BRAND (" + String(currentPage + 1) + "/3)", 240, 20);

  for (int i = 0; i < 9; i++) {
    int c = i % 3, r = i / 3;
    if (i == 8) {
      if (currentPage == 0) draw3DButton(colX[c], rowY[r], btnW, btnH, tft.color565(120, 130, 140), MY_BG, "PAGE 2 ->", false, false);
      else if (currentPage == 1) draw3DButton(colX[c], rowY[r], btnW, btnH, tft.color565(120, 130, 140), MY_BG, "PAGE 3 ->", false, false);
      else draw3DButton(colX[c], rowY[r], btnW, btnH, tft.color565(120, 130, 140), MY_BG, "<- PAGE 1", false, false);
    } else {
      int bIdx = i + (currentPage * 8);
      if (bIdx < 24) draw3DButton(colX[c], rowY[r], btnW, btnH, brandColors[bIdx], MY_BG, brandNames[bIdx], false, (bIdx == 3));
    }
  }
}

void drawBrandScreen(int brandIndex) {
  uint16_t bgColor = brandColors[brandIndex];
  bool isBlack = (brandIndex == 3); 
  tft.fillScreen(bgColor);
  tft.setTextDatum(MC_DATUM);
  tft.setTextColor(isBlack ? tft.color565(0, 0, 0) : tft.color565(255, 255, 255));
  tft.setFreeFont(&FreeSansBold12pt7b);
  tft.drawString(brandNames[brandIndex] + " SYSTEM", 240, 70);
  tft.setFreeFont(&FreeSansBold9pt7b);
  tft.drawString("Please select mode:", 240, 120);
  
  draw3DButton(backBtnX, backBtnY, backBtnW, backBtnH, bgColor, bgColor, "BACK", false, isBlack);
  draw3DButton(subBtnX_1, subBtnY, subBtnW, subBtnH, bgColor, bgColor, "INDOOR / OUTDOOR", false, isBlack);
  draw3DButton(subBtnX_2, subBtnY, subBtnW, subBtnH, bgColor, bgColor, "OUTDOOR", false, isBlack);
}

void drawDevScreen(int brandIndex) {
  uint16_t bgColor = brandColors[brandIndex];
  bool isBlack = (brandIndex == 3); 

  tft.fillScreen(bgColor);

  draw3DButton(backBtnX, backBtnY, backBtnW, backBtnH, bgColor, bgColor, "BACK", false, isBlack);

  tft.setTextDatum(ML_DATUM);
  tft.setTextColor(isBlack ? tft.color565(0, 0, 0) : tft.color565(255, 255, 255));
  tft.setFreeFont(&FreeSansBold12pt7b);
  tft.drawString(brandNames[brandIndex], 20, 35); 

  tft.setFreeFont(&FreeSansBold9pt7b);
  tft.drawString("Mode: " + currentSubMode, 20, 70);

  int cardX = 30, cardY = 100, cardW = 420, cardH = 120;
  uint16_t cardBg = bgColor; 
  
  tft.fillRoundRect(cardX, cardY, cardW, cardH, 10, cardBg);
  tft.drawRoundRect(cardX, cardY, cardW, cardH, 10, isBlack ? tft.color565(100, 100, 100) : tft.color565(220, 220, 220));

  tft.setTextDatum(MC_DATUM);
  tft.setTextColor(isBlack ? tft.color565(0, 0, 0) : tft.color565(255, 255, 255)); 
  tft.setFreeFont(&FreeSansBold12pt7b);
  tft.drawString("SYSTEM READY (LIVE)", 240, 140);

  tft.setTextColor(isBlack ? tft.color565(50, 50, 50) : tft.color565(200, 200, 200));
  tft.setFreeFont(&FreeSans9pt7b);
  tft.drawString("Live Telemetry & Scope Activated", 240, 180);

  draw3DButton(40, 235, 190, 50, bgColor, bgColor, "MONITOR UI", false, isBlack);
  draw3DButton(250, 235, 190, 50, bgColor, bgColor, "SCOPE", false, isBlack);
}

// =====================================================
// MONITORING SCREEN UI
// =====================================================
void drawMonitoringScreen(int brandIndex, String modeTitle) {
  p_ac_status = ""; p_ac_freq = ""; p_ac_amp = ""; p_ac_out_t = "";
  p_ac_coil = ""; p_ac_disch = ""; p_ac_ipm_t = ""; p_ac_dc_bus = "";
  p_ac_eev = ""; p_ac_fan = ""; p_ac_press_l = ""; p_ac_press_h = "";
  p_ac_error_code = ""; p_ac_timer = "";
  p_ac_in_status = ""; p_ac_in_model = ""; p_ac_in_set = "";
  p_ac_in_room = ""; p_ac_in_coil = ""; p_ac_in_fan = "";

  uint16_t COLOR_BG = tft.color565(255, 255, 255);
  uint16_t COLOR_TEXT = tft.color565(0, 0, 0);
  uint16_t COLOR_LINE = tft.color565(170, 170, 170);
  uint16_t COLOR_HEADER = tft.color565(230, 235, 240); 
  uint16_t COLOR_BRAND = brandColors[brandIndex];
  uint16_t COLOR_WHITE = tft.color565(255, 255, 255);
  bool isBlack = (brandIndex == 3);

  tft.fillScreen(COLOR_BG);

  tft.fillRect(0, 0, 480, 35, COLOR_BRAND);
  tft.setTextColor(isBlack ? COLOR_TEXT : COLOR_WHITE);
  tft.setTextDatum(MC_DATUM);
  tft.setFreeFont(&FreeSansBold12pt7b);
  
  String headerTxt = brandNames[brandIndex] + " | " + currentSubMode;
  tft.drawString(headerTxt, 240, 17);

  int col1 = 8, col2 = 168, col3 = 328;

  if (modeTitle == "OUTDOOR") {
    tft.fillRect(0, 35, 480, 25, COLOR_HEADER); 
    tft.setTextColor(COLOR_TEXT);
    tft.setTextDatum(ML_DATUM);
    tft.setFreeFont(&FreeSansBold9pt7b);
    tft.drawString(" OUTDOOR UNIT", 5, 47);
    
    tft.drawLine(0, 60, 480, 60, COLOR_LINE);

    int rLine1 = 97, rLine2 = 135, rLine3 = 172, rLine4 = 210;
    tft.drawLine(0, rLine1, 480, rLine1, COLOR_LINE);
    tft.drawLine(0, rLine2, 480, rLine2, COLOR_LINE);
    tft.drawLine(0, rLine3, 480, rLine3, COLOR_LINE);
    tft.drawLine(0, rLine4, 480, rLine4, COLOR_LINE);

    tft.drawLine(160, 60, 160, 210, COLOR_LINE);
    tft.drawLine(320, 60, 320, 210, COLOR_LINE);

    tft.setTextColor(COLOR_TEXT);
    tft.setFreeFont(&FreeSansBold9pt7b);
    tft.setTextDatum(ML_DATUM);
    
    int r1 = 78, r2 = 116, r3 = 153, r4 = 191;
    
    tft.drawString("Status:", col1, r1); tft.drawString("Freq:", col2, r1);     tft.drawString("Amp:", col3, r1);
    tft.drawString("Out T:", col1, r2);  tft.drawString("Coil:", col2, r2);     tft.drawString("Disch:", col3, r2);
    tft.drawString("IPM T:", col1, r3);  tft.drawString("DC Bus:", col2, r3);   tft.drawString("EEV:", col3, r3);
    tft.drawString("Fan:", col1, r4);    tft.drawString("Press L:", col2, r4);  tft.drawString("Press H:", col3, r4);

    tft.fillRect(0, 210, 480, 38, COLOR_HEADER);
    tft.drawLine(0, 210, 480, 210, COLOR_LINE);
    tft.drawLine(0, 248, 480, 248, COLOR_LINE);
    tft.setTextColor(COLOR_TEXT);
    tft.drawString("ERROR CODE :", 10, 229);

    draw3DButton(colX[0], 255, btnW, 55, COLOR_BRAND, COLOR_BG, "START", false, isBlack);
    draw3DButton(colX[1], 255, btnW, 55, COLOR_BRAND, COLOR_BG, "FREQ +", false, isBlack);
    draw3DButton(colX[2], 255, btnW, 55, COLOR_BRAND, COLOR_BG, "STOP", false, isBlack);
  } 
  else {
    tft.fillRect(0, 35, 480, 25, COLOR_HEADER);
    tft.setTextColor(COLOR_TEXT);
    tft.setTextDatum(ML_DATUM);
    tft.setFreeFont(&FreeSansBold9pt7b);
    tft.drawString(" OUTDOOR UNIT", 5, 47); 

    tft.drawLine(0, 60, 480, 60, COLOR_LINE);

    for(int i = 90; i <= 180; i += 30) {
      tft.drawLine(0, i, 480, i, COLOR_LINE);
    }
    tft.drawLine(160, 60, 160, 180, COLOR_LINE);
    tft.drawLine(320, 60, 320, 180, COLOR_LINE);

    int or1 = 75, or2 = 105, or3 = 135, or4 = 165;
    tft.drawString("Status:", col1, or1); tft.drawString("Freq:", col2, or1); tft.drawString("Amp:", col3, or1);
    tft.drawString("Out T:", col1, or2);  tft.drawString("Coil:", col2, or2); tft.drawString("Disch:", col3, or2);
    tft.drawString("IPM T:", col1, or3);  tft.drawString("DC Bus:", col2, or3); tft.drawString("EEV:", col3, or3);
    tft.drawString("Fan:", col1, or4);    tft.drawString("Press L:", col2, or4); tft.drawString("Press H:", col3, or4);

    tft.fillRect(0, 180, 480, 25, COLOR_HEADER);
    tft.setTextColor(COLOR_TEXT);
    tft.setFreeFont(&FreeSansBold9pt7b);
    tft.drawString(" INDOOR UNIT", 5, 192);

    tft.drawLine(0, 180, 480, 180, COLOR_LINE);
    tft.drawLine(0, 205, 480, 205, COLOR_LINE);

    for(int i = 235; i <= 265; i += 30) {
      tft.drawLine(0, i, 480, i, COLOR_LINE);
    }
    tft.drawLine(160, 205, 160, 265, COLOR_LINE);
    tft.drawLine(320, 205, 320, 265, COLOR_LINE);

    int ir1 = 220, ir2 = 250;
    tft.drawString("Status:", col1, ir1); tft.drawString("Model:", col2, ir1); tft.drawString("Set T:", col3, ir1);
    tft.drawString("Room:", col1, ir2);   tft.drawString("Coil:", col2, ir2);  tft.drawString("Fan:", col3, ir2);

    tft.fillRect(0, 265, 480, 55, COLOR_HEADER);
    tft.drawLine(0, 265, 480, 265, COLOR_LINE);
    tft.drawString("ERROR CODE :", 10, 285);
  }
}

// =====================================================
// UPDATE MONITORING VALUES
// =====================================================
void drawValIfChanged(String &prev, const String &curr, int x, int y) {
  if (prev != curr) {
    tft.drawString(curr, x, y);
    prev = curr; 
  }
}

void updateMonitoringValues() {
  if (currentMode != 30) return;

  static unsigned long lastValUpdate = 0;
  if (millis() - lastValUpdate < 150) return; 
  lastValUpdate = millis();

  uint16_t valColor = tft.color565(0, 50, 200); 
  uint16_t errColor = tft.color565(255, 0, 0);  
  uint16_t bgColor = tft.color565(255, 255, 255);
  uint16_t headerBg = tft.color565(230, 235, 240);

  // คำนวณเวลาและอัปเดตตัวจับเวลาถัดจากไอคอน Outdoor Unit (x=330, y=47)
  unsigned long elapsedSec = (millis() - timerStartTime) / 1000;
  unsigned int hours = elapsedSec / 3600;
  unsigned int mins = (elapsedSec % 3600) / 60;
  unsigned int secs = elapsedSec % 60;
  char timeBuf[16];
  sprintf(timeBuf, "TIME: %02u:%02u:%02u", hours, mins, secs);
  ac_timer = String(timeBuf);

  tft.setFreeFont(&FreeSansBold9pt7b);
  tft.setTextDatum(ML_DATUM);
  tft.setTextColor(valColor, headerBg);
  tft.setTextPadding(140);
  drawValIfChanged(p_ac_timer, ac_timer, 330, 47);
  tft.setTextPadding(0);

  if (currentSubMode == "OUTDOOR") {
    tft.setTextColor(valColor, bgColor);

    int col1 = 8, col2 = 168, col3 = 328;
    int r1 = 78, r2 = 116, r3 = 153, r4 = 191;

    tft.setTextPadding(75);
    drawValIfChanged(p_ac_status, ac_status, col1 + 70, r1);
    drawValIfChanged(p_ac_freq, ac_freq, col2 + 60, r1);
    drawValIfChanged(p_ac_amp, ac_amp, col3 + 55, r1);

    drawValIfChanged(p_ac_out_t, ac_out_t, col1 + 65, r2);
    drawValIfChanged(p_ac_coil, ac_coil, col2 + 55, r2);
    drawValIfChanged(p_ac_disch, ac_disch, col3 + 65, r2);

    drawValIfChanged(p_ac_ipm_t, ac_ipm_t, col1 + 65, r3);
    drawValIfChanged(p_ac_dc_bus, ac_dc_bus, col2 + 75, r3);
    drawValIfChanged(p_ac_eev, ac_eev, col3 + 55, r3);

    drawValIfChanged(p_ac_fan, ac_fan, col1 + 50, r4);
    drawValIfChanged(p_ac_press_l, ac_press_l, col2 + 75, r4);
    drawValIfChanged(p_ac_press_h, ac_press_h, col3 + 75, r4);
    tft.setTextPadding(0);

         if (p_ac_error_code == "__FORCE__") p_ac_error_code = "";
    if (p_ac_error_code != ac_error_code) {
      tft.fillRect(160, 210, 315, 40, headerBg);
      tft.setTextColor(errColor, headerBg);
      tft.setTextDatum(ML_DATUM);
      tft.drawString(ac_error_code, 170, 229);
      p_ac_error_code = ac_error_code;
    }
  } 
  else { 
    tft.setTextColor(valColor, bgColor);

    int col1 = 8, col2 = 168, col3 = 328;
    int or1 = 75, or2 = 105, or3 = 135, or4 = 165;

    tft.setTextPadding(75);
    drawValIfChanged(p_ac_status, ac_status, col1 + 70, or1);
    drawValIfChanged(p_ac_freq, ac_freq, col2 + 55, or1);
    drawValIfChanged(p_ac_amp, ac_amp, col3 + 55, or1);

    drawValIfChanged(p_ac_out_t, ac_out_t, col1 + 65, or2);
    drawValIfChanged(p_ac_coil, ac_coil, col2 + 55, or2);
    drawValIfChanged(p_ac_disch, ac_disch, col3 + 60, or2);

    drawValIfChanged(p_ac_ipm_t, ac_ipm_t, col1 + 65, or3);
    drawValIfChanged(p_ac_dc_bus, ac_dc_bus, col2 + 75, or3);
    drawValIfChanged(p_ac_eev, ac_eev, col3 + 55, or3);

    drawValIfChanged(p_ac_fan, ac_fan, col1 + 50, or4);
    drawValIfChanged(p_ac_press_l, ac_press_l, col2 + 75, or4);
    drawValIfChanged(p_ac_press_h, ac_press_h, col3 + 75, or4);

    int ir1 = 220, ir2 = 250;
    drawValIfChanged(p_ac_in_status, ac_in_status, col1 + 70, ir1);
    drawValIfChanged(p_ac_in_model, ac_in_model, col2 + 70, ir1);
    drawValIfChanged(p_ac_in_set, ac_in_set, col3 + 65, ir1);

    drawValIfChanged(p_ac_in_room, ac_in_room, col1 + 65, ir2);
    drawValIfChanged(p_ac_in_coil, ac_in_coil, col2 + 55, ir2);
    drawValIfChanged(p_ac_in_fan, ac_in_fan, col3 + 50, ir2);
    tft.setTextPadding(0);

         if (p_ac_error_code == "__FORCE__") p_ac_error_code = "";
    if (p_ac_error_code != ac_error_code) {
      tft.fillRect(160, 266, 315, 40, headerBg);
      tft.setTextColor(errColor, headerBg);
      tft.setTextDatum(ML_DATUM);
      tft.drawString(ac_error_code, 170, 285);
      p_ac_error_code = ac_error_code;
    }
  }
}

void drawScopeScreen(int brandIndex) {
  uint16_t COLOR_BG = tft.color565(0, 0, 0); 
  uint16_t COLOR_GRID = tft.color565(0, 80, 0); 
  uint16_t COLOR_BRAND = brandColors[brandIndex];
  bool isBlack = (brandIndex == 3);

  tft.fillScreen(COLOR_BG);

  tft.fillRect(0, 0, 480, 35, COLOR_BRAND);
  tft.setTextColor(isBlack ? tft.color565(0, 0, 0) : tft.color565(255, 255, 255));
  tft.setTextDatum(MC_DATUM);
  tft.setFreeFont(&FreeSansBold12pt7b);
  tft.drawString(brandNames[brandIndex] + " | SIGNAL SCOPE", 240, 17);

  tft.drawRect(SCOPE_X - 1, SCOPE_Y - 1, SCOPE_W + 2, SCOPE_H + 2, tft.color565(255, 255, 255));
  for (int i = 20; i < SCOPE_W; i += 20) {
    tft.drawFastVLine(SCOPE_X + i, SCOPE_Y, SCOPE_H, COLOR_GRID);
  }
  for (int i = 20; i < SCOPE_H; i += 20) {
    tft.drawFastHLine(SCOPE_X, SCOPE_Y + i, SCOPE_W, COLOR_GRID);
  }

  uint16_t btnBg = tft.color565(40, 40, 40);
  
  draw3DButton(8, 260, 80, 50, btnBg, COLOR_BG, "BACK", false, false);
  draw3DButton(104, 260, 80, 50, scopeTimebase == 1 ? COLOR_BRAND : btnBg, COLOR_BG, "1 ms", false, scopeTimebase == 1 ? isBlack : false);
  draw3DButton(200, 260, 80, 50, scopeTimebase == 5 ? COLOR_BRAND : btnBg, COLOR_BG, "5 ms", false, scopeTimebase == 5 ? isBlack : false);
  draw3DButton(296, 260, 80, 50, scopeTimebase == 10 ? COLOR_BRAND : btnBg, COLOR_BG, "10ms", false, scopeTimebase == 10 ? isBlack : false);
  draw3DButton(392, 260, 80, 50, isScopeRunning ? tft.color565(0, 180, 0) : tft.color565(180, 0, 0), COLOR_BG, isScopeRunning ? "RUN" : "STOP", false, false);

  scopeX_pos = 0; 
  last_scopeY = SCOPE_Y + SCOPE_H - 30; 
} 
