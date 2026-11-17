import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { post } from './api.js';

export function passkeySupported() {
  return window.isSecureContext && Boolean(window.PublicKeyCredential && navigator.credentials);
}

function checkSupport() {
  if (!passkeySupported()) {
    throw new Error('Phone passkeys require HTTPS and a supported browser. Open this site in Chrome or Safari on the phone.');
  }
}

// Passkeys use the phone's system verification prompt. The website never
// reads the fingerprint; some phones offer face or screen-lock PIN instead.
export async function enrollPhonePasskey(driverId) {
  checkSupport();
  const path = '/api/passkeys/' + encodeURIComponent(driverId);
  const { options } = await post(path + '/register/options', {});
  const response = await startRegistration({ optionsJSON: options });
  const verified = await post(path + '/register/verify', { response });
  if (!verified.verified) throw new Error('Passkey registration was not verified by the server.');
  return verified;
}

export async function verifyPhonePasskey(driverId) {
  checkSupport();
  const path = '/api/passkeys/' + encodeURIComponent(driverId);
  const { options } = await post(path + '/authenticate/options', {});
  const response = await startAuthentication({ optionsJSON: options });
  const verified = await post(path + '/authenticate/verify', { response });
  if (!verified.verified || !verified.proofId) throw new Error('Passkey verification was not accepted.');
  return verified;
}
