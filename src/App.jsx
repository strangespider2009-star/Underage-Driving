import React, { useEffect, useRef, useState } from 'react';
import { api, post, patch, del } from './api.js';
import { startCamera, stopCamera, enrollFace, verifyFace, hasFace, deleteFace } from './face.js';
import { bleSupported, bleConnected, connectBle, disconnectBle, sendBleDecision } from './device.js';
import { enrollPhonePasskey, verifyPhonePasskey, passkeySupported } from './passkeys.js';

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
  return <div className="authWrap"><div className="authIntro"><div className="brandBadge">UD</div><p className="eyebrow">BIOMETRIC DEMONSTRATION PLATFORM</p><h1>SMART<br />DRIVE GUARD<span className="accent">.</span></h1><p>Face matching + phone passkey verification, using ESP32 Wi-Fi, a real 7408 AND gate, LEDs, and a buzzer.</p><div className="demoNote">EDUCATIONAL LED DEMO ONLY · NOT VEHICLE CONTROL</div></div><form className="authBox" onSubmit={submit}><span className="eyebrow">OWNER PORTAL</span><h2>{register ? 'Create demo account' : 'Welcome back'}</h2><p className="muted">{register ? 'Set up an owner profile to manage test vehicles and drivers.' : 'Sign in to continue your demonstration.'}</p>{register && <label>Full name<input value={name} onChange={e => setName(e.target.value)} required maxLength="80" autoComplete="name" /></label>}<label>Email address<input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" /></label><label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={register ? 8 : 1} autoComplete={register ? 'new-password' : 'current-password'} /></label><Message value={error} kind="error" /><button disabled={busy} className="primary wide" type="submit">{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</button><button type="button" className="linkButton" onClick={() => { setRegister(!register); setError(''); }}>{register ? 'Already registered? Sign in' : 'New here? Create demo account'}</button><small className="muted">This project is an educational demonstration, not a secure vehicle-access product.</small></form></div>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState('overview');
  const [data, setData] = useState({ vehicles: [], drivers: [], events: [] });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [bleStatus, setBleStatus] = useState(false);
  const [bleName, setBleName] = useState('');
  const [passkeyProofId, setPasskeyProofId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [faceState, setFaceState] = useState('pending');
  const [passkeyState, setPasskeyState] = useState('pending');
  const [cameraOn, setCameraOn] = useState(false);
  const [faceFeedback, setFaceFeedback] = useState('');
  const [verificationResult, setVerificationResult] = useState(null);
  const [progress, setProgress] = useState('');
  const [vehicleName, setVehicleName] = useState('');
  const [plate, setPlate] = useState('');
  const [driverName, setDriverName] = useState('');
  const [newVehicleId, setNewVehicleId] = useState('');
  const [licenceExpiry, setLicenceExpiry] = useState('');
  const videoRef = useRef(null);
  const activeCameraRef = useRef(null);
  const selected = data.drivers.find(d => d.id === driverId) || null;
  const vehicle = selected ? data.vehicles.find(v => v.id === selected.vehicleId) : null;
  const connected = bleStatus && bleConnected();
  const faceEnrolled = Boolean(user && selected && hasFace(user.id, selected.id));
  const facePassed = faceState === 'passed';
  const canEvaluate = connected && !!selected && ['passed', 'failed'].includes(faceState) && ['passed', 'failed'].includes(passkeyState) && !busy;

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

  async function run(fn, successMessage = '') {
    setError(''); setNotice(''); setBusy('task');
    try {
      await fn();
      if (successMessage) setNotice(successMessage);
    } catch (e) { setError(e.message || 'Something went wrong.'); }
    finally { setBusy(''); }
  }
  function resetEvidence() {
    setFaceState('pending'); setPasskeyState('pending'); setVerificationResult(null); setFaceFeedback(''); setProgress('');
    cameraStop();
    setPasskeyProofId('');
  }
  function chooseDriver(id) { resetEvidence(); setDriverId(id); }
  async function connectEsp32() {
    setError(''); setNotice(''); setBusy('ble');
    try {
      // The Bluetooth chooser must start in this button click handler.
      const result = await connectBle(setBleStatus);
      setBleName(result.name);
      setBleStatus(true);
      setNotice('Connected to ESP32 through Bluetooth Low Energy.');
    } catch (err) {
      setError('BLE connection failed: ' + (err.message || 'Unknown Bluetooth error.'));
    } finally { setBusy(''); }
  }
  function disconnectEsp32() {
    disconnectBle(); setBleStatus(false); setBleName('');
    setNotice('ESP32 BLE disconnected.');
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
      if (!result.matched) { setError('FACE MISMATCH — This does not match the enrolled face. Complete the phone passkey check and evaluate for the 10-second red LED + buzzer.'); }
      else setNotice(`Face matched the enrolled template for ${selected.name}.`);
    });
    setProgress(''); cameraStop();
    // Any camera or model error must be a failure, never a passing result.
    setFaceState(current => current === 'checking' ? 'failed' : current);
  }
  async function savePasskey() {
    if (!selected) return setError('Choose a driver first.');
    await run(async () => {
      setProgress('Confirm passkey creation on this phone.');
      await enrollPhonePasskey(selected.id);
      await refresh(); setPasskeyState('pending'); setVerificationResult(null);
      setNotice('Phone passkey enrolled. Only its public key is saved on the server; no biometric data is collected.');
    });
    setProgress('');
  }
  async function checkPasskey() {
    if (!selected) return setError('Choose a driver.');
    setError(''); setNotice(''); setPasskeyState('checking'); setBusy('task'); setPasskeyProofId('');
    setProgress('Use the registered phone passkey (fingerprint, face unlock or PIN).');
    try {
      const result = await verifyPhonePasskey(selected.id);
      setPasskeyProofId(result.proofId);
      setPasskeyState('passed'); setVerificationResult(null);
      setNotice('Passkey verified by the server. Evaluate the gate within 90 seconds.');
    } catch (err) {
      setPasskeyProofId('');
      setPasskeyState('failed'); setVerificationResult(null);
      setError('Passkey not verified: ' + (err.message || 'cancelled or incorrect authenticator') + '. Evaluate for red LED + buzzer.');
    } finally {
      setProgress(''); setBusy('');
    }
  }
  async function removePasskey() {
    if (!selected) return setError('Choose a driver.');
    if (!window.confirm('Remove this driver’s enrolled phone passkey from the website?')) return;
    await run(async () => {
      await del('/api/passkeys/' + encodeURIComponent(selected.id));
      await refresh(); setPasskeyState('pending'); setPasskeyProofId(''); setVerificationResult(null);
    }, 'Passkey removed from the server (it may remain visible in phone settings).');
  }
  async function evaluate() {
    if (!selected) return setError('Select a driver.');
    if (!connected) return setError('Connect ESP32 over BLE first.');
    await run(async () => {
      const response = await post('/api/access/check', {
        driverId: selected.id, vehicleId: selected.vehicleId,
        faceMatched: facePassed,
        passkeyProofId: passkeyState === 'passed' ? passkeyProofId : null
      });
      // The one-use, server-verified passkey proof is consumed here.
      setPasskeyProofId(''); setPasskeyState('pending');
      setVerificationResult({ ...response.decision,
        hardwareInputA: response.command.a, hardwareInputB: response.command.b,
        gateHigh: null, bleStatus: 'pending' });
      setProgress('Sending verified decision bits to ESP32 over Bluetooth…');
      let hardware;
      try {
        hardware = await sendBleDecision(response.command.a, response.command.b);
      } catch (error) {
        await post('/api/access/report', { eventId: response.event.id, status: 'N', gateHigh: null }).catch(() => {});
        await refresh();
        setProgress('');
        throw error;
      }
      setProgress('ESP32 replied. Recording the BLE result…');
      const { gateHigh, status } = hardware;
      try {
        await post('/api/access/report', { eventId: response.event.id, status, gateHigh });
      } catch (error) {
        setProgress('');
        throw new Error('ESP32 replied, but the server log could not be updated: ' + error.message);
      }
      setProgress('');
      setVerificationResult({ ...response.decision,
        hardwareInputA: response.command.a, hardwareInputB: response.command.b,
        gateHigh, bleStatus: status });
      await refresh();
      if (hardware.fault) throw new Error('The physical 7408 output disagrees with the expected logic. Check IC and GPIO27 wiring.');
      setNotice(status === 'P' ? 'BLE RESULT 1: GREEN LED ON FOR 10 SECONDS'
        : 'BLE RESULT 0: RED LED + BUZZER ON FOR 10 SECONDS');
    });
  }
  async function logout() {
    await run(async () => {
      cameraStop(); await post('/api/auth/logout', {});
      disconnectBle(); setBleStatus(false); setBleName('');
      setUser(null); setData({ vehicles: [], drivers: [], events: [] }); setPage('overview');
    });
  }
  if (loading) return <div className="loading">Loading UNDERAGE DRIVING…</div>;
  if (!user) return <Auth onAuth={u => { setUser(u); void refresh().catch(e => setError(e.message)); }} />;

  return <div className="shell">
    <aside className="sidebar">
      <div className="logoLine"><div className="logo">UD</div><div><b>UNDERAGE</b><small>DRIVING / DEMO</small></div></div>
      <div className="navLabel">WORKSPACE</div>
      <nav>{NAV.map(([id, title, symbol]) => <button key={id} type="button" disabled={!!busy} className={page === id ? 'nav active' : 'nav'} onClick={() => { setPage(id); setError(''); setNotice(''); }}><span>{symbol}</span>{title}</button>)}</nav>
      <div className="sidebarFooter"><div className="hardwareLine"><span className={`tinyLight ${connected ? 'green' : 'red'}`} /> ESP32 BLE: {connected ? 'CONNECTED' : 'DISCONNECTED'}</div><div className="noticeSmall">LED-only exhibition prototype. No real vehicle controls.</div><button className="sidebarSignout" type="button" onClick={logout}>↪ Sign out</button></div>
    </aside>
    <main className="main">
      <header className="topbar"><div><span className="eyebrow">UNDERAGE DRIVING · ESP32</span><h1>{NAV.find(x => x[0] === page)?.[1]}</h1></div><div className="topRight"><span className="demoPill">CLASSROOM DEMO</span><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span></div></header>
      <Message value={error} kind="error" /><Message value={notice} kind="success" />
      {page === 'overview' && <>
        <section className="hero"><div><span className="eyebrow">SECURE ACCESS · EDUCATIONAL PROTOTYPE</span><h2>Two-stage biometric demonstration</h2><p>Compare an enrolled face, then verify a passkey with the phone's built-in security prompt. Show final approved / rejected results on two LEDs.</p><button className="primary" type="button" onClick={() => setPage('verify')}>Open verification ↗</button></div><div className="heroArt"><div className="ring ring1"/><div className="ring ring2"/><div className="ring ring3"/><span>◎</span></div></section>
        <div className="metrics"><Metric icon="▤" number={data.vehicles.length} label="Vehicles" /><Metric icon="♙" number={data.drivers.length} label="Drivers" /><Metric icon="◉" number={data.drivers.filter(d => d.passkeyEnrolled).length} label="Phone passkeys" /><Metric icon="◷" number={data.events.length} label="Recent checks" /></div>
        <section className="panel"><h3>How the demonstration works</h3><div className="stepsGrid"><div><b>01 · Driver record</b><p>Create a vehicle and an approved demo driver.</p></div><div><b>02 · Enrolment</b><p>Enrol face in the browser and a passkey on the phone.</p></div><div><b>03 · Verification</b><p>Verify face + phone passkey; require approval and valid demo information.</p></div><div><b>04 · 7408 hardware logic</b><p>ESP32 sends A/B into the physical AND gate; green or red + buzzer runs for 10 seconds.</p></div></div></section>
      </>}
      {page === 'vehicles' && <div className="gridTwo"><section className="panel"><h3>Add vehicle</h3><p className="muted">Use demonstration data only.</p><form onSubmit={e => { e.preventDefault(); void run(async () => { await post('/api/vehicles', { name: vehicleName, plate }); await refresh(); setVehicleName(''); setPlate(''); }, 'Vehicle added.'); }}><label>Vehicle name<input value={vehicleName} onChange={e => setVehicleName(e.target.value)} placeholder="Project demo car" required maxLength="100" /></label><label>Registration label (optional)<input value={plate} onChange={e => setPlate(e.target.value)} placeholder="DEMO-001" maxLength="32" /></label><button className="primary" type="submit" disabled={!!busy}>Save vehicle</button></form></section><section className="panel"><h3>Your vehicles</h3>{!data.vehicles.length && <p className="muted">No vehicles yet.</p>}{data.vehicles.map(v => <div className="entry" key={v.id}><div><b>{v.name}</b><small>{v.plate || 'No label'}</small></div><button className="subtle" type="button" disabled={!!busy} onClick={() => void run(async () => { await del(`/api/vehicles/${v.id}`); await refresh(); }, 'Vehicle removed.')}>Remove</button></div>)}</section></div>}
      {page === 'drivers' && <div className="gridTwo"><section className="panel"><h3>Add authorized test driver</h3><p className="muted">Enroll a phone passkey for each driver on the device used for verification.</p><form onSubmit={e => { e.preventDefault(); void run(async () => { await post('/api/drivers', { name: driverName, vehicleId: newVehicleId, licenceExpiry }); await refresh(); setDriverName(''); }, 'Driver record added.'); }}><label>Name<input required value={driverName} onChange={e => setDriverName(e.target.value)} placeholder="Demo driver" maxLength="100" /></label><label>Assigned vehicle<select required value={newVehicleId} onChange={e => setNewVehicleId(e.target.value)}><option value="">Select a vehicle</option>{data.vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label><label>Test licence expiry<input required type="date" value={licenceExpiry} onChange={e => setLicenceExpiry(e.target.value)} /></label><button disabled={!!busy || !data.vehicles.length} className="primary" type="submit">Add driver</button></form></section><section className="panel"><h3>Driver approvals</h3>{!data.drivers.length && <p className="muted">Add a vehicle, then a driver.</p>}{data.drivers.map(d => <div className="driverCard" key={d.id}><div className="entry"><div><b>{d.name}</b><small>Expiry {d.licenceExpiry}</small></div><Status state={d.approved ? 'passed' : 'pending'}>{d.approved ? 'APPROVED' : 'PENDING'}</Status></div><small className="muted">Phone passkey: {d.passkeyEnrolled ? 'enrolled' : 'not enrolled'}</small><div className="inlineActions"><button type="button" className="secondary" disabled={!!busy} onClick={() => void run(async () => { await patch(`/api/drivers/${d.id}/approval`, { approved: !d.approved }); await refresh(); }, d.approved ? 'Driver approval removed.' : 'Driver approved.')}>{d.approved ? 'Revoke approval' : 'Approve driver'}</button><button type="button" className="subtle" disabled={!!busy} onClick={() => { if (!window.confirm('Remove the demo driver and its stored passkey public key?')) return; void run(async () => { await del(`/api/drivers/${d.id}`); if (user) deleteFace(user.id, d.id); await refresh(); resetEvidence(); }, 'Driver and server-side passkey removed.'); }}>Remove record</button></div></div>)}</section></div>}
      {(page === 'enroll' || page === 'verify') && <>
        <section className="panel controlsPanel"><div><h3>ESP32 Bluetooth Low Energy</h3><p className="muted">Connect the ESP32 directly from Android Chrome. The website verifies face and phone passkey before sending A/B over BLE.</p></div><div className="inlineActions"><Status state={connected ? 'connected' : 'disconnected'}>{connected ? 'ESP32 BLE CONNECTED' : 'ESP32 BLE DISCONNECTED'}</Status><button className="secondary" type="button" disabled={!!busy || connected || !bleSupported()} onClick={connectEsp32}>Connect ESP32 via BLE</button>{connected && <button className="subtle" type="button" disabled={!!busy} onClick={disconnectEsp32}>Disconnect</button>}<button className="subtle" type="button" onClick={() => setPage('setup')}>BLE setup guide</button></div></section>
        <section className="panel driverSelector"><label>Selected driver<select value={driverId} disabled={!!busy} onChange={e => chooseDriver(e.target.value)}><option value="">Select driver</option>{data.drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label><div><small>Assigned vehicle</small><b>{vehicle?.name || 'None'}</b></div><div><small>Phone passkey</small><b>{selected?.passkeyEnrolled ? 'Enrolled' : 'Not enrolled'}</b></div><div><small>Owner status</small><Status state={selected?.approved ? 'passed' : 'pending'}>{selected?.approved ? 'Approved' : 'Not approved'}</Status></div></section>
        {!data.drivers.length && <Message value="Create a vehicle and a driver first, then enrol biometrics." />}
        <div className="gridTwo verificationGrid"><section className="panel"><div className="sectionHead"><div><span className="stepNumber">01</span><h3>Facial identity match</h3></div><Status state={faceState}>{faceState === 'passed' ? 'MATCH' : faceState === 'failed' ? 'NO MATCH' : faceState === 'checking' ? 'CHECKING' : 'PENDING'}</Status></div><p className="muted">Compares a real 128-number face descriptor against this driver's locally enrolled template. A different face should be rejected; this is not liveness detection.</p><video className="video" ref={videoRef} autoPlay muted playsInline style={{ display: cameraOn ? 'block' : 'none' }} /><div className={cameraOn ? 'cameraHint hidden' : 'cameraHint'}>▣<span>Camera preview not active</span></div><small className="muted">Local face template: {faceEnrolled ? 'ENROLLED' : 'NOT ENROLLED'}</small><div className="inlineActions"><button type="button" className="secondary" disabled={!!busy || cameraOn || !selected} onClick={cameraStart}>Start camera</button><button type="button" className="subtle" disabled={!!busy || !cameraOn} onClick={cameraStop}>Stop camera</button></div><div className="inlineActions">{page === 'enroll' ? <><Action busy={!!busy} disabled={!cameraOn || !selected} onClick={saveFace}>Enrol face</Action><button className="subtle danger" type="button" disabled={!!busy || !faceEnrolled} onClick={() => { deleteFace(user.id, selected.id); resetEvidence(); setNotice('Local face template deleted.'); }}>Delete face</button></> : <Action busy={!!busy} disabled={!cameraOn || !selected || !faceEnrolled} onClick={matchFace}>Verify face</Action>}</div>{faceFeedback && <p className="codeText">{faceFeedback}</p>}</section>
        <section className="panel"><div className="sectionHead"><div><span className="stepNumber">02</span><h3>Phone passkey verification</h3></div><Status state={passkeyState}>{passkeyState === 'passed' ? 'VERIFIED' : passkeyState === 'failed' ? 'NO VERIFICATION' : passkeyState === 'checking' ? 'CHECKING' : 'PENDING'}</Status></div><p className="muted">Uses the phone's WebAuthn passkey prompt. The phone may verify using fingerprint, face unlock, or screen-lock PIN. No fingerprint is shared with this website.</p><div className="fingerIcon">🔐</div><div className="statLine"><span>Passkey for selected driver</span><Status state={selected?.passkeyEnrolled ? 'enrolled' : 'pending'}>{selected?.passkeyEnrolled ? 'ENROLLED' : 'NOT ENROLLED'}</Status></div>{page === 'enroll' ? <div className="inlineActions"><Action busy={!!busy} disabled={!selected || !!selected.passkeyEnrolled || !passkeySupported()} onClick={savePasskey}>Enrol phone passkey</Action><button type="button" className="subtle danger" disabled={!!busy || !selected?.passkeyEnrolled} onClick={removePasskey}>Remove passkey</button></div> : <Action busy={!!busy} disabled={!selected?.passkeyEnrolled || !passkeySupported()} onClick={checkPasskey}>Verify phone passkey</Action>}<small className="muted">Use HTTPS in Chrome or Safari on the phone. A signed passkey assertion enables input B=1 for one decision; otherwise B=0. ESP32 displays the physical gate result for 10 seconds.</small></section></div>
        {progress && <Message value={progress} />}
        {page === 'verify' && <section className="panel resultPanel"><div><h3>Final two-factor demo decision</h3><p className="muted">ESP32 drives face/policy bit A and phone passkey bit B into the real 7408 AND gate. The measured gate output controls green for 10 seconds if 1, otherwise red plus buzzer for 10 seconds. Additional owner/date checks can force input A low. This is an educational demo.</p></div><div className="inlineActions"><Action disabled={!canEvaluate} busy={!!busy} onClick={evaluate}>Evaluate physical 7408 gate</Action><button className="secondary" disabled={!!busy} type="button" onClick={() => { resetEvidence(); setNotice('Verification reset. ESP32 automatically ends any active LED window after 10 seconds.'); }}>Reset</button></div>{verificationResult && <div className={`decision ${verificationResult.accessGranted ? 'approve' : 'deny'}`}><b>{verificationResult.accessGranted ? '✓ DEMO APPROVED' : '✕ DEMO REJECTED'}</b><p className="codeText">7408 inputs: A={verificationResult.hardwareInputA} · B={verificationResult.hardwareInputB} · AND output={verificationResult.gateHigh == null ? 'checking…' : Number(verificationResult.gateHigh)}</p><div className="checks">{Object.entries(verificationResult.checks).map(([k, val]) => <span key={k}>{val ? '✓' : '✕'} {k.replace(/([A-Z])/g, ' $1')}</span>)}</div></div>}</section>}
        <section className="panel"><h3>BLE device status</h3><p className="muted">{connected ? `Connected to ${bleName || 'LOGIX-BLE'} on this phone` : 'Not connected. Tap Connect ESP32 via BLE in Android Chrome.'}</p></section>
      </>}
      {page === 'history' && <section className="panel"><h3>Last 80 demo checks</h3>{!data.events.length ? <p className="muted">No checks recorded yet.</p> : <div className="historyTable"><table><thead><tr><th>Time</th><th>Driver</th><th>Vehicle</th><th>Face</th><th>Phone passkey</th><th>BLE reply</th><th>Decision</th></tr></thead><tbody>{data.events.map(e => <tr key={e.id}><td>{new Date(e.at).toLocaleString()}</td><td>{e.driverName}</td><td>{e.vehicleName}</td><td>{e.faceMatched ? 'Pass' : 'Fail'}</td><td>{e.passkeyMatched ? 'Pass' : 'Fail'}</td><td>{e.bleStatus === 'P' ? 'GREEN' : e.bleStatus === 'D' ? 'RED' : e.bleStatus === 'F' ? 'GATE FAULT' : e.bleStatus === 'N' ? 'NO REPLY' : 'PENDING'}</td><td><Status state={e.accessGranted ? 'passed' : 'failed'}>{e.accessGranted ? 'APPROVED' : 'DENIED'}</Status></td></tr>)}</tbody></table></div>}</section>}
      {page === 'setup' && <div className="gridTwo"><section className="panel"><h3>Connect ESP32 over BLE</h3><p className="muted">Power the ESP32 with USB and enable Bluetooth on your Android phone. Open the deployed HTTPS site in Android Chrome, then select LOGIX-BLE from the device chooser.</p><div className="inlineActions"><Status state={connected ? 'connected' : 'disconnected'}>{connected ? 'BLE CONNECTED' : 'NOT CONNECTED'}</Status><button className="primary" type="button" disabled={!!busy || connected || !bleSupported()} onClick={connectEsp32}>Connect ESP32 via BLE</button>{connected && <button type="button" className="secondary" onClick={disconnectEsp32}>Disconnect BLE</button>}</div>{!bleSupported() && <p className="message error">Web Bluetooth is unavailable in this browser. Try Android Chrome on HTTPS. Basic Android WebView APKs and iPhone Safari do not provide this interface.</p>}<p className="muted">No Wi-Fi credentials, device ID, config.h, trust_roots.h, HC-05, or external fingerprint sensor is required.</p></section><section className="panel"><h3>Physical setup sequence</h3><ol className="setupList"><li>Install the esp32 by Espressif Systems 3.x board package in Arduino IDE (includes BLE library).</li><li>Open the current <code>firmware/ESP32_LOGIX/ESP32_LOGIX.ino</code>. It is a single-file sketch.</li><li>Wire GPIO25/26 to 7408 A/B, its level-safe output to GPIO27, LEDs to GPIO18/19, and active buzzer driver to GPIO23 per <code>WIRING.md</code>.</li><li>Upload sketch and check Serial Monitor at 115200 baud for LOGIX-BLE advertising.</li><li>Tap Connect ESP32 via BLE in Android Chrome, then select LOGIX-BLE.</li><li>Enroll a consenting person’s face and phone passkey on the website.</li><li>Verify the face, verify the passkey, and evaluate the physical AND gate. The LED/buzzer lasts 10 seconds.</li></ol><p className="muted">The passkey prompt may use a fingerprint, face unlock, or phone PIN. BLE commands are not independently authenticated by the ESP32: never use this classroom demonstration for real locks or vehicles.</p></section></div>}
      <footer className="footer">UNDERAGE DRIVING · Classroom / exhibition demonstration · Consent required for biometrics · LED-and-buzzer-only outputs</footer>
    </main>
  </div>;
}
