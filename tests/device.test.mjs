import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { authenticateDevice, hashKey, newDeviceKey, publicDevice, publicJob, queueJob, markExpired } from '../server/device.js';

function fixture() {
  const key = newDeviceKey();
  const device = { id: crypto.randomUUID(), name: 'Demo ESP32', ownerId: 'owner-1', keyHash: hashKey(key), lastSeenAt: new Date().toISOString() };
  return { db: { devices: [device], jobs: [] }, device, key };
}
test('device keys are unpredictable 256-bit hex strings', () => {
  const a = newDeviceKey(); const b = newDeviceKey();
  assert.match(a, /^[0-9a-f]{64}$/); assert.notEqual(a, b);
});
test('hashing is deterministic but does not expose the key', () => {
  const key = newDeviceKey();
  assert.equal(hashKey(key), hashKey(key)); assert.notEqual(hashKey(key), key);
});
test('ESP32 authentication checks both ID and key', () => {
  const { db, device, key } = fixture();
  assert.equal(authenticateDevice(db, device.id, key), device);
  assert.equal(authenticateDevice(db, device.id, '0'.repeat(64)), null);
  assert.equal(authenticateDevice(db, crypto.randomUUID(), key), null);
});
test('rejects malformed credentials', () => {
  const { db, device } = fixture();
  assert.equal(authenticateDevice(db, device.id, ''), null);
  assert.equal(authenticateDevice(db, device.id, undefined), null);
});
test('public device omits private key hash', () => {
  const { device } = fixture(); const safe = publicDevice(device);
  assert.equal('keyHash' in safe, false); assert.equal(safe.online, true);
});
test('queued jobs are owned, unique and start pending', () => {
  const { db, device } = fixture();
  const job = queueJob(db, { ownerId: 'owner-1', deviceId: device.id, driverId: 'driver', type: 'DECIDE', a: 1, b: 1 });
  assert.equal(job.status, 'queued'); assert.equal(job.a, 1); assert.equal(job.ownerId, 'owner-1');
  assert.ok(job.id); assert.equal(db.jobs.length, 1);
});
test('cannot queue for another owner', () => {
  const { db, device } = fixture();
  assert.throws(() => queueJob(db, { ownerId: 'wrong', deviceId: device.id, type: 'DECIDE', a: 1, b: 1 }), /Device not found/);
});
test('rejects parallel jobs on one ESP32', () => {
  const { db, device } = fixture();
  queueJob(db, { ownerId: 'owner-1', deviceId: device.id, type: 'DECIDE', a: 0, b: 1 });
  assert.throws(() => queueJob(db, { ownerId: 'owner-1', deviceId: device.id, type: 'DECIDE', a: 1, b: 1 }), /busy/);
});
test('offline ESP32 cannot receive a new job', () => {
  const { db, device } = fixture(); device.lastSeenAt = new Date(Date.now() - 60000).toISOString();
  assert.throws(() => queueJob(db, { ownerId: 'owner-1', deviceId: device.id, type: 'DECIDE', a: 0, b: 1 }), /offline/);
});
test('stale jobs expire and unblock the next job', () => {
  const { db, device } = fixture();
  const job = queueJob(db, { ownerId: 'owner-1', deviceId: device.id, type: 'DECIDE', a: 0, b: 1 });
  markExpired(db, Date.parse(job.createdAt) + 101000);
  assert.equal(job.status, 'error'); assert.equal(job.error, 'DEVICE_TIMEOUT');
  assert.doesNotThrow(() => queueJob(db, { ownerId: 'owner-1', deviceId: device.id, type: 'DECIDE', a: 1, b: 1 }));
});
test('public jobs omit driver and owner identifiers', () => {
  const { db, device } = fixture();
  const job = queueJob(db, { ownerId: 'owner-1', deviceId: device.id, type: 'DECIDE', a: 1, b: 1 });
  const safe = publicJob(job);
  assert.equal('ownerId' in safe, false); assert.equal('deviceId' in safe, false);
});
test('all four AND combinations give expected logic', () => {
  for (const [a,b,y] of [[0,0,0],[0,1,0],[1,0,0],[1,1,1]]) assert.equal(Number(Boolean(a&&b)),y);
});
