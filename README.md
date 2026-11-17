# Underage-Driving — LOGIX ESP32 biometric AND-gate demo

**Retains the original LOGIX React dashboard** (registration, owner login, vehicles, driver approvals, enrollment, verification, history, setup) while **replacing HC-05 / desktop Web Serial with ESP32 Wi-Fi**. A genuine **7408 AND IC** combines 2 signals. The physical gate output is measured by the ESP32, which lights **green for 10 seconds** when the gate says 1, or **red and pulses an active buzzer for 10 seconds** when it says 0.

**This is an LED-and-buzzer-only educational bench project. It is not an age-verification tool, vehicle immobilizer, ignition controller, or road-use safety system. Never attach to any real vehicle.**

## Architecture

```text
Browser on phone/PC (HTTPS)            Node + Express server on Render
Face enroll/verify locally ──────────▶ Owner auth, drivers, status, job queue
                                     ◀── completed ESP32 job and truth-table status
   (R307 sensor is NOT in phone)                 ▲            │
                                               │ HTTPS      │ HTTPS
                                               │            ▼
                                   ESP32 on Wi-Fi ↔ UART R307/AS608
                                   GPIO25 A ───┐
                                               ├── physical SN7408 AND ── Q1 safe interface → GPIO27
                                   GPIO26 B ───┘
                                   GPIO18 green LED • GPIO19 red LED • GPIO23 buzzer switch
```

The phone or laptop camera supplies the face samples and comparison. Face descriptors are stored in that browser's local storage **only** (as in the original LOGIX app). A different browser/phone will need a new face enrollment. Fingerprint templates are stored **inside the R307/AS608 module** on the ESP32; website commands request enrollment/verification, but the website does not receive raw fingerprint images. The ESP32's built-in Bluetooth exists but is **not used** in this architecture, which avoids the HC-05 / WebView Bluetooth problem.

## Hardware behavior

| Face + authorization policy = A | Fingerprint sensor result = B | Measured IC output Y | What happens for 10 seconds |
|---|---|---|---|
| 0 | 0 | 0 | Red LED + pulsing buzzer |
| 0 | 1 | 0 | Red LED + pulsing buzzer |
| 1 | 0 | 0 | Red LED + pulsing buzzer |
| 1 | 1 | 1 | Green LED, no buzzer |

`A` is the real browser face comparison result AND the existing LOGIX demonstration approval rules (owner approval, correct assigned vehicle and valid entered test licence date). `B` is taken from a recent **successful hardware VERIFY job**, not a browser-supplied `fingerprintMatched: true` flag. `Y` is read from the **physical** AND IC; a wiring/truth-table mismatch triggers red+buzzer and a reported fault. Both input pins go LOW when the 10-second window ends.

## Installation and local website

**Requirements:** Node 20.6+, npm, ESP32-WROOM-32 DevKit, R307/AS608 UART fingerprint sensor, 7408 family IC, two LEDs and resistors, NPN interface transistors, active buzzer.

```bash
npm install --include=dev
npm run check
npm run build
npm start
```

Open `http://localhost:3001` for the production-style server. For development, use two terminals:

```bash
# terminal 1
npm run dev:server
# terminal 2
npm run dev
```

Set `SESSION_SECRET` to a random 32+ character value. See `.env.example`. For development `node --env-file=.env server/index.js` is used by `npm run dev:server`.

## Deploy on Render

1. Upload the repository to GitHub (see `DEPLOY.md`). Create a **NEW** Render Web Service pointing at it (not the old LOGIX deployment).
2. Build command: `npm install --include=dev && npm run check && npm run build`.
3. Start command: `npm start`.
4. Set environment variables: `NODE_ENV=production`, `SESSION_SECRET` (32+ random characters), optionally `DATA_DIR` pointing at mounted persistent storage. `render.yaml` provides a blueprint. **On ephemeral services, accounts, device enrollment status and history disappear on restarts/redeploys.** For reliable use, use a persistent storage service or database.
5. Visit the **NEW** Render URL. The existing `https://logix-nyxj.onrender.com` deployment is not automatically changed by these files.
6. Log in / register as owner, add a vehicle and driver, approve the driver, then open **Setup guide** → **Register new ESP32**.
7. Copy the displayed **device ID + device key** once, along with the new Render HTTPS URL. The site only stores a SHA-256 key hash; the original key cannot be recovered. Treat it as a secret.
8. Prepare ESP32 firmware and power it on. Once its periodic HTTPS polling succeeds, the site shows `ESP32 + SENSOR ONLINE`.

## Flash the ESP32

1. In Arduino IDE install **esp32 by Espressif Systems** using Boards Manager; select **ESP32 Dev Module** (for a typical ESP32-WROOM-32 DevKit board).
2. Install **Adafruit Fingerprint Sensor Library** and **ArduinoJson v7** using Library Manager.
3. Open `firmware/ESP32_LOGIX/ESP32_LOGIX.ino`.
4. In the same folder, **copy** `config.example.h` to `config.h` (the latter is gitignored). Enter your **2.4 GHz Wi-Fi** SSID/password, **NEW** Render URL, device ID and 64-digit device key from the website. Select the AND IC output interface mode in the config.
5. Assemble according to **[WIRING.md](WIRING.md)**, confirming the full chip marking, logic voltages, pin 1/notch orientation, transistor pin order, R307 cable pinout, LED polarity, supply current, and common ground. Use the Q1 interface for any 5 V 7408 output. **Never feed 5 V directly into an ESP32 GPIO.**
6. Upload, open Serial Monitor at **115200 baud**, and verify `R307/AS608 sensor: READY`, a valid NTP clock and successful HTTPS status. The sketch includes several well-known public CA roots, but you must maintain trust anchors if your host CA changes.
7. Avoid exposing your Wi-Fi password, device key or locally saved biometric data in GitHub or screenshots.

## Enroll and verify

1. **Vehicles** → add a sample vehicle.
2. **Drivers** → add driver with an unused fingerprint slot (`1–127`), a test licence expiry date in the future, and approve the driver.
3. **Enrollment** → select the driver → **Start camera** → **Enrol face**. Obtain consent before collecting any biometric data.
4. **Enrollment** → **Enrol fingerprint** → place finger on the **external R307**, lift when the ESP32 serial log prompts, and press the **same** finger a second time. Website waits for successful device confirmation.
5. **Verification** → choose driver → **Verify face** → **Verify fingerprint** with the R307 → **Evaluate physical 7408 gate**. Two actual comparisons are required; a fresh fingerprint result can only be used once in a decision.
6. Observe the LED and buzzer on your breadboard. After **10 seconds**, all outputs turn OFF automatically.
7. To demonstrate rejection, try a different face or different finger. The site records the demonstration result in its event log.

## Protocol summary

| HTTP method + path | Caller | Purpose |
|---|---|---|
| `POST /api/devices` | Logged-in owner | Create ESP32 credentials, shown one time |
| `GET /api/devices` | Owner | Online/sensor status |
| `POST /api/device/jobs` | Owner | Queue `ENROLL`, `VERIFY`, `DELETE` for assigned driver |
| `GET /api/device/jobs/:id` | Owner | Poll completion |
| `POST /api/access/check` | Owner | Validate recent sensor VERIFY job and face/demo policy, then queue `DECIDE` |
| `GET /api/esp32/job` | ESP32 with `X-Device-Id` and `X-Device-Key` | Heartbeat, claim next job |
| `POST /api/esp32/result` | ESP32 with device credentials | Ack job with success/failure, measured gate bit |

Secrets use timing-safe SHA-256 matching, are stored only as hashes on the server, and travel to the server over HTTPS. Commands are owner-scoped, only one job may run per device, incomplete jobs time out, and failure never counts as a passing fingerprint. This remains a classroom demonstration, **not hardened access control**: face comparisons are browser-side, face models are not liveness resistant, device secrets can be extracted from firmware, and Express memory sessions plus file-backed JSON are not production-scale.

## Where the code lives

- `src/App.jsx`, `src/styles.css`: same LOGIX user interface, ESP32 status and provisioning
- `src/device.js`: website Wi-Fi job client
- `src/face.js`: original local face enrollment/verification
- `server/index.js`: owner API, ESP32 authenticated queue and hardware result
- `server/device.js`: device credential hashing, online status, jobs, expiry
- `server/rules.js`: owner/date/vehicle demo checks
- `firmware/ESP32_LOGIX/ESP32_LOGIX.ino`: Arduino IDE firmware
- `firmware/ESP32_LOGIX/trust_roots.h`: publicly trusted HTTPS roots
- `firmware/ESP32_LOGIX/config.example.h`: Wi-Fi/server/device settings example; secret `config.h` is ignored
- `WIRING.md`: complete low-voltage, chip-variant-aware written circuit
- `DEPLOY.md`: Git/GitHub/Render upload instructions

## Testing / known limitations

`npm run check` runs static JS checks and Node tests for the demo policy, device credential handling, queue rules and AND truth table. There is **no physical ESP32, R307 or 7408 connected to this build environment**, so final electrical behavior and end-to-end Render communication require bench testing. Browser camera permission is needed (inside Android WebView, its wrapper must grant `onPermissionRequest` for camera), even though HC-05/Web Serial is removed. The site does not measure real age or check official licences. This project is an awareness/educational demonstration and **must not enable, disable or control real vehicles**.
