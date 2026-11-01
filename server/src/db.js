// SQLite database on the data volume (built into Node): accounts, invites, brands and jobs.
// Brands and jobs are stored whole as JSON, tagged with the account they belong to.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from './paths.js';

export const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE, phone TEXT UNIQUE, password TEXT,
    role TEXT NOT NULL DEFAULT 'customer', paid INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS invites (token TEXT PRIMARY KEY, email TEXT, phone TEXT, createdAt TEXT NOT NULL, usedAt TEXT);
  CREATE TABLE IF NOT EXISTS docs (kind TEXT NOT NULL, id TEXT NOT NULL, userId TEXT, data TEXT NOT NULL, PRIMARY KEY (kind, id));
`);

// A collection of JSON documents ("brands", "jobs"). On first run, imports the old <kind>.json file
// and gives its records to `owner` (the admin), so nothing made before accounts existed is lost.
export function collection(kind, owner) {
  const put = db.prepare('INSERT INTO docs (kind, id, userId, data) VALUES (?, ?, ?, ?) ON CONFLICT (kind, id) DO UPDATE SET userId = excluded.userId, data = excluded.data');
  const del = db.prepare('DELETE FROM docs WHERE kind = ? AND id = ?');
  const legacy = path.join(DATA_DIR, `${kind}.json`);
  if (fs.existsSync(legacy)) {
    for (const doc of JSON.parse(fs.readFileSync(legacy, 'utf8'))) {
      doc.userId ??= owner;
      put.run(kind, doc.id, doc.userId ?? null, JSON.stringify(doc));
    }
    fs.renameSync(legacy, `${legacy}.imported`);
  }
  return {
    all: () => db.prepare('SELECT data FROM docs WHERE kind = ?').all(kind).map((r) => JSON.parse(r.data)),
    put: (doc) => put.run(kind, doc.id, doc.userId ?? null, JSON.stringify(doc)),
    del: (id) => del.run(kind, id),
  };
}
