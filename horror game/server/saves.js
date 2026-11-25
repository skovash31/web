// Checkpoint persistence. Each room's checkpoint is stored under its room code, so the
// same code can be used later from the main menu ("Continue") to resume.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'saves');
const dir = () => process.env.SAVE_DIR || DEFAULT_DIR;

function file(code) {
  const safe = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!safe) throw new Error('bad code');
  return path.join(dir(), safe + '.json');
}

export function saveCheckpoint(code, data) {
  try {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(file(code), JSON.stringify({ ...data, savedAt: Date.now() }, null, 2));
    return true;
  } catch (e) {
    console.error('save failed', e.message);
    return false;
  }
}

export function loadCheckpoint(code) {
  try {
    return JSON.parse(fs.readFileSync(file(code), 'utf8'));
  } catch {
    return null;
  }
}
