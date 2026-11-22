import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY,HOUR } from '../src/domain.mjs';
import { fixture,initialTime,sample } from './support.mjs';

test('полный цикл: регистрация, назначение, уточнение, ответ, решение и подтверждение', async t=>{
  const app = await fixture(t);
  let [employee,specialist,coordinator] = await Promise.all([3,2,1].map(app.profile));
  const created = await employee('/api/tickets','POST',sample);
  assert.equal(created.status,201);
  const path='/api/tickets/'+created.data.ticket.id;
  const originalDeadline=initialTime+12*HOUR;
  assert.equal(created.data.ticket.dueAt,originalDeadline);
  assert.equal(created.data.ticket.status,'new');
  const assign=await coordinator(path,'PATCH',{version:1,action:'assign',assigneeId:2});
  assert.equal(assign.data.ticket.status,'in_progress');
  assert.equal(assign.data.ticket.assigneeName,'Илья Морозов');
  const waiting=await specialist(path,'PATCH',{version:2,action:'transition',status:'waiting',note:'Уточните отдел.'});
  assert.equal(waiting.data.ticket.status,'waiting');
  app.advance(13*HOUR);
  [employee,specialist] = await Promise.all([3,2].map(app.profile));
  const comment=await employee(path+'/comments','POST',{version:3,body:'Отдел обращений граждан.'});
  assert.equal(comment.data.ticket.deadlineState,'overdue');
  const reply=await employee(path,'PATCH',{version:4,action:'transition',status:'in_progress',note:'Кабинет 24, можно подключаться.'});
  assert.equal(reply.data.ticket.status,'in_progress');
  const solved=await specialist(path,'PATCH',{version:5,action:'transition',status:'resolved',note:'Новый сертификат установлен.'});
  assert.equal(solved.data.ticket.deadlineState,'missed');
  const closed=await employee(path,'PATCH',{version:6,action:'transition',status:'closed'});
  assert.equal(closed.data.ticket.closedAt,initialTime+13*HOUR);
  assert.deepEqual(closed.data.events.map(e=>e.kind),['created','assigned','waiting','comment','in_progress','resolved','closed']);
  assert.equal(closed.data.actions.comment,false);
  assert.equal((await employee(path+'/comments','POST',{version:7,body:'Ещё одно изменение'})).status,403);
});

test('повторное открытие сохраняет срок и обе записи о решении', async t=>{
  const app=await fixture(t);
  const employee=await app.profile(3);
  const specialist=await app.profile(2);
  const path='/api/tickets/'+(await employee('/api/tickets','POST',sample)).data.ticket.id;
  await specialist(path,'PATCH',{action:'claim',version:1});
  await specialist(path,'PATCH',{action:'transition',status:'resolved',note:'Проверка пройдена.',version:2});
  const before=(await employee('/api/summary')).data;
  assert.equal((await employee(path,'PATCH',{action:'transition',status:'in_progress',version:3})).status,422);
  const reopened=await employee(path,'PATCH',{action:'transition',status:'in_progress',note:'Проблема повторилась.',version:3});
  assert.equal(reopened.data.ticket.resolvedAt,null);
  assert.equal(reopened.data.ticket.dueAt,initialTime+12*HOUR);
  app.advance(HOUR);
  const solved=await specialist(path,'PATCH',{action:'transition',status:'resolved',note:'Исправлена цепочка сертификатов.',version:4});
  assert.equal(solved.data.events.filter(e=>e.kind==='resolved').length,2);
  const after=(await employee('/api/summary')).data;
  assert.equal(after.counters.resolved,before.counters.resolved+1);
  assert.equal(after.counters.met,before.counters.met+1);
});

test('две заявки на изменение одной версии дают один коммит и один конфликт', async t=>{
  const app=await fixture(t);
  const employee=await app.profile(3);
  const path='/api/tickets/'+(await employee('/api/tickets','POST',sample)).data.ticket.id;
  const results=await Promise.all(['Первое уточнение','Второе уточнение'].map(body=>employee(path+'/comments','POST',{version:1,body})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal(results.find(r=>r.status===409).data.error,'version_conflict');
  const latest=(await employee(path)).data;
  assert.equal(latest.ticket.version,2);
  assert.equal(latest.events.length,2);
});

test('ошибочное изменение откатывает карточку и журнал',async t=>{
  const app=await fixture(t);
  const coordinator=await app.profile(1);
  const path='/api/tickets/'+(await coordinator('/api/tickets','POST',sample)).data.ticket.id;
  assert.equal((await coordinator(path,'PATCH',{version:1,action:'assign',assigneeId:3})).status,422);
  assert.equal((await coordinator(path,'PATCH',{version:1,action:'transition',status:'closed'})).status,403);
  assert.equal((await coordinator(path,'PATCH',{action:'assign',assigneeId:2})).status,422);
  assert.equal((await coordinator(path)).data.ticket.version,1);
  assert.equal((await coordinator(path)).data.events.length,1);
});

test('сотрудник и специалист видят только свою область, включая отчёт и экспорт',async t=>{
  const app=await fixture(t);
  const [employee,specialist,coordinator]=await Promise.all([3,2,1].map(app.profile));
  const path='/api/tickets/'+(await coordinator('/api/tickets','POST',{...sample,subject:'Внутренняя заявка координатора'})).data.ticket.id;
  assert.equal((await employee(path)).status,404);
  assert.equal((await employee('/api/agents')).status,403);
  assert.equal((await employee('/api/tickets?q=Внутренняя')).data.total,0);
  assert.doesNotMatch((await employee('/api/export.csv')).data,/Внутренняя заявка координатора/);
  assert.equal((await specialist(path)).status,200);
  await coordinator(path,'PATCH',{version:1,action:'assign',assigneeId:4});
  assert.equal((await specialist(path)).status,404);
  assert.equal((await specialist(path+'/comments','POST',{version:2,body:'Привет'})).status,404);
  assert.doesNotMatch((await specialist('/api/export.csv')).data,/Внутренняя заявка координатора/);
  const mine=(await employee('/api/summary')).data;
  assert.equal(mine.counters.open,(await employee('/api/tickets?active=1')).data.total);
  assert.deepEqual(mine.departments.map(d=>d.unit),['Отдел обращений граждан']);
  assert.ok(mine.attention.every(row=>row.requesterId===3));
});

test('поиск учитывает кириллицу, номер заявки, фильтры и границы страниц',async t=>{
  const app=await fixture(t);
  const coordinator=await app.profile(1);
  const created=(await coordinator('/api/tickets','POST',{...sample,subject:'Уникальная тестовая подпись'})).data.ticket;
  const search=await coordinator('/api/tickets?q=уНИКАЛЬНАЯ&priority=high&service=signature&status=new');
  assert.equal(search.data.total,1);
  assert.equal(search.data.items[0].id,created.id);
  assert.equal((await coordinator('/api/tickets?q=ГД-'+created.id)).data.total,1);
  assert.equal((await coordinator('/api/tickets?q=уникальная&priority=low')).data.total,0);
  assert.equal((await coordinator('/api/tickets?q=%25')).data.total,0);
  const first=(await coordinator('/api/tickets')).data;
  const last=(await coordinator('/api/tickets?page=9900')).data;
  assert.equal(first.items.length,10);
  assert.equal(last.page,Math.ceil(first.total/10));
  assert.equal((await coordinator('/api/tickets?page=-1')).status,422);
});

test('CSV сохраняет отбор, экранирует кавычки и текстовые формулы',async t=>{
  const app=await fixture(t);
  const employee=await app.profile(3);
  await employee('/api/tickets','POST',{...sample,subject:'=SUM(2;3) "Проверка"'});
  const csv=await employee('/api/export.csv?q=SUM');
  assert.equal(csv.status,200);
  assert.match(csv.headers.get('content-type'),/text\/csv/);
  assert.match(csv.data,/"'=SUM\(2;3\) ""Проверка"""/);
  assert.equal(csv.data.trimEnd().split('\r\n').length,2);
});

test('граница срока, переход суток UTC и период отчёта согласованы с реестром',async t=>{
  const app=await fixture(t);
  let employee=await app.profile(3);
  const ticket=(await employee('/api/tickets','POST',sample)).data.ticket;
  const path='/api/tickets/'+ticket.id;
  app.advance(12*HOUR);
  employee=await app.profile(3);
  assert.equal((await employee(path)).data.ticket.deadlineState,'soon');
  const q='&q=ГД-'+ticket.id;
  assert.equal((await employee('/api/tickets?deadline=soon'+q)).data.total,1);
  app.advance(1);
  assert.equal((await employee(path)).data.ticket.deadlineState,'overdue');
  assert.equal((await employee('/api/tickets?deadline=overdue'+q)).data.total,1);
  for (const days of [7,14,30]) {
    const report=(await employee('/api/summary?days='+days)).data;
    assert.equal(report.daily.length,days);
    assert.equal(report.start % DAY,0);
    assert.equal(report.counters.created,report.daily.reduce((v,d)=>v+d.created,0));
    assert.equal(report.counters.resolved,report.daily.reduce((v,d)=>v+d.resolved,0));
    assert.equal(report.counters.open,report.services.reduce((v,s)=>v+s.count,0));
  }
  assert.equal((await employee('/api/summary?days=5')).status,422);
});

test('повторная регистрация с одним ключом даёт одну заявку и одну запись в журнале',async t=>{
  const app=await fixture(t);
  const [employee,coordinator]=await Promise.all([3,1].map(app.profile));
  const input={...sample,requestKey:'repeatable-demo-request-01'};
  const send=()=>employee('/api/tickets','POST',input);
  const [first,second]=await Promise.all([send(),send()]);
  assert.equal(first.status,201);
  assert.equal(second.status,201);
  assert.equal(first.data.ticket.id,second.data.ticket.id);
  assert.equal(second.data.events.length,1);
  assert.equal(first.data.ticket.requestKey,undefined);
  const conflict=await employee('/api/tickets','POST',{...input,subject:'Другая тема заявки'});
  assert.equal(conflict.status,409);
  assert.equal(conflict.data.error,'request_key_conflict');
  const other=await coordinator('/api/tickets','POST',input);
  assert.notEqual(first.data.ticket.id,other.data.ticket.id);
});

test('сроки по каталогу и приоритету рассчитываются на сервере, автор определяется сессией',async t=>{
  const app=await fixture(t);
  const employee=await app.profile(3);
  const {services}=(await employee('/api/catalog')).data;
  for (const service of services) {
    for (const [priority,factor] of Object.entries({low:2,normal:1,high:0.5})) {
      const result=await employee('/api/tickets','POST',{...sample,serviceId:service.id,priority,requesterId:1,dueAt:0});
      assert.equal(result.status,201);
      assert.equal(result.data.ticket.dueAt,initialTime+service.baseHours*HOUR*factor);
      assert.equal(result.data.ticket.requesterId,3);
    }
  }
  for (const invalid of [{serviceId:'other'},{priority:'other'},{subject:'а'},{description:'мало'},{requestKey:'x'}]) {
    assert.equal((await employee('/api/tickets','POST',{...sample,...invalid})).status,422);
  }
});

test('переназначение сохраняет ожидание, историю и первоначальный срок',async t=>{
  const app=await fixture(t);
  const [coordinator,specialist]=await Promise.all([1,2].map(app.profile));
  const initial=(await coordinator('/api/tickets','POST',sample)).data.ticket;
  const path='/api/tickets/'+initial.id;
  await specialist(path,'PATCH',{version:1,action:'claim'});
  await specialist(path,'PATCH',{version:2,action:'transition',status:'waiting',note:'Назовите отдел.'});
  const updated=await coordinator(path,'PATCH',{version:3,action:'assign',assigneeId:4});
  assert.equal(updated.data.ticket.status,'waiting');
  assert.equal(updated.data.ticket.dueAt,initial.dueAt);
  assert.equal(updated.data.events.at(-1).detail,'Ольга Белова');
  assert.equal((await specialist(path)).status,404);
});
