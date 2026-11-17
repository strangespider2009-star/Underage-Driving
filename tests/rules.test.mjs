import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDemoAccess, validDate } from '../server/rules.js';
const vehicle = { id: 'v1' };
const driver = { vehicleId: 'v1', approved: true, passkeyEnrolled: true, licenceExpiry: '2099-12-31' };
const evaluate = changes => evaluateDemoAccess({ driver, vehicle, faceMatched: true, passkeyMatched: true, ...changes }, new Date('2026-11-15T00:00:00Z'));
test('all checks required for demo approval', () => assert.equal(evaluate({}).accessGranted, true));
test('wrong face must fail', () => assert.equal(evaluate({ faceMatched: false }).accessGranted, false));
test('wrong passkey must fail', () => assert.equal(evaluate({ passkeyMatched: false }).accessGranted, false));
test('no passkey enrollment must fail', () => assert.equal(evaluate({ driver: { ...driver, passkeyEnrolled: false } }).accessGranted, false));
test('unapproved driver must fail', () => assert.equal(evaluate({ driver: { ...driver, approved: false } }).accessGranted, false));
test('expired licence must fail', () => assert.equal(evaluate({ driver: { ...driver, licenceExpiry: '2024-01-01' } }).accessGranted, false));
test('different vehicle must fail', () => assert.equal(evaluate({ driver: { ...driver, vehicleId: 'v2' } }).accessGranted, false));
test('date validation', () => {
  assert.equal(validDate('2026-02-29'), false);
  assert.equal(validDate('2028-02-29'), true);
});
