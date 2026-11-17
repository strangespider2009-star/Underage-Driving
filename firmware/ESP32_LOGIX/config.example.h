#pragma once
// COPY THIS FILE TO config.h, THEN EDIT. NEVER COMMIT config.h.
static const char WIFI_SSID[] = "YOUR_WIFI_NAME";
static const char WIFI_PASSWORD[] = "YOUR_WIFI_PASSWORD";
// Your NEW Render deployment (the old LOGIX site does not have ESP32 API routes).
static const char SERVER_URL[] = "https://YOUR-NEW-SERVICE.onrender.com";
// Register a device in website -> Setup guide. Copy these once-only credentials:
static const char DEVICE_ID[] = "PASTE_DEVICE_ID";
static const char DEVICE_KEY[] = "PASTE_64_CHARACTER_DEVICE_KEY";

// 1 = SN7408 / SN74LS08 / SN74HCT08 @ 5V via NPN inverter (recommended for classic 7408).
// 0 = SN74HC08 @ 3.3V with pin 3 wired directly to ESP32 GPIO27.
#define AND_GATE_OUTPUT_INVERTED 1
