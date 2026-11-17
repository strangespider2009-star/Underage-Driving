# Deploy the Underage-Driving BLE edition

GitHub: https://github.com/strangespider2009-star/Underage-Driving

This edition uses **Android Chrome Web Bluetooth** between phone and ESP32. The ESP32 does **not** connect to Wi-Fi or Render. Render remains necessary for the website's login, face/demo policy and signed phone WebAuthn passkey verification.

## Render Web Service

Use the existing Render service connected to the main branch and redeploy the latest commit, or deploy from render.yaml.

Build command:

    npm install --include=dev && npm run check && npm run build

Start command:

    npm start

Environment:

- NODE_ENV=production
- SESSION_SECRET: 24+ random characters (render.yaml can generate it)
- PUBLIC_ORIGIN: **only for a custom domain**; set the exact HTTPS site origin without trailing slash. Otherwise RENDER_EXTERNAL_HOSTNAME supplies the default Render host.

Passkeys are tied to the exact deployed web domain. Changing the site hostname means enrolling a new passkey for that domain.

**Persistence warning:** This demonstration currently stores users, passkey public keys, drivers, approvals and history in a local JSON file and uses in-memory sessions. Render Free instances can lose these after restarts/redeployments. Use a durable database/session store for any repeat deployment requiring persistent data.

## ESP32 BLE firmware and hardware

1. Install **esp32 by Espressif Systems 3.x** board package in Arduino IDE.
2. Open the single file **firmware/ESP32_LOGIX/ESP32_LOGIX.ino**.
3. No config.h, Wi-Fi credentials, ArduinoJson, trust_roots.h, HC-05, or R307 sensor is needed.
4. Follow WIRING.md to connect ESP32 GPIO25/26, the REAL 7408 AND gate, safe output level interface at GPIO27, LEDs GPIO18/19, and active buzzer driver GPIO23.
5. Upload with ESP32 Dev Module for a typical ESP32-WROOM-32 DevKit. Open Serial Monitor at 115200 and look for "LOGIX-BLE advertising".

## Android phone test

1. Enable Bluetooth, open the **new Render HTTPS site in Android Chrome** (not a basic APK WebView).
2. Sign in, create and approve a demo driver.
3. Tap **Connect ESP32 via BLE**, choose **LOGIX-BLE** from the Chrome device chooser.
4. In Enrollment, enroll the face in this phone browser and the phone passkey. Passkey prompt may use fingerprint, face unlock or PIN.
5. In Verification, run face comparison and **Verify phone passkey**.
6. Within 90 seconds, tap **Evaluate physical 7408 gate**. The backend consumes the one-use verified passkey proof, returns A/B; the phone writes BLE GATT command; ESP32 returns measured physical gate output.
7. Confirm green 10 seconds for A=B=1, red+buzzer 10 seconds for other combinations. Check Access history BLE reply column.

## Browser and security limitations

- Android Chrome on HTTPS supports Web Bluetooth; iPhone Safari and most Android WebView wrappers cannot use this website's Web Bluetooth feature.
- The phone requires an internet connection to Render for passkey challenges, but the ESP32 does not.
- The website cannot force fingerprint-only for passkeys; Android may use face unlock or PIN.
- This is not secure BLE identity enforcement. Nearby BLE clients can send unauthenticated demonstration commands. Browser-reported hardware feedback in Render is not a device attestation.
- Keep it a low-voltage LED-and-buzzer classroom display. Never attach circuit outputs to vehicle electronics or real locks.
