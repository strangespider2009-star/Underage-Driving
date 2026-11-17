/*
  LOGIX / UNDERAGE-DRIVING: ESP32-WROOM-32 BLE AND-gate LED demo

  Does NOT use Wi-Fi, HC-05, R307, config.h, trust_roots.h or ArduinoJson.
  Uses built-in ESP32 BLE peripheral and Nordic UART Service UUIDs.
  This is an educational LOW-VOLTAGE LED + buzzer demonstration only.
  NEVER attach outputs to an actual vehicle, lock, motor, or ignition.

  Works with "esp32 by Espressif Systems" 3.x board package (bundled BLE).

  GPIO25  -> 7408 pin 1 (input A)
  GPIO26  -> 7408 pin 2 (input B)
  GPIO27  <- physical 7408 pin 3 through Q1 safe level interface
  GPIO18  -> green LED + resistor
  GPIO19  -> red LED + resistor
  GPIO23  -> active buzzer transistor driver

  Packet from phone: D + 6 hex nonce + A bit + B bit
    Example D0A1B2C11
  Notify to phone: R + same nonce + measured Y + status
    P=green/approved, D=red/denied, F=AND-gate mismatch.
    Example R0A1B21P
  Each BLE packet is 9 ASCII bytes; fits minimum BLE notification MTU.

  The mobile website authenticates the passkey with Render before sending
  the bits. The ESP32 CANNOT independently verify the passkey or BLE sender.
  This is not a secure access control scheme.
*/

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

#define BLE_DEVICE_NAME "LOGIX-BLE"
#define SERVICE_UUID "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define RX_UUID      "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define TX_UUID      "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

// 1 = SN7408/74LS08/74HCT08 at 5V, output via NPN inverter Q1.
// 0 = 74HC08 powered at 3.3V, direct pin 3 to GPIO27.
#define AND_GATE_OUTPUT_INVERTED 1

static constexpr uint8_t AND_INPUT_A = 25;
static constexpr uint8_t AND_INPUT_B = 26;
static constexpr uint8_t AND_SENSE_PIN = 27;
static constexpr uint8_t GREEN_LED = 18;
static constexpr uint8_t RED_LED = 19;
static constexpr uint8_t BUZZER = 23;

static constexpr uint32_t WINDOW_MS = 10000;
static constexpr uint32_t BUZZ_ON_MS = 180;
static constexpr uint32_t BUZZ_OFF_MS = 380;

BLEServer *bleServer = nullptr;
BLECharacteristic *notifyChar = nullptr;
volatile bool bleConnected = false;
bool wasConnected = false;

portMUX_TYPE rxMux = portMUX_INITIALIZER_UNLOCKED;
volatile bool rxReady = false;
char rxPacket[10] = {0};

volatile bool decisionActive = false;
volatile bool decisionApproved = false;
volatile uint32_t startedAt = 0;
volatile uint32_t lastBuzzAt = 0;
volatile bool buzzerHigh = false;

void allOff() {
  digitalWrite(AND_INPUT_A, LOW);
  digitalWrite(AND_INPUT_B, LOW);
  digitalWrite(GREEN_LED, LOW);
  digitalWrite(RED_LED, LOW);
  digitalWrite(BUZZER, LOW);
  decisionActive = false;
  buzzerHigh = false;
}

bool physicalAndHigh() {
  bool signal = digitalRead(AND_SENSE_PIN) == HIGH;
#if AND_GATE_OUTPUT_INVERTED
  return !signal;
#else
  return signal;
#endif
}

bool startDecision(bool a, bool b, bool &y) {
  allOff();
  digitalWrite(AND_INPUT_A, a ? HIGH : LOW);
  digitalWrite(AND_INPUT_B, b ? HIGH : LOW);
  delay(5);
  y = physicalAndHigh();
  bool matches = y == (a && b);
  decisionApproved = matches && a && b && y;
  digitalWrite(GREEN_LED, decisionApproved ? HIGH : LOW);
  digitalWrite(RED_LED, decisionApproved ? LOW : HIGH);
  buzzerHigh = !decisionApproved;
  digitalWrite(BUZZER, buzzerHigh ? HIGH : LOW);
  startedAt = millis();
  lastBuzzAt = startedAt;
  decisionActive = true;
  Serial.printf("AND A=%d B=%d real Y=%d -> %s for 10 seconds\n",
                a, b, y, decisionApproved ? "GREEN" : "RED+BUZZER");
  return matches;
}

void updateIndicators() {
  if (!decisionActive) return;
  uint32_t now = millis();
  if (uint32_t(now - startedAt) >= WINDOW_MS) {
    allOff();
    Serial.println("10-second indicator window finished; outputs LOW.");
    return;
  }
  if (!decisionApproved) {
    uint32_t duration = buzzerHigh ? BUZZ_ON_MS : BUZZ_OFF_MS;
    if (uint32_t(now - lastBuzzAt) >= duration) {
      buzzerHigh = !buzzerHigh;
      digitalWrite(BUZZER, buzzerHigh ? HIGH : LOW);
      lastBuzzAt = now;
    }
  }
}

void indicatorTask(void *) {
  for (;;) {
    updateIndicators();
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

class ServerEvents : public BLEServerCallbacks {
  void onConnect(BLEServer *) override {
    bleConnected = true;
    Serial.println("Web Bluetooth connected.");
  }
  void onDisconnect(BLEServer *) override {
    bleConnected = false;
    Serial.println("Web Bluetooth disconnected.");
  }
};

class IncomingWrites : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *characteristic) override {
    String value = characteristic->getValue();
    if (value.length() != 9 || value.charAt(0) != 'D') return;
    for (int i = 1; i <= 6; ++i) {
      char c = value.charAt(i);
      if (!((c >= '0' && c <= '9') || (c >= 'A' && c <= 'F'))) return;
    }
    if ((value[7] != '0' && value[7] != '1') ||
        (value[8] != '0' && value[8] != '1')) return;

    portENTER_CRITICAL(&rxMux);
    // Never overwrite a pending command from a second BLE write.
    if (!rxReady && !decisionActive) {
      for (int i = 0; i < 9; ++i) rxPacket[i] = value[i];
      rxPacket[9] = '\0';
      rxReady = true;
    }
    portEXIT_CRITICAL(&rxMux);
  }
};

void setup() {
  Serial.begin(115200);
  pinMode(AND_INPUT_A, OUTPUT);
  pinMode(AND_INPUT_B, OUTPUT);
  pinMode(AND_SENSE_PIN, INPUT);
  pinMode(GREEN_LED, OUTPUT);
  pinMode(RED_LED, OUTPUT);
  pinMode(BUZZER, OUTPUT);
  allOff();

  if (xTaskCreate(indicatorTask, "led-10-sec", 2500, nullptr, 1, nullptr) != pdPASS) {
    Serial.println("ERROR: Cannot start indicator timer.");
    while (true) { allOff(); delay(500); }
  }

  BLEDevice::init(BLE_DEVICE_NAME);
  bleServer = BLEDevice::createServer();
  bleServer->setCallbacks(new ServerEvents());
  BLEService *service = bleServer->createService(SERVICE_UUID);

  notifyChar = service->createCharacteristic(
      TX_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  notifyChar->addDescriptor(new BLE2902());

  BLECharacteristic *writeChar = service->createCharacteristic(
      RX_UUID, BLECharacteristic::PROPERTY_WRITE);
  writeChar->setCallbacks(new IncomingWrites());

  service->start();
  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  advertising->start();

  Serial.println("LOGIX-BLE advertising. Open the HTTPS website in Android Chrome.");
  Serial.println("Select Connect ESP32 via BLE; no Wi-Fi or external sensor required.");
}

void loop() {
  // Re-advertise when the phone disconnects.
  if (!bleConnected && wasConnected) {
    delay(250);
    bleServer->startAdvertising();
    wasConnected = false;
    Serial.println("BLE advertising restarted.");
  }
  if (bleConnected) wasConnected = true;

  char packet[10] = {0};
  bool haveCommand = false;
  portENTER_CRITICAL(&rxMux);
  if (rxReady) {
    for (int i = 0; i < 10; ++i) packet[i] = rxPacket[i];
    rxReady = false;
    haveCommand = true;
  }
  portEXIT_CRITICAL(&rxMux);

  if (haveCommand && !decisionActive) {
    bool a = packet[7] == '1';
    bool b = packet[8] == '1';
    bool y = false;
    bool gateCorrect = startDecision(a, b, y);
    const char status = !gateCorrect ? 'F' : (y ? 'P' : 'D');

    // R + six-byte nonce + measured gate output + status.
    char reply[10] = {'R', packet[1], packet[2], packet[3], packet[4],
                      packet[5], packet[6], y ? '1' : '0', status, '\0'};
    if (bleConnected) {
      notifyChar->setValue((uint8_t *)reply, 9);
      notifyChar->notify();
    }
    Serial.printf("BLE reply: %s\n", reply);
  }
  delay(10);
}
