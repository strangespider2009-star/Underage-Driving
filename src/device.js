// Web Bluetooth transport for the low-voltage LOGIX ESP32 AND-gate demo.
// Nordic UART Service compatible UUIDs, with a deliberately tiny packet format.
// Web Bluetooth works in supported HTTPS browsers (e.g. Android Chrome).
// This is NOT secure control hardware: BLE writes can be spoofed by nearby clients.
export const BLE_NAME = 'LOGIX-BLE';
export const BLE_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const BLE_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const BLE_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

let device = null;
let writeChar = null;
let notifyChar = null;
let pending = null;
let statusListener = () => {};

export function bleSupported() {
  return typeof navigator !== 'undefined' && Boolean(navigator.bluetooth) &&
    (typeof window === 'undefined' || window.isSecureContext);
}

export function bleConnected() {
  return Boolean(device?.gatt?.connected && writeChar && notifyChar);
}

function clearPending(message) {
  if (!pending) return;
  const job = pending;
  pending = null;
  clearTimeout(job.timer);
  job.reject(new Error(message));
}

function disconnected() {
  clearPending('BLE disconnected. Reconnect to ESP32 and try again.');
  writeChar = null;
  notifyChar = null;
  device = null;
  statusListener(false);
}

function onNotification(event) {
  if (!pending) return;
  const view = event.target.value;
  if (!view) return;
  const text = new TextDecoder().decode(view);
  const found = /^R([0-9A-F]{6})([01])([PDF])$/.exec(text);
  if (!found || found[1] !== pending.nonce) return;
  const job = pending;
  pending = null;
  clearTimeout(job.timer);
  const gateHigh = found[2] === '1';
  const status = found[3]; // P = approved, D = denied, F = faulty/mismatched 7408.
  if ((status === 'P' && !gateHigh) || (status === 'D' && gateHigh)) {
    job.reject(new Error('ESP32 returned inconsistent hardware feedback.'));
    return;
  }
  job.resolve({ gateHigh, status, fault: status === 'F' });
}

export async function connectBle(onStatus = () => {}) {
  statusListener = onStatus;
  if (!bleSupported()) {
    throw new Error('Web Bluetooth is unavailable. Use Android Chrome over HTTPS; ordinary Android WebView APKs and iPhone Safari do not provide this API.');
  }
  if (bleConnected()) return { name: device.name || BLE_NAME };
  // requestDevice must execute inside a real user click handler.
  const chosen = await navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: BLE_NAME }],
    optionalServices: [BLE_SERVICE]
  });
  chosen.addEventListener('gattserverdisconnected', disconnected);
  try {
    const server = await chosen.gatt.connect();
    const service = await server.getPrimaryService(BLE_SERVICE);
    const rx = await service.getCharacteristic(BLE_RX);
    const tx = await service.getCharacteristic(BLE_TX);
    await tx.startNotifications();
    tx.addEventListener('characteristicvaluechanged', onNotification);
    device = chosen;
    writeChar = rx;
    notifyChar = tx;
    statusListener(true);
    return { name: chosen.name || BLE_NAME };
  } catch (err) {
    chosen.gatt?.disconnect();
    disconnected();
    throw err;
  }
}

export function disconnectBle() {
  if (device?.gatt?.connected) device.gatt.disconnect();
  disconnected();
}

// Payload: D + 6 hex nonce + A bit + B bit (9 bytes).
// ESP32 notification: R + nonce + measured output + P|D|F (9 bytes).
export async function sendBleDecision(a, b, timeoutMs = 6500) {
  if (!bleConnected()) throw new Error('Connect to LOGIX-BLE before evaluating the 7408.');
  if (![0, 1].includes(a) || ![0, 1].includes(b)) throw new Error('Inputs A/B must be 0 or 1.');
  if (pending) throw new Error('ESP32 already has a pending BLE decision.');
  const random = new Uint8Array(3);
  crypto.getRandomValues(random);
  const nonce = [...random].map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
  const packet = new TextEncoder().encode('D' + nonce + a + b);
  const reply = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      clearPending('ESP32 did not acknowledge BLE decision. Check range and the GATT notifications.');
    }, timeoutMs);
    pending = { nonce, resolve, reject, timer };
  });
  try {
    await writeChar.writeValueWithResponse(packet);
  } catch (err) {
    clearPending('Could not send BLE data: ' + err.message);
  }
  return reply;
}
