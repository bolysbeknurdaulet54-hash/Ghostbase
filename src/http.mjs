import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';
import { authenticate, currentUser, demoProfiles, sessionCookie } from './auth.mjs';
import { DAY, priorities, Problem, roles, statuses } from './domain.mjs';
import { changeTicket, createTicket, listTickets, ticketDetail, ticketsCsv } from './tickets.mjs';
import { report } from './reports.mjs';

const staticRoot = fileURLToPath(new URL('../public/', import.meta.url));
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.woff2':'font/woff2', '.png':'image/png', '.txt':'text/plain; charset=utf-8' };

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

async function jsonBody(req, origin) {
  if (req.headers.origin && req.headers.origin !== origin) throw new Problem(403, 'Запрос с другого сайта отклонён.');
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new Problem(403, 'Запрос с другого сайта отклонён.');
  if ((req.headers['content-type'] ?? '').split(';')[0].trim() !== 'application/json') {
    throw new Problem(415, 'Используйте Content-Type application/json.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32_768) throw new Problem(413, 'Слишком большой запрос.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new Problem(400, 'Ожидается JSON-объект.', 'invalid_json');
  }
}

async function staticFile(url, req, res) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { throw new Problem(400, 'Некорректная кодировка адреса.'); }
  const path = resolve(staticRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!path.startsWith(resolve(staticRoot) + sep) || !types[extname(path)]) throw new Problem(404, 'Файл не найден.');
  let content;
  try { content = await readFile(path); } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new Problem(404, 'Файл не найден.');
    throw error;
  }
  res.writeHead(200, { 'Content-Type': types[extname(path)], 'Cache-Control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : content);
}

export function makeServer({ db, demo = false, clock = Date.now, publicOrigin, secureCookie = false }) {
  const attempts = new Map();
  let lastSweep = 0;
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const now = clock();
      const origin = publicOrigin ?? ((secureCookie ? 'https://' : 'http://') + req.headers.host);
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      const method = req.method;
      if (!path.startsWith('/api/')) {
        if (method !== 'GET' && method !== 'HEAD') throw new Problem(405, 'Метод недоступен.');
        return await staticFile(url, req, res);
      }
      res.setHeader('Cache-Control', 'no-store');
      if (path === '/api/health' && method === 'GET') {
        db.prepare('SELECT 1').get();
        return json(res, 200, { status: 'ok' });
      }
      const cookie = req.headers.cookie;
      const user = currentUser(db, cookie, now);
      const body = ['POST', 'PATCH'].includes(method) ? await jsonBody(req, origin) : null;
      const profiles = () => demo ? demoProfiles(db) : [];
      const session = person => ({ mode: demo ? 'demo' : 'standard', user: person, profiles: profiles(), roles });
      const setSession = person => {
        res.setHeader('Set-Cookie', sessionCookie(db, person?.id, cookie, now, secureCookie));
        return json(res, 200, session(person));
      };
      if (path === '/api/session' && method === 'GET') return json(res, 200, session(user));
      if (path === '/api/session/demo' && method === 'POST' && demo) {
        const profile = profiles().find(item => item.id === body.profileId);
        if (!profile) throw new Problem(422, 'Выберите демонстрационный профиль.');
        return setSession(profile);
      }
      if (path === '/api/session/login' && method === 'POST' && !demo) {
        if (now - lastSweep > DAY / 24) {
          for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
          lastSweep = now;
        }
        const key = req.socket.remoteAddress;
        let entry = attempts.get(key);
        if (!entry || entry.until <= now) {
          entry = { count: 0, until: now + 15 * 60_000 };
          attempts.set(key, entry);
        }
        if (entry.count >= 10) throw new Problem(429, 'Слишком много попыток входа. Попробуйте через 15 минут.');
        entry.count++;
        const person = await authenticate(db, body.email, body.password);
        attempts.delete(key);
        return setSession(person);
      }
      if (path === '/api/session/logout' && method === 'POST') return setSession(null);
      if (!user) throw new Problem(401, 'Войдите, чтобы продолжить.', 'authentication_required');
      if (path === '/api/catalog' && method === 'GET') {
        return json(res, 200, { services: db.prepare('SELECT * FROM services ORDER BY rowid').all(), priorities, statuses });
      }
      if (path === '/api/agents' && method === 'GET') {
        if (user.role !== 'coordinator') throw new Problem(403, 'Список исполнителей доступен координатору.');
        return json(res, 200, { agents: db.prepare("SELECT id,name,unit FROM users WHERE role='specialist' ORDER BY name").all() });
      }
      if (path === '/api/summary' && method === 'GET') return json(res, 200, report(db, user, Number(url.searchParams.get('days') ?? 7), now));
      if (path === '/api/tickets' && method === 'GET') return json(res, 200, listTickets(db, user, url.searchParams, now));
      if (path === '/api/tickets' && method === 'POST') return json(res, 201, createTicket(db, user, body, now));
      if (path === '/api/export.csv' && method === 'GET') {
        const csv = ticketsCsv(listTickets(db, user, url.searchParams, now, true));
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="gosdesk-tickets.csv"' });
        return res.end(csv);
      }
      const match = /^\/api\/tickets\/(\d+)(\/comments)?$/.exec(path);
      if (match) {
        const id = Number(match[1]);
        if (!Number.isSafeInteger(id)) throw new Problem(404, 'Заявка не найдена.');
        if (!match[2] && method === 'GET') return json(res, 200, ticketDetail(db, user, id, now));
        if ((!match[2] && method === 'PATCH') || (match[2] && method === 'POST')) {
          return json(res, 200, changeTicket(db, user, id, body, now, Boolean(match[2])));
        }
      }
      throw new Problem(404, 'Адрес API не найден.', 'not_found');
    } catch (error) {
      if (!(error instanceof Problem)) console.error(error);
      json(res, error instanceof Problem ? error.status : 500, {
        error: error instanceof Problem ? error.code : 'internal_error',
        message: error instanceof Problem ? error.message : 'Сервер не смог обработать запрос.'
      });
    }
  });
}
