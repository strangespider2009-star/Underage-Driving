# LOGIX — SMART DRIVE GUARD V2

**A fresh, runnable educational project:** React + Vite frontend, Express owner portal, local browser face-identity comparison, actual optical-fingerprint sensor enrollment/matching through Arduino, and HC-05 Bluetooth Classic serial communication to a red/green LED pair.

> **LED-ONLY EDUCATIONAL DEMONSTRATION.** Never connect it to real vehicle ignition, locks, braking, steering, or other safety-critical equipment. Browser-side face matching is not liveness detection and the server receives client-reported results. This is **not** production-secure identity verification. The project contains no vehicle-control firmware.

## Deploy this code on Render

See **[DEPLOY_LOGIX.md](DEPLOY_LOGIX.md)** for the GitHub `LOGIX` repository, the included `render.yaml` Blueprint and the exact live-site verification steps.

## 0. What's inside

- `src/App.jsx`: new dashboard (register/login, vehicles, demo drivers, enrollment, verification, history, setup)
- `src/face.js`: **identity** recognition using per-driver facial descriptors (not just face detection); rejects no face, multiple faces, or mismatching descriptors
- `src/serial.js`: Web Serial Bluetooth SPP port handshake and request/reply protocol; waits for actual fingerprint sensor confirmation
- `server/index.js`: JSON-backed educational owner API and access decision logging
- `firmware/SmartDriveGuardDemo/SmartDriveGuardDemo.ino`: Arduino UNO + 2 SoftwareSerial ports + fingerprint sensor + HC-05 + two LEDs
- `firmware/SmartDriveGuardMega/SmartDriveGuardMega.ino`: **recommended** Arduino Mega 2560 version with independent hardware UARTs
- `scripts/copy-face-models.mjs`: ships model files from npm dependency into `/models` during dev/build
- `tests/`: 10 automated demo rules, descriptor comparison, and simulated Web Serial protocol tests

**No `.env`, face templates, real passwords or fingerprint templates are bundled.** A fingerprint template is stored *inside the sensor*, not on the server. A face descriptor stays in local browser storage tied to the owner and driver.

## 1. Requirements

### Software
- Node.js >=20.6, npm, Arduino IDE (for the hardware sketch)
- Desktop Chrome or Edge on Windows (recommended for paired HC-05 COM-port support)
- HTTPS for deployment or localhost when developing
- Install Arduino IDE library: **Adafruit Fingerprint Sensor Library** from Library Manager

### Hardware (actual fingerprint-only enrollment)
- Arduino **Mega 2560 recommended** (independent UARTs), or UNO with dual SoftwareSerial sketch
- **R307 or AS608 compatible UART fingerprint reader**, tested by its vendor / Adafruit Fingerprint library
- **HC-05 Bluetooth Classic SPP** module, configured for UART 9600 baud (not AT mode)
- One red LED, one green LED, two appropriate current-limiting resistors (e.g. 220 Ω)
- Appropriate logic-level shifting for 5V to 3.3V UART inputs where required, low-voltage regulated power and common GND

**A fingerprint sensor is required.** A generic website cannot force a phone's or laptop's built-in authenticator to use a fingerprint, or enroll raw fingerprints. WebAuthn passkeys could use PIN or facial unlock instead. This project uses a *separate fingerprint reader* so fingerprint enrollment and matching are actual sensor operations.

## 2. Run website locally (Windows PowerShell)

Extract the ZIP, then open its `SMART_DRIVE_GUARD_COMPLETE` folder in VS Code.

```powershell
npm install
Copy-Item .env.example .env
```

Start backend in terminal 1:

```powershell
npm run dev:server
```

Start frontend in terminal 2:

```powershell
npm run dev
```

Open **http://localhost:5173**.

Expected: registration screen. Register owner, add a test vehicle, then add a test driver with a unique sensor slot (1–127).

> `npm run dev` starts Vite only. Run `npm run dev:server` in a second terminal. Vite proxies `/api` to `127.0.0.1:3001`, avoiding cross-origin cookies.

## 3. Upload Arduino firmware (LED demonstration only)

First choose *one* supported controller:

| Board | Sketch | Reliability |
|---|---|---|
| Arduino Mega 2560 | `firmware/SmartDriveGuardMega/SmartDriveGuardMega.ino` | **Recommended:** independent hardware serial channels |
| Arduino UNO | `firmware/SmartDriveGuardDemo/SmartDriveGuardDemo.ino` | Dual SoftwareSerial; at 57600 for fingerprint UART, reliability depends on board/wiring/sensor |

Install **Adafruit Fingerprint Sensor Library** in Arduino IDE. Open your board's sketch, select board and USB port, compile and upload.

### Mega 2560 connection reference

| Connection | Arduino Mega |
|---|---|
| Fingerprint sensor TX | RX1 (D19) |
| Fingerprint sensor RX | TX1 (D18), respecting sensor logic levels |
| HC-05 TX | RX2 (D17) |
| HC-05 RX | TX2 (D16) through suitable 5V-to-3.3V level shifter/divider |
| Green LED | D6 through current-limiting resistor |
| Red LED | D7 through current-limiting resistor |
| Ground | All modules and LEDs share GND |

### UNO reference

| Connection | Arduino UNO |
|---|---|
| Fingerprint sensor TX | D2 (SoftwareSerial RX) |
| Fingerprint sensor RX | D3 (SoftwareSerial TX), respecting sensor logic levels |
| HC-05 TX | D10 (SoftwareSerial RX) |
| HC-05 RX | D11 (SoftwareSerial TX) through level shifter/divider |
| Green / red LEDs | D6 / D7 through current-limiting resistors |

**Check the specific module datasheets first**: breakout-board VCC ratings and sensor UART voltages vary. Keep the circuit low-voltage and do not connect it to a vehicle, mains power or other loads. If the sensor does not answer at 57600 baud, consult the sensor's baud-rate configuration; if HC-05 is in AT mode, configure its normal data baud separately.

### Confirm the sensor

After uploading, open Arduino Serial Monitor at 9600 baud. It should say:

```
FINGERPRINT SENSOR READY
HC-05 UART 9600, LED demonstration only
```

If it says `FINGERPRINT SENSOR NOT FOUND`, correct the sensor power/TX/RX/baud before trying the website.

## 4. Pair HC-05 and connect

1. Power the demo Arduino from USB; don't connect to real vehicle circuits.
2. In Windows Settings → Bluetooth, pair your HC-05 as supported by your Bluetooth adapter. The module needs to expose a **serial COM port** through Bluetooth SPP.
3. In Windows Device Manager, identify its outgoing serial COM port.
4. Open the site in **desktop Chrome or Edge**, using localhost or HTTPS.
5. Open **Enrollment** or **Verification** and click **Connect HC-05**.
6. Select the paired outgoing HC-05 COM port.
7. The browser sends `PING`; Arduino replies `PONG SENSOR_OK` with the request ID. If the optical sensor is absent, the site rejects the connection rather than falsely marking it ready.

> Windows, Bluetooth drivers and browser support vary. If the COM port does not appear, try another supported desktop machine or adapter. HC-05 Bluetooth Classic SPP is not Web Bluetooth GATT; this project correctly uses **Web Serial**. iOS Safari cannot use the same workflow. A remote Render server cannot access the serial devices paired to *your* computer—the browser communicates with the local COM port.

## 5. Enroll both biometrics

1. Register/sign in as a demo owner.
2. In **Vehicles**, create a demo vehicle.
3. In **Drivers**, add a demo driver and select a unique fingerprint sensor slot, e.g. `3`.
4. Approve the driver (necessary for the final green LED).
5. Open **Enrollment**, choose the driver, and connect HC-05.
6. For the **face**: start camera → keep *one consenting person* in view → click **Enrol face**. Five descriptor samples are averaged. The template stays in this exact browser profile and is not uploaded.
7. For the **fingerprint**: click **Enrol fingerprint** → place one finger on the optical sensor → remove it when prompted → place the **same finger** again. Arduino uses `createModel()` and `storeModel(slot)`. Only a real `ENROLL_OK slot requestId` from the Arduino marks the demo driver enrolled on the site.
8. If needed, use **Delete face** or **Delete print**. Sensor slots may contain older fingerprints from previous projects; delete/re-enrol deliberately.

## 6. Verify and light LEDs

1. Go to **Verification**, select the enrolled driver, and connect HC-05 if needed.
2. Start camera → **Verify face**. The app compares three fresh descriptors against that driver's stored template. Different faces should normally produce `NO MATCH`, including a red LED signal.
3. Click **Verify fingerprint** and present the enrolled finger. The sensor does `fingerFastSearch()` and verifies that the matched template ID equals the **selected driver's assigned slot**. A wrong, unknown or timed-out finger produces `VERIFY_FAIL ...` and **red LED**.
4. Click **Evaluate & send LED result** after both steps. All conditions must be true: face match, exact sensor slot match, assigned vehicle, demo licence not expired, owner approval.
5. **Green LED** = all these demonstration checks passed. **Red LED** = failed check or rejected decision. A fingerprint passing by itself does *not* switch the green LED on.
6. **Reset** turns LEDs off. Review log entries in **Access history**.

### Serial protocol (all commands newline terminated)

| Browser → Arduino | Arduino → Browser | Meaning |
|---|---|---|
| `PING 1` | `PONG SENSOR_OK 1` | Connected, fingerprint module detected |
| `ENROLL 3 2` | `ENROLL_OK 3 2` or `ENROLL_FAIL 3 REASON 2` | Two optical captures + template storage |
| `VERIFY 3 3` | `VERIFY_OK 3 3` or `VERIFY_FAIL 3 WRONG_PERSON 3` | Same fingerprint slot required |
| `DELETE 3 4` | `DELETE_OK 3 4` | Delete physical template |
| `RESULT PASS 5` | `RESULT_OK PASS 5` | Green LED on |
| `RESULT FAIL 6` | `RESULT_OK FAIL 6` | Red LED on |
| `RESET 7` | `RESET_OK 7` | Both LEDs off |

Request numbers vary. The website checks the response request ID and correct slot before accepting success.

## 7. Deploy to Render (single same-origin Web Service)

**Recommended:** one Render **Web Service** for both Express and React, instead of a separate Render static frontend and backend. This avoids third-party cookie problems.

1. Create a new GitHub repo or push these ZIP contents into the repo you want deployed.
2. On Render: New → Web Service → connect your repo.
3. Choose Node runtime.
4. **Build command:** `npm install && npm run build`
5. **Start command:** `npm start`
6. Environment variables:

```text
NODE_ENV=production
SESSION_SECRET=<long-random-secret-24-plus-characters>
```

7. Redeploy. The generated `/dist` is served by the Express backend from the same origin. You should not set `VITE_API_URL`; the frontend uses same-origin `/api` requests.
8. Open `https://<your-service>.onrender.com/api/health` → expected JSON `{"ok":true,...}`.
9. Check `https://<your-service>.onrender.com/models/face_recognition_model-weights_manifest.json` → expected JSON, not HTML/404.
10. Test camera, Bluetooth permission, face matching and fingerprint sensor **from the user's local desktop browser**. Render hosts the website and API, not a physical Bluetooth bridge.

**Persistence caveat:** Render's ephemeral filesystem and the demo's Express in-memory sessions can lose demo data or logins on restart/redeploy. For a persistent project, use a managed database and session store; setting `DATA_DIR` to an attached persistent disk location can preserve demo JSON on an eligible configuration. This demo is intentionally not a production identity service.

## 8. Automated checks

```powershell
npm run check
npm run build
```

The test suite exercises all-vs-one rejection logic, wrong face/fingerprint, approval/expiry checks, face-descriptor comparison, and a simulated HC-05 serial fingerprint enroll/verify/delete/LED handshake.

A real camera, optical sensor, Bluetooth adapter and Arduino need physical end-to-end testing. No one can guarantee “zero errors” across all devices without that testing. A **source ZIP** still requires `npm install` and, for actual fingerprints, the hardware above.

## 9. Troubleshooting

| Symptom | Cause / check |
|---|---|
| App shows API error | Start both local terminals or check same-origin Render service |
| Site says model load failed | Ensure `npm run dev` / `npm run build` runs the model-copy script and `/models` assets return HTTP 200 |
| Camera denied | HTTPS/localhost, allow camera, close other camera apps |
| Other face appears to match | Face descriptors are imperfect; improve lighting and enrollment quality, retake template; **do not treat results as secure identity** |
| HC-05 not in browser chooser | Pair Windows Bluetooth SPP, confirm outgoing COM port, desktop supported browser, HTTPS/localhost |
| HC-05 opens but no PONG | Upload matching sketch, use HC-05 9600 baud, choose correct COM port |
| PONG says SENSOR_MISSING | Optical fingerprint UART wiring/power/baud or unsupported sensor library |
| Finger scan fails | Re-enrol, use dry clean finger/sensor, wait for remove/second-touch prompt, confirm template slot |
| Wrong finger accepted | Check sensor slot has only the intended enrollment and matches the correct driver's ID; reset sensor templates in a controlled demo if needed |
| Green LED not on after fingerprint success | Also verify face, valid date, vehicle, owner approval, and click **Evaluate** |
| Auth/logs lost after deployment | Demo uses JSON files/in-memory sessions; configure durable storage for persistence |

## 10. Privacy, safety and honesty

- Obtain **informed consent** before any face/fingerprint enrollment.
- Use test-only owner accounts and demonstration driver details; do not upload real driver's licences.
- Face descriptors in localStorage are accessible to local browser-profile access and injected scripts; this is not secure biometric storage.
- Fingerprints are enrolled and compared **on the optical sensor**; browser receives slot-match result only.
- A client controlling the browser may forge the face flag or directly send `RESULT PASS` over serial. This system provides LED feedback only and cannot be used to authenticate a real person for a vehicle.
- The project has no facial liveness or anti-spoofing protection, no driver-bound secure hardware attestation, no replay-resistant signed sensor events, and no real-world safety assurance.

**Useful official references:**
- Web Serial: https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API
- Adafruit Fingerprint library: https://github.com/adafruit/Adafruit-Fingerprint-Sensor-Library
- Adafruit sensor enrollment guide: https://learn.adafruit.com/adafruit-optical-fingerprint-sensor/enrolling-with-arduino
