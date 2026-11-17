import test from 'node:test';
import assert from 'node:assert/strict';
import { validPasskeyProof, webauthnOrigin } from '../server/passkeys.js';

const now = Date.parse('2026-11-17T15:00:00.000Z');
const proof = { id: 'proof1', ownerId: 'owner1', driverId: 'driver1', sessionId: 'session1',
  at: new Date(now - 2000).toISOString(), used: false };
const context = { id: 'proof1', ownerId: 'owner1', driverId: 'driver1', sessionId: 'session1' };
test('a fresh server-issued proof works for the same owner, driver, and browser session', () => {
  assert.equal(validPasskeyProof({ passkeyProofs: [proof] }, context, now), proof);
});
test('a proof cannot be used by another driver or browser session', () => {
  assert.equal(validPasskeyProof({ passkeyProofs: [proof] }, { ...context, driverId: 'other' }, now), null);
  assert.equal(validPasskeyProof({ passkeyProofs: [proof] }, { ...context, sessionId: 'other' }, now), null);
  assert.equal(validPasskeyProof({ passkeyProofs: [proof] }, { ...context, ownerId: 'other' }, now), null);
});
test('proofs expire, cannot be reused, and cannot come from future timestamps', () => {
  assert.equal(validPasskeyProof({ passkeyProofs: [proof] }, context, now + 100000), null);
  assert.equal(validPasskeyProof({ passkeyProofs: [{ ...proof, used: true }] }, context, now), null);
  assert.equal(validPasskeyProof({ passkeyProofs: [{ ...proof, at: new Date(now + 100).toISOString() }] }, context, now), null);
});
test('missing or arbitrary browser pass flags cannot stand in for signed WebAuthn proof', () => {
  assert.equal(validPasskeyProof({ passkeyProofs: [proof] }, { ...context, id: null }, now), null);
  assert.equal(validPasskeyProof({ passkeyProofs: [proof] }, { ...context, id: 'madeup' }, now), null);
});
test('localhost WebAuthn RP defaults to localhost in development', () => {
  if (!process.env.PUBLIC_ORIGIN && !process.env.RENDER_EXTERNAL_HOSTNAME)
    assert.deepEqual(webauthnOrigin(), { origin: 'http://localhost:3001', rpID: 'localhost' });
});
