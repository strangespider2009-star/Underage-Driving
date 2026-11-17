import test from 'node:test';
import assert from 'node:assert/strict';
import { BLE_NAME, BLE_SERVICE, BLE_RX, BLE_TX,
  encodeBleCommand, parseBleResponse, bleSupported, bleConnected } from '../src/device.js';

test('BLE uses stable Nordic UART service and device name', () => {
  assert.equal(BLE_NAME, 'LOGIX-BLE');
  assert.equal(BLE_SERVICE, '6e400001-b5a3-f393-e0a9-e50e24dcca9e');
  assert.equal(BLE_RX, '6e400002-b5a3-f393-e0a9-e50e24dcca9e');
  assert.equal(BLE_TX, '6e400003-b5a3-f393-e0a9-e50e24dcca9e');
});
test('each combination encodes as a nine-byte BLE packet', () => {
  for (const [a,b] of [[0,0],[0,1],[1,0],[1,1]]) {
    const data = encodeBleCommand('A1B2C3', a, b);
    assert.equal(data, 'DA1B2C3'+a+b);
    assert.equal(new TextEncoder().encode(data).length, 9);
  }
});
test('bad nonces and nonbinary inputs are refused', () => {
  assert.throws(() => encodeBleCommand('bad',1,1));
  assert.throws(() => encodeBleCommand('FFFFFF',1,2));
  assert.throws(() => encodeBleCommand('FFFFFF',true,1));
});
test('BLE device replies are parsed without guessing', () => {
  assert.deepEqual(parseBleResponse('RA1B2C31P'),
    { nonce: 'A1B2C3', gateHigh: true, status: 'P' });
  assert.deepEqual(parseBleResponse('RA1B2C30D'),
    { nonce: 'A1B2C3', gateHigh: false, status: 'D' });
  assert.deepEqual(parseBleResponse('RA1B2C31F'),
    { nonce: 'A1B2C3', gateHigh: true, status: 'F' });
});
test('malformed BLE responses cannot produce fake success', () => {
  for (const input of ['RA1B2C30P','RA1B2C31D','RA1B2C31X','RBAD1P','DA1B2C311','']) {
    assert.equal(parseBleResponse(input), null);
  }
});
test('Web Bluetooth is not considered present in plain Node.js', () => {
  assert.equal(bleSupported(), false);
  assert.equal(bleConnected(), false);
});
test('physical AND logic has exactly one high output', () => {
  for (const [a,b,y] of [[0,0,0],[0,1,0],[1,0,0],[1,1,1]])
    assert.equal(Number(Boolean(a&&b)),y);
});
