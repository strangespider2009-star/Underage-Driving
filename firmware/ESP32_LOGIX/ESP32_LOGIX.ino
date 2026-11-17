/*
  UNDERAGE-DRIVING / LOGIX — ESP32-WROOM-32 firmware
  Camera face check happens in the browser; real R307 fingerprint check here.
  The 7408 AND gate is physically driven on GPIO25/26 and its output is read on GPIO27.
  Indicators operate for 10 seconds. This is a standalone low-voltage LED demo ONLY.

  Dependencies (Arduino IDE Library Manager):
    Adafruit Fingerprint Sensor Library
    ArduinoJson v7
  Board package: esp32 by Espressif Systems

  Copy config.example.h -> config.h and enter Wi-Fi / backend / device credentials.
  Certificate trust anchors are in trust_roots.h. Never put private keys in GitHub.
  See ../../WIRING.md before powering the 7408 IC.
*/
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <Adafruit_Fingerprint.h>
#include "config.h"
#include "trust_roots.h"

static const uint8_t FINGER_RX_PIN = 16;   // R307 TX
static const uint8_t FINGER_TX_PIN = 17;   // R307 RX
static const uint8_t AND_INPUT_A = 25;    // 7408 pin 1
static const uint8_t AND_INPUT_B = 26;    // 7408 pin 2
static const uint8_t AND_SENSE_PIN = 27;  // inverted/safe interface from 7408 pin 3
static const uint8_t GREEN_LED = 18;
static const uint8_t RED_LED = 19;
static const uint8_t BUZZER_TRANSISTOR = 23;

static const uint32_t RESULT_WINDOW_MS = 10000;
static const uint32_t SCAN_TIMEOUT_MS = 16000;
static const uint32_t POLL_INTERVAL_MS = 1700;
static const uint32_t SENSOR_RETRY_INTERVAL_MS = 15000;

HardwareSerial sensorUart(2);
Adafruit_Fingerprint finger(&sensorUart);
bool sensorReady = false;
uint32_t nextPoll = 0;
uint32_t nextSensorRetry = 0;
bool ntpStarted = false;
bool clockReady = false;

volatile bool decisionActive = false;
volatile bool decisionApproved = false;
volatile uint32_t decisionStartedAt = 0;
volatile uint32_t lastBuzzerChangeAt = 0;
volatile bool buzzerOn = false;

// Buffer an acknowledgement until server accepts it, to avoid running the job twice.
String pendingResultJson;

bool hasConfig() {
  return strlen(WIFI_SSID) > 0 && strstr(WIFI_SSID, "YOUR_") == nullptr &&
    String(SERVER_URL).startsWith("https://") &&
    strstr(SERVER_URL, "YOUR-") == nullptr &&
    strlen(DEVICE_ID) > 20 && strlen(DEVICE_KEY) == 64;
}

void allOff() {
  digitalWrite(AND_INPUT_A, LOW);
  digitalWrite(AND_INPUT_B, LOW);
  digitalWrite(GREEN_LED, LOW);
  digitalWrite(RED_LED, LOW);
  digitalWrite(BUZZER_TRANSISTOR, LOW);
  decisionActive = false;
  buzzerOn = false;
}

bool readPhysicalAnd() {
  const bool pinHigh = digitalRead(AND_SENSE_PIN) == HIGH;
#if AND_GATE_OUTPUT_INVERTED
  return !pinHigh;   // NPN inverter: collector LOW means actual gate output HIGH
#else
  return pinHigh;    // 74HC08 powered at 3.3V: direct gate output
#endif
}

// Starts a nonblocking 10-second LED indicator. Only the physical AND gate is
// permitted to produce green, and a gate wiring fault forces red+buzzer.
bool startDecision(bool a, bool b, bool &gateHigh) {
  allOff();
  digitalWrite(AND_INPUT_A, a ? HIGH : LOW);
  digitalWrite(AND_INPUT_B, b ? HIGH : LOW);
  delay(5); // settle physical TTL/CMOS gate and interface transistor
  gateHigh = readPhysicalAnd();
  const bool gateMatchesTruthTable = gateHigh == (a && b);
  decisionApproved = gateMatchesTruthTable && gateHigh && a && b;
  digitalWrite(GREEN_LED, decisionApproved ? HIGH : LOW);
  digitalWrite(RED_LED, decisionApproved ? LOW : HIGH);
  decisionActive = true;
  decisionStartedAt = millis();
  lastBuzzerChangeAt = millis();
  buzzerOn = !decisionApproved;
  digitalWrite(BUZZER_TRANSISTOR, buzzerOn ? HIGH : LOW);
  Serial.printf("AND A=%d B=%d measured Y=%d | %s | 10 seconds\n",
    a, b, gateHigh, decisionApproved ? "GREEN" : "RED+BUZZER");
  return gateMatchesTruthTable;
}

void updateIndicators() {
  if (!decisionActive) return;
  const uint32_t now = millis();
  if ((uint32_t)(now - decisionStartedAt) >= RESULT_WINDOW_MS) {
    allOff();
    Serial.println("10-second result window complete; all outputs OFF");
    return;
  }
  if (!decisionApproved) {
    const uint32_t hold = buzzerOn ? 180 : 380;
    if ((uint32_t)(now - lastBuzzerChangeAt) >= hold) {
      buzzerOn = !buzzerOn;
      digitalWrite(BUZZER_TRANSISTOR, buzzerOn ? HIGH : LOW);
      lastBuzzerChangeAt = now;
    }
  }
}

// Separate FreeRTOS task keeps the 10-second output timeout independent of
// HTTPS requests and fingerprint scanning delays in the main Arduino loop.
void indicatorTimerTask(void *unused) {
  (void)unused;
  for (;;) {
    updateIndicators();
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

bool waitForFinger(bool present, uint32_t timeoutMs) {
  const uint32_t started = millis();
  while ((uint32_t)(millis() - started) < timeoutMs) {
    uint8_t state = finger.getImage();
    if (present && state == FINGERPRINT_OK) return true;
    if (!present && state == FINGERPRINT_NOFINGER) return true;
    delay(85);
  }
  return false;
}

bool enroll(uint8_t slot, String &reason) {
  if (!sensorReady) { reason = "SENSOR_OFFLINE"; return false; }
  Serial.printf("ENROLL slot %u: place finger\n", slot);
  if (!waitForFinger(true, SCAN_TIMEOUT_MS) || finger.image2Tz(1) != FINGERPRINT_OK) {
    reason = "FIRST_SCAN_FAILED"; return false;
  }
  Serial.println("Remove finger now");
  if (!waitForFinger(false, SCAN_TIMEOUT_MS)) { reason = "REMOVE_TIMEOUT"; return false; }
  Serial.println("Place SAME finger again");
  if (!waitForFinger(true, SCAN_TIMEOUT_MS) || finger.image2Tz(2) != FINGERPRINT_OK) {
    reason = "SECOND_SCAN_FAILED"; return false;
  }
  if (finger.createModel() != FINGERPRINT_OK) { reason = "FINGER_MISMATCH"; return false; }
  if (finger.storeModel(slot) != FINGERPRINT_OK) { reason = "STORE_FAILED"; return false; }
  return true;
}

bool verify(uint8_t slot, String &reason) {
  if (!sensorReady) { reason = "SENSOR_OFFLINE"; return false; }
  Serial.printf("VERIFY expected slot %u: place finger\n", slot);
  if (!waitForFinger(true, SCAN_TIMEOUT_MS)) { reason = "SCAN_TIMEOUT"; return false; }
  if (finger.image2Tz(1) != FINGERPRINT_OK) { reason = "BAD_SCAN"; return false; }
  if (finger.fingerFastSearch() != FINGERPRINT_OK) { reason = "UNKNOWN_FINGER"; return false; }
  if (finger.fingerID != slot) { reason = "WRONG_DRIVER_SLOT"; return false; }
  return true;
}

bool deletePrint(uint8_t slot, String &reason) {
  if (!sensorReady) { reason = "SENSOR_OFFLINE"; return false; }
  if (finger.deleteModel(slot) != FINGERPRINT_OK) { reason = "DELETE_FAILED"; return false; }
  return true;
}

void syncClock() {
  if (WiFi.status() != WL_CONNECTED || clockReady) return;
  if (!ntpStarted) {
    configTime(0, 0, "pool.ntp.org", "time.google.com");
    ntpStarted = true;
    Serial.println("Synchronizing UTC clock for HTTPS certificate verification...");
  }
  // Do not open TLS until the ESP32 clock is valid.
  clockReady = time(nullptr) > 1700000000;
}

void wifiCheck() {
  if (WiFi.status() == WL_CONNECTED) return;
  static uint32_t lastAttempt = 0;
  if (lastAttempt && millis() - lastAttempt < 10000) return;
  lastAttempt = millis();
  Serial.println("Connecting ESP32 Wi-Fi...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

int httpsRequest(const String &path, const String *body, String &output) {
  if (WiFi.status() != WL_CONNECTED || !clockReady) return -1;
  WiFiClientSecure client;
  client.setCACert(ROOT_CA_BUNDLE); // Validates Render HTTPS server; no setInsecure().
  client.setTimeout(8);
  HTTPClient http;
  const String url = String(SERVER_URL) + path;
  if (!http.begin(client, url)) return -2;
  http.setTimeout(8000);
  http.addHeader("X-Device-Id", DEVICE_ID);
  http.addHeader("X-Device-Key", DEVICE_KEY);
  int code = 0;
  if (body) {
    http.addHeader("Content-Type", "application/json");
    code = http.POST(*body);
  } else {
    http.addHeader("X-Sensor-Ready", sensorReady ? "1" : "0");
    code = http.GET();
  }
  output = http.getString();
  http.end();
  return code;
}

void setPendingResult(const String &jobId, bool success, const String &reason, bool gateHigh) {
  JsonDocument doc;
  doc["jobId"] = jobId;
  doc["success"] = success;
  doc["reason"] = reason;
  doc["gateHigh"] = gateHigh;
  serializeJson(doc, pendingResultJson);
}

bool submitPendingResult() {
  if (pendingResultJson.isEmpty()) return true;
  String response;
  int code = httpsRequest("/api/esp32/result", &pendingResultJson, response);
  if (code == 200) {
    pendingResultJson = "";
    return true;
  }
  Serial.printf("Result acknowledgement failed (HTTP %d); will retry.\n", code);
  return false;
}

void processJob(JsonVariantConst job) {
  String jobId = job["id"].as<String>();
  String type = job["type"].as<String>();
  int slot = job["slot"].isNull() ? 0 : job["slot"].as<int>();
  bool a = job["a"].as<int>() == 1;
  bool b = job["b"].as<int>() == 1;
  if (jobId.length() < 10) return;

  String reason = "";
  bool success = false;
  bool gateHigh = false;
  if (type == "DECIDE") {
    success = startDecision(a, b, gateHigh);
    if (!success) reason = "AND_GATE_MISMATCH";
  } else if (slot < 1 || slot > 127) {
    reason = "BAD_FINGERPRINT_SLOT";
  } else if (type == "ENROLL") {
    success = enroll(slot, reason);
  } else if (type == "VERIFY") {
    success = verify(slot, reason);
  } else if (type == "DELETE") {
    success = deletePrint(slot, reason);
  } else {
    reason = "UNKNOWN_JOB";
  }
  Serial.printf("JOB %s %s success=%d reason=%s\n", jobId.c_str(), type.c_str(), success, reason.c_str());
  setPendingResult(jobId, success, reason, gateHigh);
  submitPendingResult();
}

void setup() {
  Serial.begin(115200);
  pinMode(AND_INPUT_A, OUTPUT);
  pinMode(AND_INPUT_B, OUTPUT);
  pinMode(AND_SENSE_PIN, INPUT);
  pinMode(GREEN_LED, OUTPUT);
  pinMode(RED_LED, OUTPUT);
  pinMode(BUZZER_TRANSISTOR, OUTPUT);
  allOff();
  if (xTaskCreate(indicatorTimerTask, "result-10s-timer", 2500, nullptr, 1, nullptr) != pdPASS) {
    Serial.println("FATAL: Cannot start output timer task; outputs remain disabled.");
    while (true) { allOff(); delay(1000); }
  }
  sensorUart.begin(57600, SERIAL_8N1, FINGER_RX_PIN, FINGER_TX_PIN);
  finger.begin(57600);
  delay(250);
  sensorReady = finger.verifyPassword();
  Serial.println(sensorReady ? "R307/AS608 sensor: READY" : "R307/AS608 sensor: MISSING");
  if (!hasConfig()) {
    Serial.println("ERROR: Set Wi-Fi, server, and device ID/key in config.h first.");
    return;
  }
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  wifiCheck();
}

void loop() {
  if (!hasConfig()) { delay(1000); return; }
  wifiCheck();
  if (WiFi.status() != WL_CONNECTED) { delay(100); return; }
  syncClock();
  if (!clockReady) { delay(200); return; }
  if (!sensorReady && (int32_t)(millis() - nextSensorRetry) >= 0) {
    sensorReady = finger.verifyPassword();
    nextSensorRetry = millis() + SENSOR_RETRY_INTERVAL_MS;
  }
  if ((int32_t)(millis() - nextPoll) < 0) { delay(20); return; }
  nextPoll = millis() + POLL_INTERVAL_MS;
  if (!submitPendingResult()) return; // don't claim new jobs until previous job acknowledged
  if (decisionActive) return; // result LEDs finish after exactly 10 seconds
  String response;
  int code = httpsRequest("/api/esp32/job", nullptr, response);
  if (code != 200) {
    Serial.printf("Server polling HTTP %d; Wi-Fi = %d\n", code, WiFi.status());
    return;
  }
  JsonDocument doc;
  if (deserializeJson(doc, response)) { Serial.println("Invalid server JSON"); return; }
  if (!doc["job"].isNull()) processJob(doc["job"].as<JsonVariantConst>());
}
