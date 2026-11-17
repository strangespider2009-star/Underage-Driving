import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const directory = path.resolve(process.env.DATA_DIR || './server/local-data');
const file = path.join(directory, 'demo-data.json');
const empty = () => ({ users: [], vehicles: [], drivers: [], events: [], devices: [], jobs: [] });
fs.mkdirSync(directory, { recursive: true });
if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(empty(), null, 2), { flag: 'wx', mode: 0o600 });
export const makeId = () => crypto.randomUUID();
export const readStore = () => {
  const result = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { ...empty(), ...result };
};
export const writeStore = data => {
  // Atomic replacement reduces corruption on interrupted writes (still demo-only JSON storage).
  const next = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(next, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(next, file);
};
