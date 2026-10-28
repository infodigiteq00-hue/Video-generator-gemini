import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const OUTPUTS_DIR = path.join(DATA_DIR, 'videos'); // holds generated images too; name kept for existing URLs

for (const dir of [UPLOADS_DIR, OUTPUTS_DIR]) fs.mkdirSync(dir, { recursive: true });
