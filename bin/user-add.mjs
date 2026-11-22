import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { resolve } from 'node:path';
import { createUser } from '../src/auth.mjs';
import { openDatabase } from '../src/database.mjs';

async function readPassword() {
  if (!process.stdin.isTTY) {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    return input.replace(/\r?\n$/, '');
  }
  const muted = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  process.stderr.write('Пароль (от 12 символов, ввод скрыт): ');
  try { return await rl.question(''); } finally { rl.close(); process.stderr.write('\n'); }
}

let db;
try {
  const { values } = parseArgs({ options: {
    email: { type: 'string' }, name: { type: 'string' }, unit: { type: 'string' }, role: { type: 'string' }
  } });
  if (![values.email, values.name, values.unit, values.role].every(Boolean)) {
    throw new Error('Укажите --email, --name, --unit и --role (employee, specialist или coordinator).');
  }
  db = openDatabase({ file: resolve(process.env.GOSDESK_DB ?? 'var/gosdesk.sqlite') });
  const person = await createUser(db, { ...values, password: await readPassword() });
  console.log('Создан профиль ' + person.email);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db?.close();
}
