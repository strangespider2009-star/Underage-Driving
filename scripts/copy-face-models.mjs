import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'node_modules', '@vladmandic', 'face-api', 'model');
const target = path.join(root, 'public', 'models');
const basenames = ['tiny_face_detector_model', 'face_landmark_68_model', 'face_recognition_model'];
if (!fs.existsSync(source)) throw new Error('Face models missing from node_modules. Run npm install first.');
fs.mkdirSync(target, { recursive: true });
let count = 0;
for (const file of fs.readdirSync(source)) {
  if (!basenames.some(name => file.startsWith(name))) continue;
  const original = path.join(source, file);
  if (!fs.statSync(original).isFile()) continue;
  fs.copyFileSync(original, path.join(target, file));
  count++;
}
for (const name of basenames) {
  if (!fs.existsSync(path.join(target, `${name}-weights_manifest.json`))) {
    throw new Error(`Missing ${name} manifest in ${source}. Check installed face-api version.`);
  }
}
console.log(`Face model assets ready: ${count} files copied to public/models.`);
