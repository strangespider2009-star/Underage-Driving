# Underage-Driving — ESP32 BLE + 7408 AND gate + phone passkey

**Desktop LED-and-buzzer educational demonstration only. Do not connect the outputs to any real vehicle, ignition, lock, steering, or motor.**

**No Wi-Fi, HC-05, R307, AS608, or external fingerprint sensor is required.** Enrollment and verification of a *phone passkey* use the browser's WebAuthn prompt. The phone may request a fingerprint, face unlock, or screen-lock PIN: websites cannot require fingerprint-only verification or access biometric samples.

## Components

- ESP32-WROOM-32 DevKit (USB data cable; built-in Bluetooth Low Energy)
- 1 × SN7408 / SN74LS08 / SN74HCT08, 14-pin DIP AND IC (5V TTL-compatible); **or** 74HC08 at 3.3V
- 2 × 330Ω resistors, green LED, red LED
- 2 × 10kΩ pull-down resistors, 100nF capacitor
- For the 5V logic variant: 1 × BC547 or appropriate 2N2222 transistor Q1, 4.7kΩ resistor, 22kΩ resistor
- For an active 5V buzzer: 1 × suitable NPN transistor Q2, 1kΩ base resistor, suitable flyback diode if buzzer is inductive
- Breadboard, wires, and regulated 5V supply appropriate for the 7408 and buzzer

## ESP32 firmware pins

| ESP32 DevKit pin | Purpose |
|---|---|
| GPIO25 | Input A to 7408 pin 1: face matched **and** approval policy |
| GPIO26 | Input B to 7408 pin 2: server-verified phone passkey assertion |
| GPIO27 | Read the physical 7408 output via Q1 inverter (or direct 3.3V 74HC08) |
| GPIO18 | Green LED |
| GPIO19 | Red LED |
| GPIO23 | Active buzzer transistor control |
| GND | Ground common to all components |
| USB | ESP32 power/programming |

There is **no wiring at GPIO16 or GPIO17**; the old R307 sensor has been removed.

## 1. Identifying your 7408

Read the **exact full part number** printed on the chip and its datasheet. Find the notch/dot marking before counting pins counterclockwise viewed from above.

For a 14-pin 7408-family AND-gate DIP:

| IC pin | Connection |
|---|---|
| **14** | Regulated **5V** for classic SN7408, SN74LS08, SN74HCT08; **3.3V** only for the 74HC08 variant described below |
| **7** | GND |
| **1** | ESP32 GPIO25 plus separate 10kΩ pull-down to GND |
| **2** | ESP32 GPIO26 plus separate 10kΩ pull-down to GND |
| **3** | Gate output Y (do not connect directly to ESP32 if the chip runs at 5V) |
| **4, 5, 9, 10, 12, 13** | Tie unused gate **inputs** to GND |
| **6, 8, 11** | Leave unused gate **outputs** unconnected |

Place a 100nF decoupling capacitor very close to the IC's pins 14 and 7.

### Option A — SN7408 / 74LS08 / 74HCT08 at 5V (default sketch configuration)

3.3V HIGH from ESP32 outputs is accepted by these TTL-compatible chip inputs. Protect GPIO27 from the 5V gate output using an NPN inverter:

- 7408 pin 3 → **4.7kΩ** → Q1 transistor **base**.
- Q1 **emitter** → GND.
- Q1 **collector** → ESP32 **GPIO27**.
- Add **22kΩ** resistor from Q1 collector/GPIO27 to ESP32 **3V3** (not 5V).
- Keep **AND_GATE_OUTPUT_INVERTED 1** in firmware/config.h.

When Y is 1, Q1 pulls GPIO27 low; firmware reverses that reading. **Never feed 5V into GPIO27 or another ESP32 GPIO.**

### Option B — exact SN74HC08 / 74HC08 at 3.3V

- IC pin 14 → ESP32 3V3; pin 7 → GND.
- Inputs pins 1 and 2 → GPIO25 and GPIO26 with pull-downs.
- IC pin 3 → GPIO27 **directly**; omit Q1, 4.7kΩ, and 22kΩ.
- Set **AND_GATE_OUTPUT_INVERTED 0** in config.h.

Do not operate the 74HC08 at 5V and assume ESP32 3.3V HIGH will be recognized; HC thresholds differ from TTL/HCT thresholds. Do not mix the two interface options.

## 2. LEDs and buzzer

| Component | Wiring |
|---|---|
| Green LED | GPIO18 → 330Ω → LED anode (+); cathode (−) → GND |
| Red LED | GPIO19 → 330Ω → LED anode (+); cathode (−) → GND |
| Active 5V buzzer | Regulated 5V → buzzer positive; buzzer negative → Q2 collector; Q2 emitter → GND |
| Buzzer base drive | GPIO23 → 1kΩ → Q2 base |

Ensure Q1 and Q2 use the correct manufacturer's E-B-C pinout; BC547, 2N2222 and PN2222 lead arrangements can differ.

An active buzzer sounds when given DC power. For an inductive/magnetic buzzer, follow its datasheet's flyback diode instructions (diode cathode towards +5V). Avoid powering high-current peripherals directly from ESP32 GPIO or the 3V3 regulator. Provide suitable regulated power and shared grounds.

## 3. Truth table

| A: face + demo policy | B: phone passkey verified | Y = A AND B | Output for 10 seconds |
|---:|---:|---:|---|
| 0 | 0 | 0 | Red LED + pulsed buzzer |
| 0 | 1 | 0 | Red LED + pulsed buzzer |
| 1 | 0 | 0 | Red LED + pulsed buzzer |
| 1 | 1 | 1 | Green LED, buzzer silent |

The ESP32 drives both inputs, reads the physical gate output via GPIO27, and verifies the truth table. A gate mismatch triggers red LED and buzzer. A separate FreeRTOS task shuts everything OFF after approximately 10 seconds even if HTTP polling blocks. The project doesn't use this result to operate a vehicle.

## 4. Bluetooth Low Energy (BLE) setup

1. Install **esp32 by Espressif Systems 3.x** in Arduino IDE. The BLE headers are supplied by the ESP32 board package; no Wi-Fi, ArduinoJson, or fingerprint library is necessary.
2. Open **firmware/ESP32_LOGIX/ESP32_LOGIX.ino**, upload to the ESP32-WROOM-32 board, and check the Serial Monitor at **115200**. It should say **LOGIX-BLE advertising**.
3. Open the **deployed Render HTTPS website in Android Chrome**, with Bluetooth enabled on your phone. Tap **Connect ESP32 via BLE** and select **LOGIX-BLE**.
4. Render still handles the user account and **signed phone passkey challenge**. The phone sends the resulting A/B demo bits directly to ESP32 over BLE. ESP32 does not need internet.
5. On the website, enroll a consenting person's face using the phone camera and enroll their phone passkey. Then verify face, verify passkey, and select **Evaluate physical 7408 gate**.
6. The physical gate result comes back over BLE as a short notification. Check all four truth-table combinations and ensure the LED/buzzer duration is 10 seconds.
7. If the BLE connection drops, tap **Connect ESP32 via BLE** again; the firmware resumes advertising on disconnect.

**GATT transport**: device name `LOGIX-BLE`, Nordic UART Service `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`, RX write `6E400002...`, TX notifications `6E400003...`. The phone sends a nine-byte decision packet and checks a matching nonce in the ESP32's nine-byte output notification.

**Browser support:** Web Bluetooth is available in supported Android Chrome over HTTPS; basic Android WebView wrappers and Safari on iPhone do not expose equivalent Web Bluetooth APIs. The phone requires an internet connection to contact Render for its passkey verification; the ESP32 does **not**.

**Security limitation:** Web Bluetooth packets are not authenticated as proof of identity by this ESP32 sketch. Nearby BLE clients may send commands, and the server logs browser-reported hardware feedback. **Never use these output signals for a vehicle, ignition, motor or lock.**

**Data warning:** Render Free's ephemeral JSON database may lose account/passkey data across restarts. Use persistent storage if demos must survive redeployments.

### Hardware references

- TI SN7408 datasheet: https://www.ti.com/lit/ds/symlink/sn7408.pdf
- Nexperia 74HC08/74HCT08: https://www.nexperia.com/products/analog-logic-ics/logic/gates/and-gates/serie/74hc08-74hct08/
- Espressif ESP32 hardware: https://documentation.espressif.com/esp32_datasheet_en.html
