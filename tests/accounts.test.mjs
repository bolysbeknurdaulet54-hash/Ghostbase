import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUser } from '../src/auth.mjs';
import { openDatabase } from '../src/database.mjs';
import { HOUR } from '../src/domain.mjs';
import { createTicket } from '../src/tickets.mjs';
import { fixture,initialTime,sample } from './support.mjs';

const account = {name:'Тестовый сотрудник',email:'employee@gosdesk.example',unit:'Тестовое подразделение',role:'employee',password:'example-for-tests-only'};

test('рабочий режим начинается с пустого реестра и требует входа',async t=>{
  const app=await fixture(t,{demo:false});
  const info=await app.request('/api/session');
  assert.deepEqual(info.data.profiles,[]);
  assert.equal(info.data.mode,'standard');
  assert.equal(info.data.user,null);
  for (const path of ['/api/catalog','/api/tickets','/api/export.csv','/api/summary','/api/agents']) {
    assert.equal((await app.request(path)).status,401);
  }
  assert.equal((await app.request('/api/session/demo',{method:'POST',body:{profileId:1}})).status,401);
  await createUser(app.db,account);
  const login=await app.request('/api/session/login',{method:'POST',body:{email:account.email.toUpperCase(),password:account.password}});
  assert.equal(login.status,200);
  assert.equal(login.data.user.passwordHash,undefined);
  assert.match(login.headers.get('set-cookie'),/HttpOnly/);
  assert.match(login.headers.get('set-cookie'),/SameSite=Strict/);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await app.request('/api/tickets',{cookie})).data.total,0);
  const summary=(await app.request('/api/summary',{cookie})).data;
  assert.equal(summary.counters.resolved,0);
  assert.equal(summary.counters.open,0);
  assert.equal(summary.services.length,6);
  assert.ok(summary.daily.every(d=>d.created===0 && d.resolved===0));
  await app.request('/api/session/logout',{method:'POST',body:{},cookie});
  assert.equal((await app.request('/api/tickets',{cookie})).status,401);
});

test('сессии хранятся в виде хеша, смена профиля отзывает старую сессию, срок — восемь часов',async t=>{
  const app=await fixture(t);
  const first=await app.request('/api/session/demo',{method:'POST',body:{profileId:1}});
  const old=first.headers.get('set-cookie').split(';')[0];
  const hash=app.db.prepare('SELECT tokenHash FROM sessions').get().tokenHash;
  assert.notEqual(hash,old.split('=')[1]);
  const next=await app.request('/api/session/demo',{method:'POST',body:{profileId:3},cookie:old});
  const cookie=next.headers.get('set-cookie').split(';')[0];
  assert.equal((await app.request('/api/tickets',{cookie:old})).status,401);
  assert.equal((await app.request('/api/session',{cookie})).data.user.role,'employee');
  app.advance(8*HOUR);
  assert.equal((await app.request('/api/tickets',{cookie})).status,401);
});

test('новый профиль проверяет роль, пароль и уникальность нормализованной почты',async t=>{
  const {db}=await fixture(t,{demo:false});
  await assert.rejects(createUser(db,{...account,role:'unknown'}),e=>e.status===422);
  await assert.rejects(createUser(db,{...account,password:'short'}),e=>e.status===422);
  await createUser(db,account);
  await assert.rejects(createUser(db,{...account,email:account.email.toUpperCase()}),e=>e.status===409);
  assert.notEqual(db.prepare('SELECT passwordHash FROM users').get().passwordHash,account.password);
});

test('вход ограничивает частоту попыток на адрес и снимает ограничение после окна',async t=>{
  const app=await fixture(t,{demo:false});
  await createUser(app.db,account);
  for(let i=0;i<10;i++) {
    assert.equal((await app.request('/api/session/login',{method:'POST',body:{email:account.email,password:'wrong'}})).status,401);
  }
  const login=()=>app.request('/api/session/login',{method:'POST',body:{email:account.email,password:account.password}});
  assert.equal((await login()).status,429);
  app.advance(15*60_000);
  assert.equal((await login()).status,200);
});

test('изменения из постороннего origin отклоняются, формат и размер тела проверяются',async t=>{
  const app=await fixture(t);
  const options={method:'POST',body:{profileId:1}};
  assert.equal((await app.request('/api/session/demo',{...options,headers:{Origin:'https://other.example'}})).status,403);
  assert.equal((await app.request('/api/session/demo',{...options,headers:{Origin:app.url}})).status,200);
  const raw=body=>fetch(app.url+'/api/session/demo',{method:'POST',headers:{'Content-Type':'application/json'},body});
  assert.equal((await raw('{')).status,400);
  assert.equal((await raw('[]')).status,400);
  assert.equal((await raw(JSON.stringify({value:'а'.repeat(20000)}))).status,413);
  assert.equal((await fetch(app.url+'/api/session/demo',{method:'POST',body:'profileId=1'})).status,415);
});

test('файловая база сохраняет данные после перезапуска и отделяет рабочие профили от демонстрационных',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'gosdesk-db-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'data.sqlite');
  let db=openDatabase({file});
  const user=await createUser(db,account);
  const created=createTicket(db,user,sample,initialTime);
  db.close();
  assert.throws(()=>openDatabase({file,demo:true}),/режим/);
  db=openDatabase({file});
  assert.equal(db.prepare('SELECT subject FROM tickets WHERE id=?').get(created.ticket.id).subject,sample.subject);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM services').get().count,6);
  db.close();
  const demoFile=join(dir,'demo.sqlite');
  openDatabase({file:demoFile,demo:true}).close();
  db=openDatabase({file:demoFile,demo:true});
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tickets').get().count,48);
  db.close();
  assert.throws(()=>openDatabase({file:demoFile}),/режим/);
});
