import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, post, patch, del } from './api.js';
import { startCamera, stopCamera, enrollFace, verifyFace, hasFace, deleteFace } from './face.js';
import { getDevices, registerDevice, runFingerprint, waitForJob } from './device.js';

const NAV = [
  ['overview', 'Overview', '▦'], ['vehicles', 'Vehicles', '▤'],
  ['drivers', 'Drivers', '♙'], ['enroll', 'Enrollment', '◉'],
  ['verify', 'Verification', '◎'], ['history', 'Access history', '◷'],
  ['setup', 'Setup guide', '⚙']
];
function Status({ state, children }) {
  const type = state === 'passed' || state === 'enrolled' || state === 'connected' ? 'ok' :
    state === 'failed' || state === 'disconnected' ? 'error' : 'neutral';
  return <span className={`status ${type}`}><span className="dot" />{children || state}</span>;
}
function Message({ value, kind = 'info' }) { return value ? <div className={`message ${kind}`} role="status">{value}</div> : null; }
function Action({ children, busy, ...props }) { return <button type="button" className="primary" disabled={busy || props.disabled} {...props}>{busy ? 'Working…' : children}</button>; }
function Metric({ icon, number, label }) { return <div className="metric"><span>{icon}</span><strong>{number}</strong><small>{label}</small></div>; }

function Auth({ onAuth }) {
  const [register, setRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await post(register ? '/api/auth/register' : '/api/auth/login', { name, email, password });
      onAuth(result.user);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <div className="authWrap"><div className="authIntro"><div className="brandBadge">UD</div><p className="eyebrow">BIOMETRIC DEMONSTRATION PLATFORM</p><h1>SMART<br />DRIVE GUARD<span className="accent">.</span></h1><p>Face identity matching + dedicated fingerprint sensor verification, using ESP32 Wi-Fi, a real 7408 AND gate, LEDs, and a buzzer.</p><div className="demoNote">EDUCATIONAL LED DEMO ONLY · NOT VEHICLE CONTROL</div></div><form className="authBox" onSubmit={submit}><span className="eyebrow">OWNER PORTAL</span><h2>{register ? 'Create demo account' : 'Welcome back'}</h2><p className="muted">{register ? 'Set up an owner profile to manage test vehicles and drivers.' : 'Sign in to continue your demonstration.'}</p>{register && <label>Full name<input value={name} onChange={e => setName(e.target.value)} required maxLength="80" autoComplete="name" /></label>}<label>Email address<input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" /></label><label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={register ? 8 : 1} autoComplete={register ? 'new-password' : 'current-password'} /></label><Message value={error} kind="error" /><button disabled={busy} className="primary wide" type="submit">{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</button><button type="button" className="linkButton" onClick={() => { setRegister(!register); setError(''); }}>{register ? 'Already registered? Sign in' : 'New here? Create demo account'}</button><small className="muted">This project is an educational demonstration, not a secure vehicle-access product.</small></form></div>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState('overview');
  const [data, setData] = useState({ vehicles: [], drivers: [], events: [] });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [provision, setProvision] = useState(null);
  const [fingerprintJobId, setFingerprintJobId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [faceState, setFaceState] = useState('pending');
  const [fpState, setFpState] = useState('pending');
  const [cameraOn, setCameraOn] = useState(false);
  const [faceFeedback, setFaceFeedback] = useState('');
  const [verificationResult, setVerificationResult] = useState(null);
  const [progress, setProgress] = useState('');
  const [vehicleName, setVehicleName] = useState('');
  const [plate, setPlate] = useState('');
  const [driverName, setDriverName] = useState('');
  const [newVehicleId, setNewVehicleId] = useState('');
  const [licenceExpiry, setLicenceExpiry] = useState('');
  const [slot, setSlot] = useState(1);
  const videoRef = useRef(null);
  const activeCameraRef = useRef(null);
  const selected = data.drivers.find(d => d.id === driverId) || null;
  const vehicle = selected ? data.vehicles.find(v => v.id === selected.vehicleId) : null;
  const device = devices.find(d => d.id === deviceId) || null;
  const connected = Boolean(device?.online && device?.sensorReady);
  const faceEnrolled = Boolean(user && selected && hasFace(user.id, selected.id));
  const facePassed = faceState === 'passed';
  const fingerprintPassed = fpState === 'passed';
  const canEvaluate = connected && !!selected && ['passed', 'failed'].includes(faceState) && ['passed', 'failed'].includes(fpState) && !!fingerprintJobId && !busy;
  const selectableSlots = useMemo(() => {
    const used = new Set(data.drivers.map(d => d.fingerprintSlot));
    return Array.from({ length: 127 }, (_, i) => i + 1).filter(s => !used.has(s));
  }, [data.drivers]);
  useEffect(() => {
    if (selectableSlots.length && !selectableSlots.includes(Number(slot))) setSlot(selectableSlots[0]);
  }, [selectableSlots, slot]);

  async function refresh() {
    const next = await api('/api/dashboard');
    setData(next);
    setDriverId(old => next.drivers.some(d => d.id === old) ? old : next.drivers[0]?.id || '');
    setNewVehicleId(old => next.vehicles.some(v => v.id === old) ? old : next.vehicles[0]?.id || '');
  }
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const me = await api('/api/me');
        if (!active) return;
        setUser(me.user);
        if (me.user) {
          const next = await api('/api/dashboard');
          if (!active) return;
          setData(next);
          setDriverId(next.drivers[0]?.id || '');
          setNewVehicleId(next.vehicles[0]?.id || '');
        }
      } catch (e) { if (active) setError(e.message); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    // Switching between enrollment and verification creates a new <video> element.
    // Always stop the stream attached to the previous element.
    stopCamera(activeCameraRef.current); activeCameraRef.current = null; setCameraOn(false);
  }, [page]);
  useEffect(() => () => { stopCamera(activeCameraRef.current); }, []);
  useEffect(() => {
    if (!user) return;
    let active = true;
    async function poll() {
      try {
        const { devices: items } = await getDevices();
        if (active) {
          setDevices(items);
          setDeviceId(old => items.some(d => d.id === old) ? old : items[0]?.id || '');
        }
      } catch { /* A temporary network outage is reflected on the next poll. */ }
    }
    void poll();
    const ticker = setInterval(() => void poll(), 5000);
    return () => { active = false; clearInterval(ticker); };
  }, [user?.id]);

  async function run(fn, successMessage = '') {
    setError(''); setNotice(''); setBusy('task');
    try {
      await fn();
      if (successMessage) setNotice(successMessage);
    } catch (e) { setError(e.message || 'Something went wrong.'); }
    finally { setBusy(''); }
  }
  function resetEvidence() {
    setFaceState('pending'); setFpState('pending'); setVerificationResult(null); setFaceFeedback(''); setProgress('');
    cameraStop();
    setFingerprintJobId('');
  }
  function chooseDriver(id) { resetEvidence(); setDriverId(id); }
  async function createEsp32() {
    await run(async () => {
      const created = await registerDevice('LOGIX ESP32');
      setProvision({ deviceId: created.device.id, deviceKey: created.deviceKey, serverUrl: window.location.origin });
      const { devices: items } = await getDevices();
      setDevices(items); setDeviceId(created.device.id);
      setNotice('ESP32 registered. Copy its configuration below, upload firmware, and power it on.');
    });
  }
  async function cameraStart() {
    await run(async () => {
      await startCamera(videoRef.current); activeCameraRef.current = videoRef.current; setCameraOn(true);
    }, 'Camera ready. Keep exactly one consenting person in view.');
  }
  function cameraStop() { stopCamera(activeCameraRef.current || videoRef.current); activeCameraRef.current = null; setCameraOn(false); }
  async function saveFace() {
    if (!selected) return setError('Choose a driver.');
    await run(async () => {
      setProgress('Capturing face samples…');
      await enrollFace(videoRef.current, user.id, selected.id, (i, n) => setProgress(`Capturing face sample ${i}/${n}`));
      setFaceState('pending'); setVerificationResult(null);
      setNotice(`Face enrolled for ${selected.name} in this browser only.`);
    });
    setProgress('');
    cameraStop();
  }
  async function matchFace() {
    if (!selected) return setError('Choose a driver.');
    await run(async () => {
      setFaceState('checking'); setProgress('Checking face identity…');
      let result;
      result = await verifyFace(videoRef.current, user.id, selected.id, (i, n) => setProgress(`Comparing sample ${i}/${n}`));
      setFaceState(result.matched ? 'passed' : 'failed');
      setFaceFeedback(`Distance ${result.distance} · required ≤ ${result.threshold}`);
      setVerificationResult(null);
      if (!result.matched) { setError('FACE MISMATCH — This does not match the enrolled face. Complete the fingerprint check and evaluate for the 10-second red LED + buzzer.'); }
      else setNotice(`Face matched the enrolled template for ${selected.name}.`);
    });
    setProgress(''); cameraStop();
    // Any camera or model error must be a failure, never a passing result.
    setFaceState(current => current === 'checking' ? 'failed' : current);
  }
  async function saveFingerprint() {
    if (!selected) return setError('Choose a driver first.');
    if (!connected) return setError('ESP32 is offline or the fingerprint sensor is missing. Check Wi-Fi, device setup, and sensor wiring.');
    if (!window.confirm(`Enrol a consenting user's fingerprint in sensor slot ${selected.fingerprintSlot}? This overwrites that slot if it already contains a print.`)) return;
    await run(async () => {
      setProgress('Place finger, remove when prompted, then place same finger again. Watch sensor LED.');
      const job = await runFingerprint({ type: 'ENROLL', deviceId, driverId: selected.id, onProgress: setProgress });
      if (!job.success) throw new Error(`Enrollment failed: ${job.reason || 'fingerprint sensor error'}`);
      await refresh(); setFpState('pending'); setVerificationResult(null);
      setNotice(`Fingerprint enrolled in the sensor's memory at slot ${selected.fingerprintSlot}.`);
    });
    setProgress('');
  }
  async function checkFingerprint() {
    if (!selected) return setError('Choose a driver first.');
    if (!connected) return setError('ESP32 is offline or the fingerprint sensor is missing. Check Wi-Fi, device setup, and sensor wiring.');
    await run(async () => {
      setFpState('checking'); setProgress('Place the enrolled finger on the sensor…');
      const job = await runFingerprint({ type: 'VERIFY', deviceId, driverId: selected.id, onProgress: setProgress });
      setFingerprintJobId(job.id);
      setFpState(job.success ? 'passed' : 'failed'); setVerificationResult(null);
      if (job.success) setNotice(`Fingerprint matched sensor slot ${selected.fingerprintSlot}.`);
      else setError(`FINGERPRINT MISMATCH — ${job.reason || 'not enrolled person'}. Evaluate for red LED and buzzer.`);
    });
    setProgress(''); setFpState(current => current === 'checking' ? 'failed' : current);
  }
  async function removeFingerprint() {
    if (!selected || !connected) return setError('Select a driver and connect ESP32 over Wi-Fi first.');
    if (!window.confirm(`Delete fingerprint slot ${selected.fingerprintSlot} from the physical sensor?`)) return;
    await run(async () => {
      const job = await runFingerprint({ type: 'DELETE', deviceId, driverId: selected.id, onProgress: setProgress });
      if (!job.success) throw new Error(`Deletion failed: ${job.reason || 'sensor error'}`);
      await refresh(); setFpState('pending'); setVerificationResult(null);
    }, 'Fingerprint template deleted from the physical sensor.');
  }
  async function evaluate() {
    if (!selected) return setError('Select a driver.');
    if (!connected) return setError('ESP32 must be online to run the physical 7408 AND gate.');
    await run(async () => {
      const response = await post('/api/access/check', {
        driverId: selected.id, vehicleId: selected.vehicleId,
        faceMatched: facePassed, fingerprintJobId, deviceId
      });
      setVerificationResult({ ...response.decision,
        hardwareInputA: response.event.hardwareInputA,
        hardwareInputB: response.event.hardwareInputB,
        gateHigh: null });
      setProgress('ESP32 is testing the physical 7408 AND gate…');
      const job = await waitForJob(response.job.id, 25000, setProgress);
      setProgress('');
      if (!job.success) throw new Error(`7408 hardware check failed: ${job.reason || 'unknown error'}`);
      setVerificationResult({ ...response.decision,
        hardwareInputA: response.event.hardwareInputA,
        hardwareInputB: response.event.hardwareInputB,
        gateHigh: job.gateHigh });
      await refresh();
      setFingerprintJobId(''); // One fingerprint scan authorizes one demo decision.
      setNotice(job.gateHigh ? '7408 OUTPUT = 1 · GREEN LED ON FOR 10 SECONDS' : '7408 OUTPUT = 0 · RED LED + BUZZER ON FOR 10 SECONDS');
    });
  }
  async function logout() {
    await run(async () => {
      cameraStop(); await post('/api/auth/logout', {});
      setUser(null); setData({ vehicles: [], drivers: [], events: [] }); setDevices([]); setProvision(null); setPage('overview');
    });
  }
  if (loading) return <div className="loading">Loading UNDERAGE DRIVING…</div>;
  if (!user) return <Auth onAuth={u => { setUser(u); void refresh().catch(e => setError(e.message)); }} />;

  return <div className="shell">
    <aside className="sidebar">
      <div className="logoLine"><div className="logo">UD</div><div><b>UNDERAGE</b><small>DRIVING / DEMO</small></div></div>
      <div className="navLabel">WORKSPACE</div>
      <nav>{NAV.map(([id, title, symbol]) => <button key={id} type="button" disabled={!!busy} className={page === id ? 'nav active' : 'nav'} onClick={() => { setPage(id); setError(''); setNotice(''); }}><span>{symbol}</span>{title}</button>)}</nav>
      <div className="sidebarFooter"><div className="hardwareLine"><span className={`tinyLight ${connected ? 'green' : 'red'}`} /> ESP32: {connected ? 'ONLINE' : 'OFFLINE'}</div><div className="noticeSmall">LED-only exhibition prototype. No real vehicle controls.</div><button className="sidebarSignout" type="button" onClick={logout}>↪ Sign out</button></div>
    </aside>
    <main className="main">
      <header className="topbar"><div><span className="eyebrow">UNDERAGE DRIVING · ESP32</span><h1>{NAV.find(x => x[0] === page)?.[1]}</h1></div><div className="topRight"><span className="demoPill">CLASSROOM DEMO</span><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span></div></header>
      <Message value={error} kind="error" /><Message value={notice} kind="success" />
      {page === 'overview' && <>
        <section className="hero"><div><span className="eyebrow">SECURE ACCESS · EDUCATIONAL PROTOTYPE</span><h2>Two-stage biometric demonstration</h2><p>Compare an enrolled person's face, then verify a fingerprint stored inside a physical sensor. Show final approved / rejected results on two LEDs.</p><button className="primary" type="button" onClick={() => setPage('verify')}>Open verification ↗</button></div><div className="heroArt"><div className="ring ring1"/><div className="ring ring2"/><div className="ring ring3"/><span>◎</span></div></section>
        <div className="metrics"><Metric icon="▤" number={data.vehicles.length} label="Vehicles" /><Metric icon="♙" number={data.drivers.length} label="Drivers" /><Metric icon="◉" number={data.drivers.filter(d => d.fingerprintEnrolled).length} label="Sensor enrollments" /><Metric icon="◷" number={data.events.length} label="Recent checks" /></div>
        <section className="panel"><h3>How the demonstration works</h3><div className="stepsGrid"><div><b>01 · Driver record</b><p>Create a vehicle and a driver with a dedicated fingerprint slot.</p></div><div><b>02 · Enrolment</b><p>Enrol face in this browser and fingerprint inside the sensor.</p></div><div><b>03 · Verification</b><p>Verify face + fingerprint; require approval and a valid demo licence date.</p></div><div><b>04 · 7408 hardware logic</b><p>ESP32 sends A/B into the physical AND gate; green or red + buzzer runs for 10 seconds.</p></div></div></section>
      </>}
      {page === 'vehicles' && <div className="gridTwo"><section className="panel"><h3>Add vehicle</h3><p className="muted">Use demonstration data only.</p><form onSubmit={e => { e.preventDefault(); void run(async () => { await post('/api/vehicles', { name: vehicleName, plate }); await refresh(); setVehicleName(''); setPlate(''); }, 'Vehicle added.'); }}><label>Vehicle name<input value={vehicleName} onChange={e => setVehicleName(e.target.value)} placeholder="Project demo car" required maxLength="100" /></label><label>Registration label (optional)<input value={plate} onChange={e => setPlate(e.target.value)} placeholder="DEMO-001" maxLength="32" /></label><button className="primary" type="submit" disabled={!!busy}>Save vehicle</button></form></section><section className="panel"><h3>Your vehicles</h3>{!data.vehicles.length && <p className="muted">No vehicles yet.</p>}{data.vehicles.map(v => <div className="entry" key={v.id}><div><b>{v.name}</b><small>{v.plate || 'No label'}</small></div><button className="subtle" type="button" disabled={!!busy} onClick={() => void run(async () => { await del(`/api/vehicles/${v.id}`); await refresh(); }, 'Vehicle removed.')}>Remove</button></div>)}</section></div>}
      {page === 'drivers' && <div className="gridTwo"><section className="panel"><h3>Add authorized test driver</h3><p className="muted">Each driver gets a unique storage slot on a single physical fingerprint sensor (1–127).</p><form onSubmit={e => { e.preventDefault(); void run(async () => { await post('/api/drivers', { name: driverName, vehicleId: newVehicleId, licenceExpiry, fingerprintSlot: Number(slot) }); await refresh(); setDriverName(''); }, 'Driver record added.'); }}><label>Name<input required value={driverName} onChange={e => setDriverName(e.target.value)} placeholder="Demo driver" maxLength="100" /></label><label>Assigned vehicle<select required value={newVehicleId} onChange={e => setNewVehicleId(e.target.value)}><option value="">Select a vehicle</option>{data.vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label><label>Test licence expiry<input required type="date" value={licenceExpiry} onChange={e => setLicenceExpiry(e.target.value)} /></label><label>Fingerprint sensor slot<select value={slot} onChange={e => setSlot(Number(e.target.value))}>{selectableSlots.map(s => <option key={s} value={s}>{s}</option>)}</select></label><button disabled={!!busy || !data.vehicles.length || !selectableSlots.length} className="primary" type="submit">Add driver</button></form></section><section className="panel"><h3>Driver approvals</h3>{!data.drivers.length && <p className="muted">Add a vehicle, then a driver.</p>}{data.drivers.map(d => <div className="driverCard" key={d.id}><div className="entry"><div><b>{d.name}</b><small>Sensor slot {d.fingerprintSlot} · Expiry {d.licenceExpiry}</small></div><Status state={d.approved ? 'passed' : 'pending'}>{d.approved ? 'APPROVED' : 'PENDING'}</Status></div><small className="muted">Fingerprint: {d.fingerprintEnrolled ? 'enrolled in sensor' : 'not enrolled'}</small><div className="inlineActions"><button type="button" className="secondary" disabled={!!busy} onClick={() => void run(async () => { await patch(`/api/drivers/${d.id}/approval`, { approved: !d.approved }); await refresh(); }, d.approved ? 'Driver approval removed.' : 'Driver approved.')}>{d.approved ? 'Revoke approval' : 'Approve driver'}</button><button type="button" className="subtle" disabled={!!busy} onClick={() => { if (!window.confirm('Remove the driver record? Delete the hardware sensor fingerprint first from Enrollment.')) return; void run(async () => { await del(`/api/drivers/${d.id}`); if (user) deleteFace(user.id, d.id); await refresh(); resetEvidence(); }, 'Driver removed (sensor slot not deleted).'); }}>Remove record</button></div></div>)}</section></div>}
      {(page === 'enroll' || page === 'verify') && <>
        <section className="panel controlsPanel"><div><h3>ESP32 Wi-Fi device</h3><p className="muted">No Bluetooth pairing needed. ESP32 checks this server for commands over HTTPS. The R307 sensor connects directly to the ESP32.</p></div><div className="inlineActions"><Status state={connected ? 'connected' : 'disconnected'}>{connected ? 'ESP32 + SENSOR ONLINE' : device?.online ? 'SENSOR MISSING' : 'ESP32 OFFLINE'}</Status>{devices.length > 1 && <select aria-label="ESP32 device" value={deviceId} onChange={e => { setDeviceId(e.target.value); resetEvidence(); }}>{devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}<button className="secondary" type="button" onClick={() => setPage('setup')}>{devices.length ? 'Device setup' : 'Register ESP32'}</button></div></section>
        <section className="panel driverSelector"><label>Selected driver<select value={driverId} disabled={!!busy} onChange={e => chooseDriver(e.target.value)}><option value="">Select driver</option>{data.drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label><div><small>Assigned vehicle</small><b>{vehicle?.name || 'None'}</b></div><div><small>Sensor slot</small><b>{selected?.fingerprintSlot ?? '—'}</b></div><div><small>Owner status</small><Status state={selected?.approved ? 'passed' : 'pending'}>{selected?.approved ? 'Approved' : 'Not approved'}</Status></div></section>
        {!data.drivers.length && <Message value="Create a vehicle and a driver first, then enrol biometrics." />}
        <div className="gridTwo verificationGrid"><section className="panel"><div className="sectionHead"><div><span className="stepNumber">01</span><h3>Facial identity match</h3></div><Status state={faceState}>{faceState === 'passed' ? 'MATCH' : faceState === 'failed' ? 'NO MATCH' : faceState === 'checking' ? 'CHECKING' : 'PENDING'}</Status></div><p className="muted">Compares a real 128-number face descriptor against this driver's locally enrolled template. A different face should be rejected; this is not liveness detection.</p><video className="video" ref={videoRef} autoPlay muted playsInline style={{ display: cameraOn ? 'block' : 'none' }} /><div className={cameraOn ? 'cameraHint hidden' : 'cameraHint'}>▣<span>Camera preview not active</span></div><small className="muted">Local face template: {faceEnrolled ? 'ENROLLED' : 'NOT ENROLLED'}</small><div className="inlineActions"><button type="button" className="secondary" disabled={!!busy || cameraOn || !selected} onClick={cameraStart}>Start camera</button><button type="button" className="subtle" disabled={!!busy || !cameraOn} onClick={cameraStop}>Stop camera</button></div><div className="inlineActions">{page === 'enroll' ? <><Action busy={!!busy} disabled={!cameraOn || !selected} onClick={saveFace}>Enrol face</Action><button className="subtle danger" type="button" disabled={!!busy || !faceEnrolled} onClick={() => { deleteFace(user.id, selected.id); resetEvidence(); setNotice('Local face template deleted.'); }}>Delete face</button></> : <Action busy={!!busy} disabled={!cameraOn || !selected || !faceEnrolled} onClick={matchFace}>Verify face</Action>}</div>{faceFeedback && <p className="codeText">{faceFeedback}</p>}</section>
        <section className="panel"><div className="sectionHead"><div><span className="stepNumber">02</span><h3>Optical fingerprint sensor</h3></div><Status state={fpState}>{fpState === 'passed' ? 'MATCH' : fpState === 'failed' ? 'NO MATCH' : fpState === 'checking' ? 'CHECKING' : 'PENDING'}</Status></div><p className="muted">Genuine fingerprint enrollment and matching occur on the R307/AS608 sensor via ESP32 UART. No raw fingerprint is sent to the website.</p><div className="fingerIcon">◉</div><div className="statLine"><span>Assigned slot</span><b>{selected?.fingerprintSlot ?? '—'}</b></div><div className="statLine"><span>Enrolment</span><Status state={selected?.fingerprintEnrolled ? 'enrolled' : 'pending'}>{selected?.fingerprintEnrolled ? 'ENROLLED' : 'NOT ENROLLED'}</Status></div>{page === 'enroll' ? <div className="inlineActions"><Action busy={!!busy} disabled={!connected || !selected} onClick={saveFingerprint}>Enrol fingerprint</Action><button type="button" className="subtle danger" disabled={!!busy || !selected?.fingerprintEnrolled || !connected} onClick={removeFingerprint}>Delete print</button></div> : <Action busy={!!busy} disabled={!connected || !selected?.fingerprintEnrolled} onClick={checkFingerprint}>Verify fingerprint</Action>}<small className="muted">Fingerprint enrollment requires two captures of the same finger. After both tests, the 7408 AND result controls a 10-second LED + buzzer demonstration.</small></section></div>
        {progress && <Message value={progress} />}
        {page === 'verify' && <section className="panel resultPanel"><div><h3>Final two-factor demo decision</h3><p className="muted">ESP32 drives face/policy bit A and fingerprint bit B into the real 7408 AND gate. The measured gate output controls green for 10 seconds if 1, otherwise red plus buzzer for 10 seconds. Additional owner/date checks can force input A low. This is an educational demo.</p></div><div className="inlineActions"><Action disabled={!canEvaluate} busy={!!busy} onClick={evaluate}>Evaluate physical 7408 gate</Action><button className="secondary" disabled={!!busy} type="button" onClick={() => { resetEvidence(); setNotice('Verification reset. ESP32 automatically ends any active LED window after 10 seconds.'); }}>Reset</button></div>{verificationResult && <div className={`decision ${verificationResult.accessGranted ? 'approve' : 'deny'}`}><b>{verificationResult.accessGranted ? '✓ DEMO APPROVED' : '✕ DEMO REJECTED'}</b><p className="codeText">7408 inputs: A={verificationResult.hardwareInputA} · B={verificationResult.hardwareInputB} · AND output={verificationResult.gateHigh == null ? 'checking…' : Number(verificationResult.gateHigh)}</p><div className="checks">{Object.entries(verificationResult.checks).map(([k, val]) => <span key={k}>{val ? '✓' : '✕'} {k.replace(/([A-Z])/g, ' $1')}</span>)}</div></div>}</section>}
        <section className="panel"><h3>ESP32 device status</h3><p className="muted">{device ? `${device.name} · ${device.online ? 'online' : 'offline'} · Fingerprint sensor ${device.sensorReady ? 'ready' : 'not detected'} · Last contact: ${device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : 'never'}` : 'Register an ESP32 under Setup guide.'}</p></section>
      </>}
      {page === 'history' && <section className="panel"><h3>Last 80 demo checks</h3>{!data.events.length ? <p className="muted">No checks recorded yet.</p> : <div className="historyTable"><table><thead><tr><th>Time</th><th>Driver</th><th>Vehicle</th><th>Face</th><th>Fingerprint</th><th>Decision</th></tr></thead><tbody>{data.events.map(e => <tr key={e.id}><td>{new Date(e.at).toLocaleString()}</td><td>{e.driverName}</td><td>{e.vehicleName}</td><td>{e.faceMatched ? 'Pass' : 'Fail'}</td><td>{e.fingerprintMatched ? 'Pass' : 'Fail'}</td><td><Status state={e.accessGranted ? 'passed' : 'failed'}>{e.accessGranted ? 'APPROVED' : 'DENIED'}</Status></td></tr>)}</tbody></table></div>}</section>}
      {page === 'setup' && <div className="gridTwo"><section className="panel"><h3>ESP32 Wi-Fi provisioning</h3><p className="muted">One-time registration creates a device ID and secret for your ESP32 sketch. The secret is shown only once. You can register up to 3 classroom devices.</p><button className="primary" disabled={!!busy || devices.length >= 3} onClick={createEsp32}>Register new ESP32</button>{provision && <div className="provision"><strong>Copy these values into firmware/config.h</strong><label>Backend URL<input readOnly value={provision.serverUrl} /></label><label>Device ID<input readOnly value={provision.deviceId}/></label><label>Device key<input readOnly value={provision.deviceKey}/></label><button type="button" className="secondary" onClick={() => navigator.clipboard.writeText(`const char* SERVER_URL = "${provision.serverUrl}";\nconst char* DEVICE_ID = "${provision.deviceId}";\nconst char* DEVICE_KEY = "${provision.deviceKey}";`)}>Copy ESP32 settings</button><small>Keep your device key private; don't commit it to GitHub.</small></div>}<div className="deviceList">{devices.map(d => <div key={d.id} className="entry"><div><b>{d.name}</b><small>{d.online ? (d.sensorReady ? 'Online, fingerprint sensor ready' : 'Online, sensor missing') : 'Offline'} · {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : 'Not connected yet'}</small></div><Status state={d.online ? 'connected' : 'disconnected'}>{d.online ? 'ONLINE' : 'OFFLINE'}</Status></div>)}</div></section><section className="panel"><h3>Physical setup sequence</h3><ol className="setupList"><li>Install the ESP32 boards package and Adafruit Fingerprint Sensor Library in Arduino IDE.</li><li>Register ESP32 here; securely copy its ID and secret.</li><li>Open <code>firmware/ESP32_LOGIX/ESP32_LOGIX.ino</code> and <code>config.example.h</code>; copy the config file to <code>config.h</code> and fill Wi-Fi, URL and device credentials.</li><li>Wire R307 UART to GPIO16/17; wire ESP32 GPIO25 and GPIO26 to the 7408 inputs. Connect the gate's output to the ESP32 with the logic-level-safe circuit shown in <code>WIRING.md</code>.</li><li>Wire green LED, red LED, and active buzzer as in the written connections.</li><li>Upload firmware, open Serial Monitor at 115200, and check ESP32 becomes ONLINE here.</li><li>Enrol a consenting person's face on this browser and fingerprint on the R307 sensor, then verify and evaluate.</li></ol><p className="muted">The browser cannot read a phone fingerprint sensor or access raw phone biometric data. The physical R307/AS608 stores fingerprint templates locally. Never connect these outputs to a real vehicle.</p></section></div>}
      <footer className="footer">UNDERAGE DRIVING · Classroom / exhibition demonstration · Consent required for biometrics · LED-and-buzzer-only outputs</footer>
    </main>
  </div>;
}
