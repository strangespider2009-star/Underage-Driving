# Phone passkey + ESP32 AND-gate acceptance checklist

These are **tests to perform**, not claims that real hardware has been tested. Do not attach the breadboard to a vehicle.

## Website and login

- [ ] Account registration and login work on the deployed HTTPS site.
- [ ] Owner data is not exposed to other accounts.
- [ ] A demo vehicle and driver can be created and approved.
- [ ] An unapproved driver cannot produce A=1 even when the face matches.
- [ ] Face enrollment and verification work in the same mobile browser.
- [ ] Face templates remain in that browser; a different browser must enroll separately.
- [ ] Camera permissions are requested correctly and camera stops after leaving the page.
- [ ] The interface clearly states that browser face matching is not liveness detection.

## Phone passkeys

- [ ] On mobile Chrome or Safari over HTTPS, Enrol phone passkey opens the system prompt.
- [ ] Phone local verification may use fingerprint, face unlock or PIN; the site does not claim fingerprint-only.
- [ ] Server creates and verifies WebAuthn challenges; it does not store a phone fingerprint or PIN.
- [ ] Registration checks public-key attestation response and origin/RP ID.
- [ ] Only the enrolled driver's credential ID can authenticate that driver.
- [ ] Verification checks authenticator signature and requires userVerification.
- [ ] Incorrect, cancelled, absent or malformed assertions do not produce a passkey proof.
- [ ] A passkey proof cannot be used for another owner, driver or browser session.
- [ ] A passkey proof expires after 90 seconds.
- [ ] A passkey proof is single-use and cannot be replayed for another green result.
- [ ] Removing passkey invalidates future authentication for that driver.
- [ ] Changing Render domain requires registering a new domain-bound passkey.
- [ ] The user is warned that basic WebView APKs may not support passkey UI.

## ESP32 and physical 7408

- [ ] ESP32 connects to configured 2.4GHz Wi-Fi.
- [ ] Device authenticates with its own ID and secret via HTTPS.
- [ ] ESP32 is shown ONLINE and changes to OFFLINE when disconnected.
- [ ] No Bluetooth module or fingerprint sensor is used.
- [ ] The ESP32 firmware has no Adafruit Fingerprint Sensor dependency.
- [ ] Classic 7408 family chip marking and safe logic voltage interface are verified.
- [ ] 7408 pins 14 and 7 connect to appropriate supply/GND.
- [ ] GPIO25 and GPIO26 each have a 10kΩ pull-down and drive 7408 pins 1 and 2.
- [ ] GPIO27 senses a safely level-shifted output of 7408 pin 3.
- [ ] 5V IC outputs are never connected directly to ESP32 3.3V GPIOs.
- [ ] GPIO18 green and GPIO19 red LEDs have series resistors.
- [ ] GPIO23 drives the buzzer through an appropriate transistor.
- [ ] All grounds are common and power rails are stable.

## Truth table and timing

- [ ] A=0 B=0 yields measured Y=0 and red LED + buzzer.
- [ ] A=0 B=1 yields measured Y=0 and red LED + buzzer.
- [ ] A=1 B=0 yields measured Y=0 and red LED + buzzer.
- [ ] A=1 B=1 yields measured Y=1 and green LED.
- [ ] Physical gate output mismatches report AND_GATE_MISMATCH and fail red.
- [ ] Indicators turn off after about 10 seconds; both logic inputs reset low.
- [ ] Red buzzer pulses rather than remaining continuously on.
- [ ] Access history records passkey and face outcomes.
- [ ] ESP32 cannot queue parallel DECIDE jobs for the same device.
- [ ] Device secret does not appear in GitHub or screenshots.
- [ ] A persistent database/session store is configured if data must survive Render restarts.
