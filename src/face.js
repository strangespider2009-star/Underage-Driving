// Identity matching, not simple face-presence detection. DEMO only: no liveness/PAD.
const MODEL_URL = '/models';
const THRESHOLD = 0.48; // conservative classroom heuristic, not calibrated security
const ENROLL_SAMPLES = 5;
const MATCH_SAMPLES = 3;
const PREFIX = 'sdg.local-face.v2:';
let facePromise;
let modelsPromise;

function faceLib() { return facePromise ||= import('@vladmandic/face-api'); }
export function templateKey(userId, driverId) { return `${PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(driverId)}`; }
export function hasFace(userId, driverId) {
  try { return Boolean(localStorage.getItem(templateKey(userId, driverId))); } catch { return false; }
}
export function deleteFace(userId, driverId) { localStorage.removeItem(templateKey(userId, driverId)); }
export async function loadModels() {
  if (!modelsPromise) modelsPromise = (async () => {
    const faceapi = await faceLib();
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
    ]);
    return faceapi;
  })().catch(e => { modelsPromise = null; throw new Error(`Face models failed to load. Confirm /models files are deployed. ${e.message}`); });
  return modelsPromise;
}
export async function startCamera(video) {
  if (!video) throw new Error('Camera element not available.');
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
    throw new Error('Camera requires HTTPS or localhost and a supported browser.');
  if (video.srcObject) stopCamera(video);
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } });
    video.srcObject = stream;
    await video.play();
    await loadModels();
    return stream;
  } catch (error) {
    stream?.getTracks().forEach(t => t.stop()); video.srcObject = null;
    throw error;
  }
}
export function stopCamera(video) {
  video?.srcObject?.getTracks?.().forEach(t => t.stop());
  if (video) video.srcObject = null;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function descriptor(video) {
  if (!video?.srcObject || video.readyState < 2) throw new Error('Start the camera and wait for the video preview.');
  const faceapi = await loadModels();
  const found = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.55 })).withFaceLandmarks().withFaceDescriptors();
  if (found.length === 0) throw new Error('No clear face found. Improve lighting, face the camera, and retry.');
  if (found.length > 1) throw new Error('Multiple faces detected. Keep exactly one person in view.');
  const vector = [...found[0].descriptor];
  if (vector.length !== 128 || !vector.every(Number.isFinite)) throw new Error('Invalid face data. Please retry.');
  return vector;
}
function average(vectors) {
  if (!vectors.length) throw new Error('No face samples captured.');
  return vectors[0].map((_, i) => vectors.reduce((sum, v) => sum + v[i], 0) / vectors.length);
}
async function collect(video, amount, onProgress) {
  const vectors = [];
  for (let i = 0; i < amount; i++) {
    vectors.push(await descriptor(video));
    onProgress?.(i + 1, amount);
    if (i + 1 < amount) await delay(400);
  }
  return vectors;
}
export async function enrollFace(video, userId, driverId, onProgress) {
  const samples = await collect(video, ENROLL_SAMPLES, onProgress);
  const vector = average(samples);
  // Prevent accidental enrollment of two different people across captures.
  if (samples.some(sample => !compareDescriptors(vector, sample, 0.42).matched))
    throw new Error('Face changed or moved too much during enrollment. Keep the same person steady and retry.');
  const data = { version: 2, userId, driverId, vector, enrolledAt: new Date().toISOString() };
  try { localStorage.setItem(templateKey(userId, driverId), JSON.stringify(data)); }
  catch { throw new Error('Could not save local face template. Check browser storage settings.'); }
  return { samples: ENROLL_SAMPLES };
}
export function compareDescriptors(enrolled, current, threshold = THRESHOLD) {
  if (![enrolled, current].every(v => Array.isArray(v) && v.length === 128 && v.every(Number.isFinite)))
    throw new Error('Invalid face descriptor vectors.');
  const distance = Math.hypot(...current.map((v, i) => v - enrolled[i]));
  return { matched: Number.isFinite(distance) && distance <= threshold, distance: Number(distance.toFixed(4)), threshold };
}
export async function verifyFace(video, userId, driverId, onProgress) {
  let template;
  try { template = JSON.parse(localStorage.getItem(templateKey(userId, driverId)) || 'null'); }
  catch { throw new Error('Face template is corrupted. Delete it and re-enrol.'); }
  if (!template || template.version !== 2 || template.userId !== userId || template.driverId !== driverId ||
      !Array.isArray(template.vector) || template.vector.length !== 128 || !template.vector.every(Number.isFinite))
    throw new Error('No valid face enrolled for this driver in this browser.');
  const samples = await collect(video, MATCH_SAMPLES, onProgress);
  const distances = samples.map(sample => compareDescriptors(template.vector, sample));
  const combined = compareDescriptors(template.vector, average(samples));
  // Every captured sample must match (not just a misleading average).
  return { ...combined, matched: combined.matched && distances.every(result => result.matched) };
}
