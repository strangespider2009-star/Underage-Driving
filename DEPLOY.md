# Deploy Underage-Driving passkey edition on Render

The GitHub repository is already published:
https://github.com/strangespider2009-star/Underage-Driving

## Render (Node Web Service)

Use the existing underage-driving service connected to the main branch, or create a new service from render.yaml.

Build command:

    npm install --include=dev && npm run check && npm run build

Start command:

    npm start

Required configuration:

- NODE_ENV=production
- SESSION_SECRET=a secret random value of at least 24 characters (render.yaml can generate this)
- PUBLIC_ORIGIN is optional for the default Render hostname, but REQUIRED for a custom public domain. It must match the phone browser origin exactly, e.g. https://example.com and no path or trailing slash.
- RENDER_EXTERNAL_HOSTNAME is provided by Render for the normal onrender.com hostname.

## WebAuthn on phone

1. Visit the actual NEW HTTPS deployment in Chrome or Safari on your phone (not the old LOGIX domain).
2. Sign up or sign in, create a demo vehicle and an approved driver.
3. In Enrollment, capture the face using the camera on that phone.
4. Enrol the **phone passkey** with the system prompt. Your device may use fingerprint, face unlock or PIN.
5. In Verification, verify the face and phone passkey, then evaluate the ESP32 7408 logic.

WebAuthn passkeys are bound to website domains; enroll and verify on the same domain. Passkey registration stores a public key and counter, not fingerprint images.

## ESP32

Open firmware/ESP32_LOGIX/ESP32_LOGIX.ino, copy config.example.h to config.h and fill Wi-Fi, server URL, registered device ID and key. No R307, AS608 or HC-05 is used.

Install ArduinoJson v7 and the Espressif ESP32 board support. Wire the 7408, LEDs and buzzer as in WIRING.md and upload the sketch.

## Persistent data warning

The current file-backed JSON database and memory sessions are for demonstration only. Render Free ephemeral files may be erased after restarts or redeployments, deleting registered passkeys, owners, driver records and ESP32 device secrets. A durable database and shared session store are needed for a reliable long-lived deployment.

## Troubleshooting

- If the Render build fails at module resolution, verify that the deployment actually ran npm install after @simplewebauthn/server and @simplewebauthn/browser were added to package.json.
- If passkeys say invalid origin, check PUBLIC_ORIGIN (custom domain) and use the same HTTPS hostname.
- If the phone's security prompt is not shown inside a wrapped APK, use Chrome/Safari over HTTPS first.
- If ESP32 says HTTP 401, check the registered device ID/key in config.h; do not share the key.
- If ESP32 is offline, confirm 2.4GHz Wi-Fi, certificate validation, actual Render server URL and power.
- If the 7408 gives AND_GATE_MISMATCH, inspect correct 5V/3.3V chip variant, pinout, and GPIO27 level interface.

No circuit output may be attached to real vehicle wiring. This is a low-voltage classroom LED-and-buzzer demonstration.
