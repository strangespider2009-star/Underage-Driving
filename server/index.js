import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readStore, writeStore, makeId } from './store.js';
import { evaluateDemoAccess, validDate } from './rules.js';
import { installPasskeyRoutes, validPasskeyProof } from './passkeys.js';
import { authenticateDevice, hashKey, newDeviceKey, publicDevice, publicJob, queueJob, markExpired } from './device.js';

const app = express();
const production = process.env.NODE_ENV === 'production';
const secret = process.env.SESSION_SECRET || (production ? '' : 'local-development-only');
if (production && secret.length < 24) throw new Error('Set a long SESSION_SECRET (24+ characters) in production.');
app.disable('x-powered-by');
if (production) app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));
app.use(session({
  name: 'sdg.demo.sid', secret, resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, secure: production, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 }
}));

const errors = (res, code, message) => res.status(code).json({ error: message });
const publicUser = ({ id, name, email }) => ({ id, name, email });
const normalized = value => typeof value === 'string' ? value.trim() : '';
function userFor(req) {
  if (!req.session.userId) return null;
  return readStore().users.find(u => u.id === req.session.userId) || null;
}
function auth(req, res, next) {
  const user = userFor(req);
  if (!user) return errors(res, 401, 'Please sign in.');
  req.demoUser = user;
  next();
}
const saveSession = (req, res, body, status = 200) => req.session.save(err => {
  if (err) return errors(res, 500, 'Could not save session.');
  res.status(status).json(body);
});

installPasskeyRoutes(app, auth, errors);

app.get('/api/health', (_req, res) => res.json({ ok: true, mode: 'LED demonstration only' }));
app.get('/api/me', (req, res) => {
  const user = userFor(req);
  res.json({ user: user ? publicUser(user) : null });
});
app.post('/api/auth/register', async (req, res, next) => {
  try {
    const name = normalized(req.body?.name).slice(0, 80);
    const email = normalized(req.body?.email).toLowerCase();
    const password = req.body?.password;
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || password.length < 8 || password.length > 200)
      return errors(res, 400, 'Enter a name, valid email, and password of 8–200 characters.');
    const db = readStore();
    if (db.users.some(u => u.email === email)) return errors(res, 409, 'Email already registered.');
    const user = { id: makeId(), name, email, passwordHash: await bcrypt.hash(password, 12) };
    db.users.push(user); writeStore(db);
    req.session.userId = user.id;
    saveSession(req, res, { user: publicUser(user) }, 201);
  } catch (err) { next(err); }
});
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const db = readStore();
    const user = db.users.find(u => u.email === normalized(req.body?.email).toLowerCase());
    const password = req.body?.password;
    if (!user || typeof password !== 'string' || !(await bcrypt.compare(password, user.passwordHash)))
      return errors(res, 401, 'Incorrect email or password.');
    req.session.userId = user.id;
    saveSession(req, res, { user: publicUser(user) });
  } catch (err) { next(err); }
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(err => {
  if (err) return errors(res, 500, 'Could not log out.');
  res.clearCookie('sdg.demo.sid', { httpOnly: true, secure: production, sameSite: 'lax' });
  res.json({ ok: true });
}));

app.get('/api/dashboard', auth, (req, res) => {
  const db = readStore(); const ownerId = req.demoUser.id;
  res.json({
    vehicles: db.vehicles.filter(x => x.ownerId === ownerId),
    drivers: db.drivers.filter(x => x.ownerId === ownerId).map(d => ({ ...d, passkeyEnrolled: (db.passkeys || []).some(p => p.ownerId === ownerId && p.driverId === d.id) })),
    events: db.events.filter(x => x.ownerId === ownerId).slice(-80).reverse()
  });
});
app.post('/api/vehicles', auth, (req, res) => {
  const name = normalized(req.body?.name).slice(0, 100);
  const plate = normalized(req.body?.plate).slice(0, 32);
  if (!name) return errors(res, 400, 'Vehicle name is required.');
  const db = readStore();
  const vehicle = { id: makeId(), ownerId: req.demoUser.id, name, plate };
  db.vehicles.push(vehicle); writeStore(db); res.status(201).json({ vehicle });
});
app.delete('/api/vehicles/:id', auth, (req, res) => {
  const db = readStore();
  if (db.drivers.some(d => d.ownerId === req.demoUser.id && d.vehicleId === req.params.id))
    return errors(res, 409, 'Remove drivers associated with this vehicle first.');
  const before = db.vehicles.length;
  db.vehicles = db.vehicles.filter(v => !(v.id === req.params.id && v.ownerId === req.demoUser.id));
  if (db.vehicles.length === before) return errors(res, 404, 'Vehicle not found.');
  writeStore(db); res.json({ ok: true });
});
app.post('/api/drivers', auth, (req, res) => {
  const name = normalized(req.body?.name).slice(0, 100);
  const licenceExpiry = normalized(req.body?.licenceExpiry);
  const vehicleId = normalized(req.body?.vehicleId);
  if (!name || !validDate(licenceExpiry))
    return errors(res, 400, 'Enter a driver name and a valid test expiry date.');
  const db = readStore();
  if (!db.vehicles.some(v => v.id === vehicleId && v.ownerId === req.demoUser.id))
    return errors(res, 400, 'Select one of your vehicles.');
  const driver = { id: makeId(), ownerId: req.demoUser.id, name, licenceExpiry, vehicleId, approved: false, createdAt: new Date().toISOString() };
  db.drivers.push(driver); writeStore(db); res.status(201).json({ driver });
});
app.patch('/api/drivers/:id/approval', auth, (req, res) => {
  if (typeof req.body?.approved !== 'boolean') return errors(res, 400, 'approved must be boolean.');
  const db = readStore();
  const driver = db.drivers.find(d => d.id === req.params.id && d.ownerId === req.demoUser.id);
  if (!driver) return errors(res, 404, 'Driver not found.');
  driver.approved = req.body.approved; writeStore(db); res.json({ driver });
});
app.delete('/api/drivers/:id', auth, (req, res) => {
  const db = readStore(); const before = db.drivers.length;
  db.drivers = db.drivers.filter(d => !(d.id === req.params.id && d.ownerId === req.demoUser.id));
  if (before === db.drivers.length) return errors(res, 404, 'Driver not found.');
  db.passkeys = (db.passkeys || []).filter(p => !(p.ownerId === req.demoUser.id && p.driverId === req.params.id));
  db.passkeyProofs = (db.passkeyProofs || []).filter(p => !(p.ownerId === req.demoUser.id && p.driverId === req.params.id));
  writeStore(db); res.json({ ok: true });
});
// Owners provision their own ESP32. Its secret is shown only at registration or rotation.
app.get('/api/devices', auth, (req, res) => {
  const db = readStore();
  res.json({ devices: db.devices.filter(d => d.ownerId === req.demoUser.id).map(publicDevice) });
});
app.post('/api/devices', auth, (req, res) => {
  const db = readStore();
  if (db.devices.filter(d => d.ownerId === req.demoUser.id).length >= 3)
    return errors(res, 400, 'Maximum of three classroom devices per account.');
  const name = normalized(req.body?.name).slice(0, 60) || 'LOGIX ESP32';
  const key = newDeviceKey();
  const device = { id: makeId(), ownerId: req.demoUser.id, name, keyHash: hashKey(key), lastSeenAt: null };
  db.devices.push(device); writeStore(db);
  res.status(201).json({ device: publicDevice(device), deviceKey: key });
});
app.post('/api/devices/:id/rotate-key', auth, (req, res) => {
  const db = readStore();
  const device = db.devices.find(d => d.id === req.params.id && d.ownerId === req.demoUser.id);
  if (!device) return errors(res, 404, 'Device not found.');
  const key = newDeviceKey();
  device.keyHash = hashKey(key); device.lastSeenAt = null;
  for (const job of db.jobs.filter(j => j.deviceId === device.id && ['queued', 'running'].includes(j.status))) {
    job.status = 'error'; job.error = 'KEY_ROTATED';
  }
  writeStore(db); res.json({ device: publicDevice(device), deviceKey: key });
});
app.delete('/api/devices/:id', auth, (req, res) => {
  const db = readStore();
  const before = db.devices.length;
  db.devices = db.devices.filter(d => !(d.id === req.params.id && d.ownerId === req.demoUser.id));
  if (db.devices.length === before) return errors(res, 404, 'Device not found.');
  db.jobs = db.jobs.filter(j => j.deviceId !== req.params.id);
  writeStore(db); res.json({ ok: true });
});
// Only physical 7408 DECIDE jobs are queued after passkey verification.
app.get('/api/device/jobs/:id', auth, (req, res) => {
  const db = readStore();
  markExpired(db); writeStore(db);
  const job = db.jobs.find(j => j.id === req.params.id && j.ownerId === req.demoUser.id);
  if (!job) return errors(res, 404, 'Device job not found.');
  res.json({ job: publicJob(job) });
});

// ESP32 authenticates using its unique device ID and secret, not the owner's browser cookie.
function deviceRequest(req, res, next) {
  const db = readStore();
  const device = authenticateDevice(db, req.get('X-Device-Id'), req.get('X-Device-Key'));
  if (!device) return errors(res, 401, 'Unrecognized ESP32 credentials.');
  req.device = device; req.deviceDb = db; next();
}
app.get('/api/esp32/job', deviceRequest, (req, res) => {
  const db = req.deviceDb; markExpired(db);
  const device = req.device;
  device.lastSeenAt = new Date().toISOString();
  let job = db.jobs.find(j => j.deviceId === device.id && j.status === 'running');
  // Never issue a second job until the first one is acknowledged or times out.
  if (!job) {
    job = db.jobs.find(j => j.deviceId === device.id && j.status === 'queued');
    if (job) { job.status = 'running'; job.startedAt = new Date().toISOString(); }
  } else job = null;
  writeStore(db);
  res.json({ job: job ? { id: job.id, type: job.type, slot: job.slot, a: job.a, b: job.b } : null });
});
app.post('/api/esp32/result', deviceRequest, (req, res) => {
  const db = req.deviceDb;
  const job = db.jobs.find(j => j.id === req.body?.jobId && j.deviceId === req.device.id);
  if (!job) return errors(res, 404, 'Job not found.');
  if (['done', 'error'].includes(job.status)) return res.json({ ok: true, duplicate: true });
  if (job.status !== 'running') return errors(res, 409, 'Job not started.');
  if (typeof req.body?.success !== 'boolean') return errors(res, 400, 'Missing success boolean.');
  const reason = normalized(req.body?.reason).slice(0, 48).replace(/[^a-zA-Z0-9_ -]/g, '');
  job.success = req.body.success;
  job.error = req.body.success ? null : reason || 'SENSOR_FAILED';
  job.gateHigh = job.type === 'DECIDE' && typeof req.body?.gateHigh === 'boolean' ? req.body.gateHigh : null;
  if (job.type === 'DECIDE') {
    const expected = job.a === 1 && job.b === 1;
    if (job.gateHigh !== expected) { job.success = false; job.error = 'AND_GATE_MISMATCH'; }
  }
  job.status = 'done'; job.completedAt = new Date().toISOString();
  writeStore(db); res.json({ ok: true });
});

app.post('/api/access/check', auth, (req, res) => {
  const db = readStore(); const ownerId = req.demoUser.id;
  const driver = db.drivers.find(d => d.id === req.body?.driverId && d.ownerId === ownerId);
  const vehicle = db.vehicles.find(v => v.id === req.body?.vehicleId && v.ownerId === ownerId);
  if (!driver || !vehicle) return errors(res, 404, 'Select a valid driver and vehicle.');

  // Only an unused, recent, server-verified WebAuthn assertion makes input B HIGH.
  const proofId = req.body?.passkeyProofId;
  const proof = proofId ? validPasskeyProof(db, {
    id: proofId, ownerId, driverId: driver.id, sessionId: req.sessionID
  }) : null;
  if (proofId && !proof) return errors(res, 400, 'Passkey verification expired or already used. Verify again.');

  const passkeyEnrolled = (db.passkeys || []).some(p => p.ownerId === ownerId && p.driverId === driver.id);
  const faceMatched = req.body?.faceMatched === true;
  const passkeyMatched = Boolean(proof && passkeyEnrolled);
  const decision = evaluateDemoAccess({ driver: { ...driver, passkeyEnrolled }, vehicle, faceMatched, passkeyMatched });
  const policyPassed = decision.checks.correctVehicle && decision.checks.licenceValid && decision.checks.ownerApproved;
  const a = faceMatched && policyPassed ? 1 : 0;
  const b = passkeyMatched ? 1 : 0;
  let job;
  try {
    job = queueJob(db, { ownerId, deviceId: req.body?.deviceId, driverId: driver.id, type: 'DECIDE', a, b });
  } catch (err) { return errors(res, 409, err.message); }
  if (proof) proof.used = true;
  const event = {
    id: makeId(), ownerId, at: new Date().toISOString(),
    driverName: driver.name, vehicleName: vehicle.name,
    ...decision.checks, accessGranted: decision.accessGranted,
    deviceJobId: job.id, hardwareInputA: a, hardwareInputB: b
  };
  db.events.push(event); db.events = db.events.slice(-3000);
  writeStore(db);
  res.json({ decision, event, job: publicJob(job),
    warning: 'LED-only classroom demo. Phone passkeys can use biometric or PIN; camera face results are browser-side.' });
});

app.use('/api', (_req, res) => errors(res, 404, 'API endpoint not found.'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.use((err, _req, res, _next) => {
  console.error(err); errors(res, 500, 'An unexpected server error occurred. Check server logs.');
});
const port = Number(process.env.PORT || 3001);
app.listen(port, '0.0.0.0', () => console.log(`SMART DRIVE GUARD listening on :${port} (LED demo only)`));
