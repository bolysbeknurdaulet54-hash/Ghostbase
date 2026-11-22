import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { serviceDefinitions } from './domain.mjs';
import { seedDemo } from './seed.mjs';

export function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

const schema = `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE users (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    unit TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('employee','specialist','coordinator')),
    passwordHash TEXT
  );
  CREATE TABLE services (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, icon TEXT NOT NULL,
    baseHours INTEGER NOT NULL CHECK(baseHours > 0)
  );
  CREATE TABLE tickets (
    id INTEGER PRIMARY KEY, subject TEXT NOT NULL, description TEXT NOT NULL,
    serviceId TEXT NOT NULL REFERENCES services(id), requesterId INTEGER NOT NULL REFERENCES users(id),
    assigneeId INTEGER REFERENCES users(id), priority TEXT NOT NULL CHECK(priority IN ('low','normal','high')),
    status TEXT NOT NULL CHECK(status IN ('new','in_progress','waiting','resolved','closed')),
    createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, dueAt INTEGER NOT NULL,
    resolvedAt INTEGER, closedAt INTEGER, version INTEGER NOT NULL DEFAULT 1,
    CHECK(dueAt > createdAt),
    CHECK((status = 'new' AND assigneeId IS NULL) OR (status <> 'new' AND assigneeId IS NOT NULL)),
    CHECK((status IN ('resolved','closed')) = (resolvedAt IS NOT NULL)),
    CHECK((status = 'closed') = (closedAt IS NOT NULL))
  );
  CREATE INDEX tickets_requester ON tickets(requesterId, createdAt);
  CREATE INDEX tickets_assignee ON tickets(assigneeId, status);
  CREATE INDEX tickets_deadline ON tickets(status, dueAt);
  CREATE INDEX tickets_created ON tickets(createdAt DESC, id DESC);
  CREATE TABLE events (
    id INTEGER PRIMARY KEY, ticketId INTEGER NOT NULL REFERENCES tickets(id),
    actorId INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL, detail TEXT NOT NULL,
    at INTEGER NOT NULL
  );
  CREATE INDEX events_ticket ON events(ticketId, at, id);
  CREATE INDEX events_activity ON events(kind, at);
  CREATE TABLE sessions (
    tokenHash TEXT PRIMARY KEY, userId INTEGER NOT NULL REFERENCES users(id), expiresAt INTEGER NOT NULL
  );
  CREATE INDEX sessions_expiry ON sessions(expiresAt);
`;

export function openDatabase({ file = ':memory:', demo = false, now = Date.now() } = {}) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
    transaction(db, () => {
      const version = db.prepare('PRAGMA user_version').get().user_version;
      const mode = demo ? 'demo' : 'standard';
      if (version === 0) {
        db.exec(schema);
        db.prepare('INSERT INTO meta VALUES (?, ?)').run('mode', mode);
        const addService = db.prepare('INSERT INTO services VALUES (?,?,?,?,?)');
        for (const service of serviceDefinitions) addService.run(...service);
        if (demo) seedDemo(db, now);
      } else if (version > 2 || db.prepare("SELECT value FROM meta WHERE key='mode'").get()?.value !== mode) {
        throw new Error('Версия или режим базы не совпадает. Выберите отдельный файл GOSDESK_DB.');
      }
      if (version < 2) {
        db.exec(`ALTER TABLE tickets ADD COLUMN requestKey TEXT;
          CREATE UNIQUE INDEX tickets_request_key ON tickets(requesterId,requestKey) WHERE requestKey IS NOT NULL;
          PRAGMA user_version = 2;`);
      }
    });
    // SQLite's built-in lower() only folds ASCII. Register Unicode case folding for Russian search.
    db.function('fold', { deterministic: true }, value => String(value ?? '').toLocaleLowerCase('ru'));
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
