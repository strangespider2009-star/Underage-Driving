import { api, post } from './api.js';

export const getDevices = () => api('/api/devices');
export const registerDevice = name => post('/api/devices', { name });

export async function runFingerprint({ type, deviceId, driverId, onProgress }) {
  const { job } = await post('/api/device/jobs', { type, deviceId, driverId });
  return waitForJob(job.id, type === 'ENROLL' ? 97000 : 31000, onProgress);
}
export async function waitForJob(jobId, maxWaitMs = 23000, onProgress = () => {}) {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const { job } = await api(`/api/device/jobs/${encodeURIComponent(jobId)}`);
    if (job.status === 'done') return job;
    if (job.status === 'error') throw new Error(`ESP32 operation failed: ${job.reason || 'timeout'}`);
    onProgress(job.status === 'running' ? 'ESP32 is processing…' : 'Waiting for ESP32…');
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw new Error('ESP32 response timed out. Check Wi-Fi and sensor power.');
}
