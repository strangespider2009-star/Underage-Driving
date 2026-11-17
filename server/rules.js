// Pure rules for the classroom LED demonstration. Browser results are not secure proof.
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function evaluateDemoAccess({ driver, vehicle, faceMatched, passkeyMatched }, now = new Date()) {
  const exists = Boolean(driver && vehicle && driver.vehicleId === vehicle.id);
  const licenceValid = exists && validDate(driver.licenceExpiry) &&
    driver.licenceExpiry >= now.toISOString().slice(0, 10);
  const approved = exists && driver.approved === true;
  const passkeyEnrolled = exists && driver.passkeyEnrolled === true;
  const face = faceMatched === true;
  const passkey = passkeyMatched === true && passkeyEnrolled;
  const checks = { correctVehicle: exists, faceMatched: face, passkeyMatched: passkey, licenceValid, ownerApproved: approved };
  return { ...checks, checks, accessGranted: Object.values(checks).every(Boolean) };
}

