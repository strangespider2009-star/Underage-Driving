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
    events: db.events.filter(x => x.ownerId === ownerId).slice(-80).reverse().map(({ sessionId, ...event }) => event)
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
// Render verifies identity, but the phone transports demo bits to ESP32 over BLE.
// A report from the browser is NOT independently authenticated by the hardware.
app.post('/api/access/check', auth, (req, res) => {
  const db = readStore(); const ownerId = req.demoUser.id;
  const driver = db.drivers.find(d => d.id === req.body?.driverId && d.ownerId === ownerId);
  const vehicle = db.vehicles.find(v => v.id === req.body?.vehicleId && v.ownerId === ownerId);
  if (!driver || !vehicle) return errors(res, 404, 'Select a valid driver and vehicle.');

  // Input B is backed by an unused, server-verified WebAuthn proof, never
  // by a claimed match flag from JavaScript.
  const proofId = req.body?.passkeyProofId;
  const proof = proofId ? validPasskeyProof(db, {
    id: proofId, ownerId, driverId: driver.id, sessionId: req.sessionID
  }) : null;
  if (proofId && !proof) return errors(res, 400, 'Passkey verification expired or was already used. Verify again.');

  const passkeyEnrolled = (db.passkeys || []).some(p => p.ownerId === ownerId && p.driverId === driver.id);
  const faceMatched = req.body?.faceMatched === true;
  const passkeyMatched = Boolean(proof && passkeyEnrolled);
  const decision = evaluateDemoAccess({ driver: { ...driver, passkeyEnrolled }, vehicle, faceMatched, passkeyMatched });
  const policyPassed = decision.checks.correctVehicle && decision.checks.licenceValid && decision.checks.ownerApproved;
  const a = Number(faceMatched && policyPassed);
  const b = Number(passkeyMatched);
  if (proof) proof.used = true;

  const event = {
    id: makeId(), ownerId, sessionId: req.sessionID, at: new Date().toISOString(),
    driverName: driver.name, vehicleName: vehicle.name,
    ...decision.checks, accessGranted: decision.accessGranted,
    hardwareInputA: a, hardwareInputB: b,
    bleStatus: 'pending', gateHigh: null
  };
  db.events.push(event); db.events = db.events.slice(-3000);
  writeStore(db);
  res.json({
    decision,
    event: { ...event, sessionId: undefined },
    command: { a, b },
    warning: 'LED-only demo. Browser sends BLE bits; the returned hardware report is not an authenticated device attestation.'
  });
});

// The browser reports ESP32 BLE GATT notification results to the demo log.
// This is not a secure physical-device attestation; never use for real access.
app.post('/api/access/report', auth, (req, res) => {
  const db = readStore();
  const event = db.events.find(e => e.id === req.body?.eventId && e.ownerId === req.demoUser.id && e.sessionId === req.sessionID);
  if (!event) return errors(res, 404, 'Demo event not found.');
  if (event.bleStatus !== 'pending') return errors(res, 409, 'Event already reported.');
  if (Date.now() - Date.parse(event.at) > 45000) return errors(res, 409, 'BLE report window expired.');
  const status = req.body?.status;
  if (!['P', 'D', 'F', 'N'].includes(status)) return errors(res, 400, 'Invalid BLE response status.');
  const output = req.body?.gateHigh;
  const expected = Boolean(event.hardwareInputA && event.hardwareInputB);
  if (status === 'N') {
    if (output !== null) return errors(res, 400, 'A missing BLE reply must not claim a gate reading.');
  } else {
    if (typeof output !== 'boolean') return errors(res, 400, 'BLE report must include measured gate bit.');
    if ((status === 'P' && (!output || !expected)) ||
        (status === 'D' && (output || expected)) ||
        (status === 'F' && output === expected)) {
      return errors(res, 400, 'Inconsistent BLE gate report.');
    }
  }
  event.bleStatus = status;
  event.gateHigh = status === 'N' ? null : output;
  event.hardwareReportedAt = new Date().toISOString();
  writeStore(db);
  res.json({ ok: true, status: event.bleStatus });
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
