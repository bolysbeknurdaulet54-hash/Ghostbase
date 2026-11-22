import { resolve } from 'node:path';
import { openDatabase } from '../src/database.mjs';
import { makeServer } from '../src/http.mjs';

const demo = process.argv.includes('--demo');
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3000);
const file = resolve(process.env.GOSDESK_DB ?? ('var/' + (demo ? 'demo' : 'gosdesk') + '.sqlite'));
const db = openDatabase({ file, demo });
const server = makeServer({ db, demo, publicOrigin: process.env.GOSDESK_ORIGIN,
  secureCookie: process.env.GOSDESK_SECURE_COOKIE === '1' });
server.on('error', error => { console.error(error.message); db.close(); process.exitCode = 1; });
server.listen(port, host, () => {
  console.log(`ГосДеск · ${demo ? 'деморежим' : 'рабочий режим'} · http://${host}:${server.address().port}`);
});
function shutdown() { server.close(() => db.close()); }
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
