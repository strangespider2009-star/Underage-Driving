# Underage-Driving BLE + passkey edition: acceptance checks

These checkboxes are a **test plan**, not a claim that real ESP32 hardware was tested. The only permitted use is a low-voltage LED-and-buzzer desk demonstration; **never connect to a real vehicle or lock**.

## Website + face

- [ ] The latest Render deployment serves the updated LOGIX website on HTTPS.
- [ ] Owner can sign in, add a sample vehicle and driver, and approve the driver.
- [ ] Camera enrollment stores face descriptor locally in that phone browser.
- [ ] Face comparison passes for enrolled face and fails for a clearly different face.
- [ ] Face checks do not claim independent liveness protection.
- [ ] Driver without owner approval makes the demo A input LOW.

## Phone passkey / Render

- [ ] Android Chrome on the deployed HTTPS domain shows **Enrol phone passkey**.
- [ ] Phone passkey prompt is handled by the operating system; fingerprint/face/PIN may be offered.
- [ ] Server saves public credential key, not phone fingerprint scans.
- [ ] **Verify phone passkey** requires a signed, user-verified response to a fresh challenge.
- [ ] An aborted or unsuccessful passkey prompt cannot produce a passing proof.
- [ ] A server-issued passkey proof expires after 90 seconds and is bound to the same browser session/driver.
- [ ] A passkey proof is consumed only once.
- [ ] Server sends B=1 only after validating an unused passkey proof.
- [ ] The phone still has internet to reach Render, but ESP32 does not require internet.
- [ ] Changing deployed site domain requires registering a passkey for the new domain.

## Web Bluetooth

- [ ] On Android Chrome, pressing **Connect ESP32 via BLE** shows the Bluetooth device chooser.
- [ ] ESP32 is visible as **LOGIX-BLE** and GATT connection succeeds.
- [ ] Interface displays BLE CONNECTED; disconnect event changes status.
- [ ] BLE disconnect and reconnect work without restarting the website.
- [ ] BLE RX and TX use Nordic UART Service UUIDs documented in README.
- [ ] Phone sends a valid 9-byte command D+nonce+A+B.
- [ ] ESP32 notifies R+same nonce+measured Y+P/D/F; browser ignores wrong nonces/malformed messages.
- [ ] When notifications fail, website reports NO REPLY rather than claiming physical confirmation.
- [ ] Browser BLE results in the history are labeled as browser-reported, not cryptographically authenticated device evidence.
- [ ] A normal Android WebView APK and iPhone Safari do not misleadingly show BLE as supported.

## ESP32 and actual 7408

- [ ] ESP32 DevKit firmware uploads with Espressif Arduino core 3.x.
- [ ] Firmware has no Wi-Fi, ArduinoJson, config.h, trust_roots.h, R307, or HC-05 dependency.
- [ ] BLE advertises after boot and again after disconnect.
- [ ] Actual IC model, notch orientation, and supply voltage are confirmed by datasheet.
- [ ] 7408 input A is on GPIO25 and B on GPIO26 with 10kΩ pulldowns.
- [ ] 7408 physical output on GPIO27 uses the correct level-safe interface and inversion setting.
- [ ] 5V is never fed into an ESP32 GPIO.
- [ ] Unused 7408 gate inputs are tied to a defined level.
- [ ] 100nF decoupling capacitor is placed close to the IC supply pins.
- [ ] Green LED/resistor on GPIO18; red LED/resistor on GPIO19.
- [ ] Active buzzer connected via suitable Q2 driver on GPIO23.
- [ ] All grounds common, regulated supplies within current limits.

## Logic and output

| A | B | Actual Y | Expected |
|---:|---:|---:|---|
| 0 | 0 | 0 | Red LED + pulsed buzzer for 10 sec |
| 0 | 1 | 0 | Red LED + pulsed buzzer for 10 sec |
| 1 | 0 | 0 | Red LED + pulsed buzzer for 10 sec |
| 1 | 1 | 1 | Green LED for 10 sec |

- [ ] All LEDs, buzzer, and 7408 input pins return LOW/OFF after approximately ten seconds.
- [ ] Physical gate mismatch produces a FAULT response and red+buzzer, never green.
- [ ] A second command during active indication cannot prematurely extend the timer.
- [ ] No signal is connected to a real vehicle or any safety-critical actuator.

## Deployment health

- [ ] GitHub Actions npm tests and frontend build pass.
- [ ] Render is redeployed to the latest GitHub commit and /api/health returns ok.
- [ ] The project has durable database/session storage if user registrations must survive restarts.
