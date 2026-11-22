import { createHash, randomBytes, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HOUR, member, Problem, roles, textField } from './domain.mjs';

const scrypt = promisify(derive);
const SESSION_LIFE = 8 * HOUR;
const publicFields = 'id, name, email, unit, role';

export async function createUser(db, input) {
  const email = textField(input.email, 'Почта', 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new Problem(422, 'Проверьте адрес почты.');
  const name = textField(input.name, 'Имя', 2, 100);
  const unit = textField(input.unit, 'Подразделение', 2, 120);
  const role = member(input.role, roles, 'Выберите действующую роль.');
  if (typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 256) {
    throw new Problem(422, 'Длина пароля должна составлять от 12 до 256 символов.');
  }
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(input.password, salt, 64);
  const record = db.prepare(`INSERT INTO users(name,email,unit,role,passwordHash) VALUES(?,?,?,?,?)
    ON CONFLICT(email) DO NOTHING`).run(name, email, unit, role, salt + '.' + hash.toString('hex'));
  if (!record.changes) throw new Problem(409, 'Такая почта уже зарегистрирована.');
  return db.prepare(`SELECT ${publicFields} FROM users WHERE id=?`).get(record.lastInsertRowid);
}

export async function authenticate(db, email, password) {
  const user = typeof email === 'string' && email.length <= 254
    ? db.prepare('SELECT * FROM users WHERE email=?').get(email.trim())
    : null;
  const [salt, expected] = (user?.passwordHash ?? ('00'.repeat(16) + '.' + '00'.repeat(64))).split('.');
  const candidate = typeof password === 'string' && password.length <= 256 ? password : '';
  const actual = await scrypt(candidate, salt, 64);
  if (!timingSafeEqual(actual, Buffer.from(expected, 'hex')) || !user?.passwordHash) {
    throw new Problem(401, 'Проверьте почту и пароль.', 'invalid_credentials');
  }
  return db.prepare(`SELECT ${publicFields} FROM users WHERE id=?`).get(user.id);
}

export function demoProfiles(db) {
  return db.prepare(`SELECT ${publicFields} FROM users WHERE id IN (1,2,3) ORDER BY id`).all();
}

function tokenHash(cookie) {
  const token = /(?:^|;\s*)gosdesk_session=([a-f0-9]{64})(?:;|$)/.exec(cookie ?? '')?.[1];
  return token ? createHash('sha256').update(token).digest('hex') : '';
}

export function currentUser(db, cookie, now) {
  return db.prepare(`SELECT u.id, u.name, u.email, u.unit, u.role FROM sessions s
    JOIN users u ON u.id=s.userId WHERE s.tokenHash=? AND s.expiresAt>?`).get(tokenHash(cookie), now) ?? null;
}

export function endSession(db, cookie) {
  db.prepare('DELETE FROM sessions WHERE tokenHash=?').run(tokenHash(cookie));
}

export function sessionCookie(db, userId, oldCookie, now, secure) {
  const flags = '; Path=/; HttpOnly; SameSite=Strict' + (secure ? '; Secure' : '');
  endSession(db, oldCookie);
  if (!userId) return 'gosdesk_session=; Max-Age=0' + flags;
  db.prepare('DELETE FROM sessions WHERE expiresAt<=?').run(now);
  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash, userId, now + SESSION_LIFE);
  return 'gosdesk_session=' + token + '; Max-Age=' + SESSION_LIFE / 1000 + flags;
}
