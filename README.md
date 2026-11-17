# Underage-Driving — LOGIX phone passkey + ESP32 AND-gate demo

This project preserves the original LOGIX React dashboard and owner login while replacing the external R307/AS608 fingerprint reader with **phone passkey verification via WebAuthn**.

**Classroom LED-and-buzzer demonstration only. Never connect the circuit to an actual vehicle, engine, ignition, or safety-critical system.** The project does not verify legal age or real driving licences.

## Verification flow

1. Create a test owner account, vehicle, and driver. Approve the driver.
2. Under Setup guide, register ESP32 and securely copy its device ID and one-time secret into firmware/ESP32_LOGIX/config.h.
3. On the PHONE browser, visit the deployed HTTPS site. In Enrollment, enroll a consented face locally and select **Enrol phone passkey**. The platform handles fingerprint, face unlock or device PIN.
4. In Verification, verify the same browser's face template and **Verify phone passkey**.
5. The server verifies the signed passkey challenge, creates a short-lived, single-use proof, derives the two bits, and queues a DECIDE job.
6. ESP32 uses Wi-Fi to fetch this job, drives A/B into the REAL 7408, reads gate output Y, and controls green LED or red LED + active buzzer for 10 seconds.

WebAuthn does not expose fingerprint images or templates and cannot force fingerprint-only: the phone may use face unlock or PIN. Face templates remain browser-local, whereas passkey public keys are stored server-side.

| Input A (face plus demo approval rules) | Input B (verified passkey proof) | Physical 7408 Y | Result |
|---:|---:|---:|---|
| 0 | 0 | 0 | Red LED + buzzer for 10s |
| 0 | 1 | 0 | Red LED + buzzer for 10s |
| 1 | 0 | 0 | Red LED + buzzer for 10s |
| 1 | 1 | 1 | Green LED for 10s |

ESP32 GPIO25=gate A, GPIO26=gate B, GPIO27=output feedback through a safe level interface, GPIO18=green LED, GPIO19=red LED, GPIO23=buzzer transistor. No R307/AS608 or Bluetooth module is needed. See WIRING.md for exact low-voltage connections and 5V vs 3.3V chip-variant rules.

## Deploy (Render)

Repository: https://github.com/strangespider2009-star/Underage-Driving

Build command:

    npm install --include=dev && npm run check && npm run build

Start command:

    npm start

The existing render.yaml provides the deployment configuration and generates SESSION_SECRET. For custom domains configure PUBLIC_ORIGIN as the exact public HTTPS origin without a trailing slash. Render's default deployment uses RENDER_EXTERNAL_HOSTNAME. Passkeys are **origin-bound**: use the SAME site domain for enrollment and verification.

**Important:** The current JSON database and in-memory sessions are demo-only. Render Free ephemeral storage can lose users, passkey public keys, driver approvals, ESP32 devices and job history on restart. Use durable database and session storage before relying on repeat demonstrations.

## ESP32 firmware

- Install esp32 by Espressif Systems in Arduino IDE.
- Install ArduinoJson v7. The Adafruit fingerprint sensor library is no longer needed.
- Open firmware/ESP32_LOGIX/ESP32_LOGIX.ino.
- Copy config.example.h to config.h in the same sketch folder. Configure Wi-Fi (2.4 GHz), SERVER_URL, DEVICE_ID and DEVICE_KEY; keep credentials private and out of GitHub.
- Wire the real 7408, LEDs and buzzer according to WIRING.md.
- Upload sketch and use 115200 Serial Monitor; the site should show ESP32 ONLINE when Wi-Fi and backend credentials work.
- On the phone, enroll and verify face and passkey. Evaluate the 7408 gate.

## Security and functionality notes

- Backend uses @simplewebauthn/server; frontend uses @simplewebauthn/browser.
- Challenge expires in 5 minutes and is consumed once. A verified passkey proof is bound to owner, driver, and the same browser session, expires after 90 seconds, and is single-use.
- A browser-supplied boolean such as passkeyMatched=true never counts as a signed WebAuthn assertion.
- The server checks the authenticator's public key signature, origin, RP ID, user verification, and signature counter.
- A failed or cancelled passkey prompt does not generate a proof and causes input B=0 during the demonstration.
- Browser-side face matching is not liveness-resistant or independent proof of identity.
- The WebView APK wrapper may not support passkey prompts; test Chrome or Safari on the phone over HTTPS.
- A passkey may sync between devices, and the website cannot determine which local unlocking method the phone used.

## Commands

    npm install --include=dev
    npm run check
    npm run build

Tests cover rule checks, one-time passkey proof binding/expiry, ESP32 job ownership and the 7408 truth table.

## Project files

- src/App.jsx — face + phone passkey enrollment and verification interface
- src/passkeys.js — WebAuthn browser prompts
- server/passkeys.js — passkey registration, signature checking and proof validation
- server/index.js — owner and ESP32 APIs, physical gate job queue
- firmware/ESP32_LOGIX/ESP32_LOGIX.ino — Wi-Fi 7408 controller firmware
- WIRING.md — safe demonstration circuit
- render.yaml — Render web service
