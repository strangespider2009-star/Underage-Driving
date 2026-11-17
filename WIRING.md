# Underage-Driving · ESP32 / fingerprint / physical 7408 wiring

**Purpose: a desk-top low-voltage, LED-and-buzzer demonstration. Do NOT attach any of these connections to a car, ignition, starter, vehicle lock, engine, or road-going equipment.**

## Components

- 1 × **ESP32-WROOM-32 DevKit** board, powered by a USB cable (ESP32-S3/C3 boards have different UART pin mapping; adapt if needed)
- 1 × **R307/AS608 TTL UART fingerprint sensor** with pinout confirmed from its own datasheet
- 1 × **SN7408, SN74LS08, or SN74HCT08** 14-pin DIP AND-gate IC, powered from regulated **5 V** (see variant below)
- 1 × NPN transistor **2N2222** or **BC547** for isolating AND-gate output from the 3.3 V ESP32 input
- 1 × NPN transistor **2N2222** or equivalent for switching an **active 5 V buzzer**
- 1 × green LED, 1 × red LED, each with its own **330 Ω** series resistor
- 1 × active 5 V buzzer of low current draw, compatible with the selected transistor, and a flyback diode if it is an inductive buzzer
- Resistors: **4.7 kΩ** for AND output transistor base, **22 kΩ** from its collector to 3.3 V, **1 kΩ** for buzzer transistor base; **10 kΩ × 2** as AND input pull-downs
- A breadboard, jumper wires, and a 100 nF ceramic decoupling capacitor across the 7408 VCC/GND pins

## 1. ESP32 → fingerprint scanner

| Fingerprint module (check printed labels) | ESP32 DevKit | Notes |
|---|---|---|
| `VCC` / `+5V` | Regulated 5 V supply | Common R307 models require 4.2–6 V **power**; verify your exact sensor manual |
| `GND` | GND | Must share a common ground with ESP32 |
| `TX` | GPIO16 (`RX2`) **through safe level shifting if TX is 5 V** | Never feed unknown 5 V output directly to ESP32; measure or check module datasheet |
| `RX` | GPIO17 (`TX2`) | ESP32 provides 3.3 V UART logic; confirm module supports it |

A labelled R307 module commonly supports 3.3 V or 5 V MCU **logic**, while its **power** is frequently specified as 4.2–6 V. Some clones differ. If your R307 TX swings to 5 V, use a suitable UART level shifter (5 V → 3.3 V), or a divider designed for UART at 57600 baud. Do **not** assume the wire color indicates the signal.

## 2. Classic SN7408 / SN74LS08 / SN74HCT08 AND gate at 5 V

The IC notch/dot determines its orientation; count pins counterclockwise viewed from the top. **Do not wire before checking the IC's printed full part number.**

| IC pin | Wire to | Purpose |
|---|---|---|
| **14** | Regulated **5 V** | 7408 supply |
| **7** | **GND** | Shared ground |
| **1** (`1A`) | ESP32 **GPIO25** + separate **10 kΩ** resistor to GND | Input A: face match **and other demo policy checks** |
| **2** (`1B`) | ESP32 **GPIO26** + separate **10 kΩ** resistor to GND | Input B: fingerprint match |
| **3** (`1Y`) | **4.7 kΩ** → base of 2N2222/BC547 **Q1** | Real physical gate output Y |
| **4, 5, 9, 10, 12, 13** | GND | Tie unused gate inputs LOW; do not leave floating |
| **6, 8, 11** | Not connected | Unused gate outputs |

Place a **100 nF** capacitor close to pins 14 and 7. ESP32 outputs HIGH at **3.3 V**, which is accepted by typical **SN7408/SN74LS08/SN74HCT08** TTL-compatible inputs powered at 5 V. **SN74HC08 at 5 V is different**: it has CMOS thresholds and is *not* guaranteed to recognize 3.3 V as HIGH.

### Q1 gate-output-to-ESP32 level-safe interface (important)

- 7408 **pin 3** → **4.7 kΩ** resistor → **Q1 base**.
- Q1 **emitter** → **GND**.
- Q1 **collector** → ESP32 **GPIO27**.
- **22 kΩ pull-up** between Q1 collector/GPIO27 and ESP32 **3.3 V** (not 5 V).
- In `config.h`, set `#define AND_GATE_OUTPUT_INVERTED 1` (default).

The Q1 transistor inverts the 7408 output. Gate output HIGH turns Q1 ON, pulling GPIO27 LOW; gate output LOW turns Q1 OFF, so the 22 kΩ pull-up makes GPIO27 HIGH. **The ESP32 never receives a 5 V gate output.**

Check the exact **E-B-C pin arrangement** for your transistor manufacturer; 2N2222/PN2222/BC547 pinouts differ. Correct polarity and emitter are critical.

### If the chip says exactly `74HC08` (without T)

Instead of the 5 V circuit above, power the **74HC08 from 3.3 V** (pin 14), use the same shared GND, connect inputs pins 1 and 2 to GPIO25/26, and connect **pin 3 directly to GPIO27**. **Omit Q1 and the 4.7 kΩ/22 kΩ resistors** and set `#define AND_GATE_OUTPUT_INVERTED 0`. Refer to its specific datasheet to confirm 3.3 V operation. *Never* connect a 5 V HC08 output directly to an ESP32 pin.

## 3. Green LED, red LED and active buzzer

| Output | Wiring |
|---|---|
| Green LED | ESP32 **GPIO18** → **330 Ω** → **green LED anode (+)**; LED cathode (-) → GND |
| Red LED | ESP32 **GPIO19** → **330 Ω** → **red LED anode (+)**; LED cathode (-) → GND |
| Active 5 V buzzer | 5 V → buzzer **+**; buzzer **-** → **Q2 collector**; Q2 emitter → GND; ESP32 **GPIO23** → **1 kΩ** → Q2 base |

Use an **active buzzer** that sounds when DC power is applied (not a passive piezo sounder). For magnetic/inductive buzzer types, put an appropriate flyback diode across its terminals (**cathode to +5 V**). Do not drive a buzzer or another high-current load directly from an ESP32 pin. If all modules combined exceed the USB/board regulator supply capacity, provide a separately regulated 5 V supply and connect grounds; **do not apply external 5 V to the 3V3 pin**.

## 4. Required truth table and timer

| Face + policy (A) | Fingerprint (B) | Physical 7408 Y=A AND B | ESP32 indication |
|---:|---:|---:|---|
| 0 | 0 | 0 | **Red + pulsed buzzer for 10 seconds** |
| 0 | 1 | 0 | **Red + pulsed buzzer for 10 seconds** |
| 1 | 0 | 0 | **Red + pulsed buzzer for 10 seconds** |
| 1 | 1 | 1 | **Green for 10 seconds**, buzzer silent |

When the 10 seconds end, **both 7408 inputs, both LEDs and the buzzer go LOW/OFF**. GPIO25 and GPIO26 have external pull-down resistors to keep both inputs LOW during MCU startup. If measured 7408 output does not agree with the truth table, the firmware fails closed to red+buzzer and reports `AND_GATE_MISMATCH` to the website.

**Caveat:** On the website `A` is the face match AND owner approval, associated vehicle and expiry-date policy. This ensures the LED never turns green for a person whose face+fingerprint match but who lacks the additional demonstration approval.

## 5. Power-on and acceptance checklist

1. With power disconnected, review all 5 V and 3.3 V connections, IC orientation, transistor pinouts, and LED polarities.
2. Use USB to power the ESP32 and an adequately rated 5 V rail for the 7408, fingerprint sensor, and active buzzer.
3. Upload the ESP32 sketch. Open Serial Monitor at **115200 baud**; expect `R307/AS608 sensor: READY`.
4. Register the ESP32 on the website's **Setup guide**; put the device ID and key into `config.h` (do not publish that file).
5. Open the site's **Enrollment** panel, capture face samples in the browser, and enrol the same person's fingerprint twice on the physical R307.
6. On **Verification**, try matching face + matching fingerprint: expect A=1, B=1, Y=1, green 10 s.
7. Try a different fingerprint with a matching face: A=1, B=0, Y=0, red+buzzer 10 s.
8. Try a different face with matching fingerprint: A=0, B=1, Y=0, red+buzzer 10 s.
9. Test timeout/unplugged sensor: no approval; website reports sensor offline/failure. Disconnecting Wi-Fi must not keep an LED active.

### Sources for component variant checks

- TI SN7408 family data: https://www.ti.com/lit/ds/symlink/sn7408.pdf (confirm part marking)
- Nexperia 74HC08/HCT08: https://www.nexperia.com/products/analog-logic-ics/logic/gates/and-gates/serie/74hc08-74hct08/
- R307 reference module manual: https://manuals.plus/m/2f85c3d14c4a4d4057eea04b2b3fb71466869f6a2a0cd1722467b396ee726e6f
- ESP32 hardware specification: https://documentation.espressif.com/esp32_datasheet_en.html
