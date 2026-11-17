import crypto from 'node:crypto';

export const ONLINE_WINDOW_MS = 18000;
export const JOB_TTL_MS = 100000;
const isHexId = v => typeof v === 'string' && /^[0-9a-f-]{16,60}$/.test(v);
export const hashKey = key => crypto.createHash('sha256').update(String(key)).digest('hex');
export const newDeviceKey = () => crypto.randomBytes(32).toString('hex');
export const publicDevice = device => ({
  id: device.id, name: device.name, lastSeenAt: device.lastSeenAt || null
  online: Boolean(device.lastSeenAt && Date.now() - Date.parse(device.lastSeenAt) < ONLINE_WINDOW_MS)
});
export function authenticateDevice(db, id, key) {
  if (!isHexId(id) || typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key)) return null;
  const device = db.devices.find(d => d.id === id);
  if (!device) return null;
  const given = Buffer.from(hashKey(key), 'hex');
  const stored = Buffer.from(device.keyHash, 'hex');
  return given.length === stored.length && crypto.timingSafeEqual(given, stored) ? device : null;
}
export function markExpired(db, now = Date.now()) {
  for (const job of db.jobs) {
    if (['queued', 'running'].includes(job.status) && now - Date.parse(job.createdAt) > JOB_TTL_MS) {
      job.status = 'error'; job.error = 'DEVICE_TIMEOUT'; job.completedAt = new Date(now).toISOString();
    }
  }
}
export function queueJob(db, { ownerId, deviceId, driverId = null, type, a = null, b = null }) {
  markExpired(db);
  if (type !== 'DECIDE' || ![0, 1].includes(a) || ![0, 1].includes(b)) throw new Error('Invalid AND-gate job.');
  const device = db.devices.find(d => d.ownerId === ownerId && d.id === deviceId);
  if (!device) throw new Error('Device not found.');
  if (!publicDevice(device).online) throw new Error('ESP32 is offline. Check its Wi-Fi and firmware.');
  if (db.jobs.some(j => j.deviceId === deviceId && ['queued', 'running'].includes(j.status))) {
    throw new Error('ESP32 is busy with another operation.');
  }
  const job = {
    id: crypto.randomUUID(), ownerId, deviceId, driverId, type, a, b,
    createdAt: new Date().toISOString(), status: 'queued', success: null, error: null,
    completedAt: null, gateHigh: null, usedForDecision: false
  };
  db.jobs.push(job);
  db.jobs = db.jobs.slice(-500);
  return job;
}
export function publicJob(job) {
  return {
    id: job.id, type: job.type, status: job.status, success: job.success,
    reason: job.error, gateHigh: job.gateHigh, createdAt: job.createdAt,
    completedAt: job.completedAt
  };
}
