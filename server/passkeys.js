import crypto from 'node:crypto';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server';
import { readStore, writeStore } from './store.js';

const CHALLENGE_AGE_MS = 5 * 60 * 1000;
export const PROOF_AGE_MS = 90 * 1000;

// Bind all WebAuthn checks to the actual deployed HTTPS origin.
// Render supplies RENDER_EXTERNAL_HOSTNAME; custom domains can set PUBLIC_ORIGIN.
export function webauthnOrigin() {
  const raw = process.env.PUBLIC_ORIGIN ||
    (process.env.RENDER_EXTERNAL_HOSTNAME ? 'https://' + process.env.RENDER_EXTERNAL_HOSTNAME : 'http://localhost:3001');
  const url = new URL(raw);
  if ((url.protocol !== 'https:' && url.hostname !== 'localhost') || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_ORIGIN must be a clean HTTPS origin (or localhost for development).');
  }
  return { origin: url.origin, rpID: url.hostname };
}

export function validPasskeyProof(db, { id, ownerId, driverId, sessionId }, now = Date.now()) {
  if (typeof id !== 'string' || !id) return null;
  return (db.passkeyProofs || []).find(p =>
    p.id === id && p.ownerId === ownerId && p.driverId === driverId &&
    p.sessionId === sessionId && !p.used &&
    Number.isFinite(Date.parse(p.at)) &&
    now >= Date.parse(p.at) && now - Date.parse(p.at) <= PROOF_AGE_MS
  ) || null;
}

function findDriver(req, db) {
  return db.drivers.find(d => d.id === req.params.driverId && d.ownerId === req.demoUser.id);
}
function credentials(db, req) {
  return (db.passkeys || []).filter(p => p.ownerId === req.demoUser.id && p.driverId === req.params.driverId);
}
function sendOptions(req, res, next, purpose, driverId, options) {
  req.session.passkeyChallenge = {
    purpose, driverId, ownerId: req.demoUser.id,
    challenge: options.challenge, expires: Date.now() + CHALLENGE_AGE_MS
  };
  req.session.save(err => err ? next(err) : res.json({ options }));
}
async function consumeChallenge(req, purpose) {
  const pending = req.session.passkeyChallenge;
  delete req.session.passkeyChallenge;
  await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
  if (!pending || pending.purpose !== purpose || pending.driverId !== req.params.driverId ||
      pending.ownerId !== req.demoUser.id || Date.now() > pending.expires) {
    throw new Error('Passkey challenge missing, expired, or belongs to a different driver. Try again.');
  }
  return pending.challenge;
}

export function installPasskeyRoutes(app, auth, errors) {
  app.post('/api/passkeys/:driverId/register/options', auth, async (req, res, next) => {
    try {
      const db = readStore();
      const driver = findDriver(req, db);
      if (!driver) return errors(res, 404, 'Driver not found.');
      if (credentials(db, req).length) return errors(res, 409, 'A passkey is already enrolled for this driver. Remove it before re-enrolling.');
      const { rpID } = webauthnOrigin();
      const options = await generateRegistrationOptions({
        rpName: 'Underage Driving LED Demo', rpID,
        userID: new Uint8Array(crypto.createHash('sha256').update(driver.id).digest()),
        userName: driver.name + ' (' + driver.id.slice(0, 8) + ')',
        userDisplayName: driver.name,
        attestationType: 'none',
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
        supportedAlgorithmIDs: [-7, -257]
      });
      sendOptions(req, res, next, 'register', driver.id, options);
    } catch (err) { next(err); }
  });

  app.post('/api/passkeys/:driverId/register/verify', auth, async (req, res, next) => {
    try {
      const challenge = await consumeChallenge(req, 'register');
      const db = readStore();
      const driver = findDriver(req, db);
      if (!driver) return errors(res, 404, 'Driver not found.');
      if (credentials(db, req).length) return errors(res, 409, 'Passkey already enrolled.');
      const { origin, rpID } = webauthnOrigin();
      let verified;
      try {
        verified = await verifyRegistrationResponse({
          response: req.body?.response, expectedChallenge: challenge,
          expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true
        });
      } catch {
        return errors(res, 400, 'Phone passkey registration was not verified. Try again.');
      }
      if (!verified.verified || !verified.registrationInfo?.credential) {
        return errors(res, 400, 'Phone passkey registration failed.');
      }
      const cred = verified.registrationInfo.credential;
      if ((db.passkeys || []).some(p => p.id === cred.id)) {
        return errors(res, 409, 'This passkey is already registered.');
      }
      db.passkeys.push({
        id: cred.id, ownerId: req.demoUser.id, driverId: driver.id,
        publicKey: Buffer.from(cred.publicKey).toString('base64url'),
        counter: cred.counter, transports: cred.transports || [],
        createdAt: new Date().toISOString()
      });
      writeStore(db);
      res.json({ verified: true, enrolled: true });
    } catch (err) { next(err); }
  });

  app.post('/api/passkeys/:driverId/authenticate/options', auth, async (req, res, next) => {
    try {
      const db = readStore();
      if (!findDriver(req, db)) return errors(res, 404, 'Driver not found.');
      const saved = credentials(db, req);
      if (!saved.length) return errors(res, 400, 'Enroll this driver’s phone passkey first.');
      const { rpID } = webauthnOrigin();
      const options = await generateAuthenticationOptions({
        rpID, userVerification: 'required',
        allowCredentials: saved.map(p => ({ id: p.id, transports: p.transports }))
      });
      sendOptions(req, res, next, 'authenticate', req.params.driverId, options);
    } catch (err) { next(err); }
  });

  app.post('/api/passkeys/:driverId/authenticate/verify', auth, async (req, res, next) => {
    try {
      const challenge = await consumeChallenge(req, 'authenticate');
      const db = readStore();
      if (!findDriver(req, db)) return errors(res, 404, 'Driver not found.');
      const record = credentials(db, req).find(p => p.id === req.body?.response?.id);
      if (!record) return errors(res, 400, 'The passkey does not belong to this driver.');
      const { origin, rpID } = webauthnOrigin();
      let result;
      try {
        result = await verifyAuthenticationResponse({
          response: req.body?.response, expectedChallenge: challenge,
          expectedOrigin: origin, expectedRPID: rpID,
          requireUserVerification: true,
          credential: {
            id: record.id, publicKey: new Uint8Array(Buffer.from(record.publicKey, 'base64url')),
            counter: record.counter, transports: record.transports
          }
        });
      } catch {
        return errors(res, 400, 'The phone did not verify the registered passkey.');
      }
      if (!result.verified) return errors(res, 400, 'Passkey verification failed.');
      record.counter = result.authenticationInfo.newCounter;
      const proof = {
        id: crypto.randomUUID(), ownerId: req.demoUser.id,
        driverId: req.params.driverId, sessionId: req.sessionID,
        at: new Date().toISOString(), used: false
      };
      db.passkeyProofs.push(proof);
      db.passkeyProofs = db.passkeyProofs.slice(-300);
      writeStore(db);
      res.json({ verified: true, proofId: proof.id });
    } catch (err) { next(err); }
  });

  app.delete('/api/passkeys/:driverId', auth, (req, res) => {
    const db = readStore();
    if (!findDriver(req, db)) return errors(res, 404, 'Driver not found.');
    db.passkeys = (db.passkeys || []).filter(p =>
      !(p.ownerId === req.demoUser.id && p.driverId === req.params.driverId));
    db.passkeyProofs = (db.passkeyProofs || []).filter(p =>
      !(p.ownerId === req.demoUser.id && p.driverId === req.params.driverId));
    writeStore(db);
    res.json({ ok: true });
  });
}
