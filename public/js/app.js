import { brand, esc, icon, initials, listUrl, priorityName, roleName, selectOptions } from './ui.js';
import { analytics, catalogView, detailView, overview, pages, registry, shell, transitionLabels } from './views.js';

const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
let session;
let catalog;
let currentTicket;
let renderVersion = 0;
let toastTimer;

async function api(path, method = 'GET', data) {
  const options = { method, credentials:'same-origin' };
  if (data !== undefined) {
    options.headers = { 'Content-Type':'application/json' };
    options.body = JSON.stringify(data);
  }
  const response = await fetch('/api'+path, options);
  const value = await response.json();
  if (!response.ok) {
    const error = new Error(value.message || 'Не удалось выполнить запрос.');
    error.status = response.status;
    error.code = value.error;
    throw error;
  }
  return value;
}
function toast(message) {
  const box = document.querySelector('#toast');
  box.textContent = message;
  box.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>box.classList.remove('visible'),3500);
}
function showDialog(title, body) {
  if (dialog.open) dialog.close();
  dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2>
    <button type="button" class="icon-button" data-close aria-label="Закрыть">${icon('x-lg')}</button></div>${body}`;
  dialog.showModal();
  const first = dialog.querySelector('[autofocus], input:not([type=hidden]), textarea, select');
  if (first) first.focus();
}
function navigation(hash) {
  if (hash === location.hash) return render();
  location.hash = hash;
}
function setMenu(open) {
  app.classList.toggle('menu-open',open);
  app.querySelector('[data-menu]')?.setAttribute('aria-expanded',String(open));
}
function readRoute() {
  const [path, query = ''] = (location.hash.replace(/^#\/?/, '') || 'overview').split('?');
  const [page,id] = path.split('/');
  return { page, id, params:new URLSearchParams(query) };
}
function errorScreen(message) {
  return `<div class="panel error-panel"><h2>Не удалось открыть страницу</h2><p>${esc(message)}</p>
    <button data-retry class="button">Обновить</button> <a href="#/overview" class="text-link">Перейти к сводке</a></div>`;
}
async function render() {
  const version = ++renderVersion;
  const { page,id,params } = readRoute();
  if (!session?.user) return;
  if (dialog.open) dialog.close();
  currentTicket = null;
  app.innerHTML = shell(session, page, id);
  const main = app.querySelector('main');
  main.innerHTML = '<div class="loading" role="status">Загружаем данные…</div>';
  document.title = (id ? 'Карточка заявки' : pages[page]?.[0] ?? 'Страница') + ' · ГосДеск';
  try {
    let content;
    const days = Number(params.get('days') ?? 7);
    if (page === 'overview' || page === 'analytics') {
      const summary = await api('/summary?days='+encodeURIComponent(days));
      content = page === 'overview' ? overview(summary) : analytics(summary);
    } else if (page === 'tickets' && id && /^\d+$/.test(id)) {
      const model = await api('/tickets/'+id);
      if (version !== renderVersion) return;
      currentTicket = model;
      document.title = 'ГД-'+model.ticket.id+' · ГосДеск';
      content = detailView(model);
    } else if (page === 'tickets' && !id) {
      const result = await api('/tickets?'+params.toString());
      content = registry(result,params,catalog,session);
    } else if (page === 'catalog' && !id) {
      content = catalogView(catalog);
    } else {
      content = errorScreen('Адрес страницы не найден.');
    }
    if (version !== renderVersion) return;
    main.innerHTML = content;
    window.scrollTo(0,0);
  } catch (error) {
    if (version !== renderVersion) return;
    if (error.status === 401) return boot();
    main.innerHTML = errorScreen(error.message);
  } finally {
    main.setAttribute('aria-busy','false');
  }
}

function loginScreen() {
  app.innerHTML = `<main class="auth-screen"><div class="auth-wrap"><div class="brand">${brand()}</div>
    <form id="login" class="panel pad form"><h1>Вход в ГосДеск</h1><p>Используйте учётную запись ведомственной ИТ-службы.</p>
    <label>Служебная почта<input name="email" type="email" autocomplete="username" maxlength="254" required></label>
    <label>Пароль<input name="password" type="password" autocomplete="current-password" maxlength="256" required></label>
    <div class="inline-error" role="alert"></div><button class="button primary">Войти</button></form></div></main>`;
}
async function boot() {
  if (dialog.open) dialog.close();
  try {
    session = await api('/session');
    if (!session.user && session.mode === 'demo') session = await api('/session/demo','POST',{profileId:session.profiles[0].id});
    if (!session.user) return loginScreen();
    catalog = await api('/catalog');
    await render();
  } catch (error) {
    app.innerHTML = '<main class="startup">'+errorScreen(error.message)+'</main>';
  }
}
function footer(submit) {
  return `<div class="inline-error" role="alert"></div><div class="dialog-footer">
    <button type="button" class="button" data-close>Отмена</button><button class="button primary" type="submit">${esc(submit)}</button></div>`;
}
function newTicket(serviceId = '') {
  const services = Object.fromEntries(catalog.services.map(s=>[s.id,s.name]));
  const key = Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
  showDialog('Новая заявка',`<form id="new-ticket" class="form"><input type="hidden" name="requestKey" value="${key}">
    <label>Услуга<select name="serviceId" aria-label="Услуга" required>${selectOptions(services,serviceId,'Выберите услугу')}</select></label>
    <label>Тема<input name="subject" minlength="5" maxlength="150" required placeholder="Кратко опишите запрос"></label>
    <label>Описание<textarea name="description" rows="4" minlength="10" maxlength="4000" required placeholder="Что произошло и какой результат нужен?"></textarea></label>
    <label>Приоритет<select name="priority" aria-label="Приоритет">${selectOptions(priorityName,'normal')}</select></label>
    <div class="form-hint" id="sla-hint" aria-live="polite"></div>${footer('Зарегистрировать')}</form>`);
  updateSlaHint();
}
function updateSlaHint() {
  const form = document.querySelector('#new-ticket');
  const service = catalog.services.find(s=>s.id === form.elements.serviceId.value);
  const factor = {low:2,normal:1,high:0.5}[form.elements.priority.value];
  document.querySelector('#sla-hint').textContent = service ? 'Срок исполнения с момента регистрации: '+service.baseHours*factor+' ч.' : '';
}
function account() {
  const user = session.user;
  if (session.mode === 'demo') {
    showDialog('Демонстрационные профили',`<p class="dialog-intro">Выберите роль, чтобы увидеть её очередь и доступные действия.</p>
      <div class="profiles">${session.profiles.map(p=>`<button class="profile ${p.id===user.id?'selected':''}" data-profile="${p.id}">
      <span class="avatar">${esc(initials(p.name))}</span><span><strong>${esc(p.name)}</strong><small>${roleName[p.role]} · ${esc(p.unit)}</small></span>
      ${p.id===user.id?icon('check2'):icon('chevron-right')}</button>`).join('')}</div><div class="inline-error" role="alert"></div>`);
  } else {
    showDialog('Ваш профиль',`<div class="profile-info"><strong>${esc(user.name)}</strong><p>${roleName[user.role]} · ${esc(user.unit)}</p><p>${esc(user.email)}</p></div>
      <div class="inline-error" role="alert"></div><button class="button" data-logout>${icon('box-arrow-right')}Выйти</button>`);
  }
}
function searchDialog() {
  showDialog('Найти заявку',`<form id="quick-search" class="form"><label>Номер, тема, заявитель или подразделение
    <input type="search" name="q" maxlength="150" autofocus required placeholder="Например, электронная подпись"></label>${footer('Найти')}</form>`);
}
async function assignment() {
  const { agents } = await api('/agents');
  const t = currentTicket?.ticket;
  if (!t) return;
  const choices = Object.fromEntries(agents.filter(a=>a.id !== t.assigneeId).map(a=>[a.id,a.name]));
  if (!Object.keys(choices).length) return toast('Нет доступных специалистов для назначения.');
  showDialog('Назначить исполнителя',`<form id="assign" class="form"><label>ИТ-специалист<select name="assigneeId" aria-label="ИТ-специалист" required>
    ${selectOptions(choices,'','Выберите специалиста')}</select></label>${footer('Назначить')}</form>`);
}
function transitionDialog(status) {
  const t = currentTicket.ticket;
  const required = ['resolved','waiting'].includes(status) || (status==='in_progress' &&
    (t.status==='resolved' || (t.requesterId===session.user.id && t.assigneeId!==session.user.id && session.user.role!=='coordinator')));
  const label = ({resolved:'Как решена заявка?',waiting:'Что нужно уточнить?',closed:'Комментарий',in_progress:'Пояснение'})[status];
  showDialog(transitionLabels[status],`<form id="transition" class="form" data-status="${esc(status)}"><label>${label}${required?'':' (необязательно)'}
    <textarea rows="4" name="note" ${required?'required minlength="3"':''} maxlength="2000"></textarea></label>${footer('Сохранить')}</form>`);
}
async function updateTicket(action, comment = false) {
  const id = currentTicket.ticket.id;
  const version = currentTicket.ticket.version;
  const model = await api('/tickets/'+id+(comment?'/comments':''),comment?'POST':'PATCH',{...action,version});
  if (currentTicket?.ticket.id !== id) return;
  currentTicket = model;
  if (dialog.open) dialog.close();
  document.querySelector('#main').innerHTML = detailView(model);
  toast(comment ? 'Комментарий добавлен' : 'Карточка обновлена');
}
function filter(form) {
  const { params } = readRoute();
  for (const [k,v] of new FormData(form)) {
    if (String(v).trim()) params.set(k,String(v).trim()); else params.delete(k);
  }
  params.delete('page');
  navigation(listUrl(Object.fromEntries(params)));
}
function displayError(parent, error) {
  if (error.code === 'authentication_required') { boot(); return; }
  const box = parent?.querySelector('.inline-error');
  if (box) box.innerHTML = esc(error.message) + (error.code==='version_conflict'?' <button type="button" class="text-button" data-refresh>Обновить карточку</button>':'');
  else toast(error.message);
}
document.addEventListener('submit',async event=>{
  event.preventDefault();
  const form = event.target;
  const submit = form.querySelector('button[type=submit], button.primary');
  if (submit?.disabled) return;
  if (submit) submit.disabled = true;
  const values = Object.fromEntries(new FormData(form));
  try {
    if (form.id === 'login') {
      session = await api('/session/login','POST',values);
      catalog = await api('/catalog');
      await render();
    } else if (form.id === 'new-ticket') {
      const result = await api('/tickets','POST',values);
      dialog.close();
      navigation('#/tickets/'+result.ticket.id);
      toast('Заявка ГД-'+result.ticket.id+' зарегистрирована');
    } else if (form.id === 'quick-search') {
      dialog.close();
      navigation(listUrl({q:values.q.trim()}));
    } else if (form.id === 'filters') filter(form);
    else if (form.id === 'comment') await updateTicket({body:values.body},true);
    else if (form.id === 'assign') await updateTicket({action:'assign',assigneeId:Number(values.assigneeId)});
    else if (form.id === 'transition') await updateTicket({action:'transition',status:form.dataset.status,note:values.note});
  } catch (error) { displayError(form,error); }
  finally { if (submit) submit.disabled = false; }
});
document.addEventListener('change',event=>{
  const form = event.target.form;
  if (form?.id === 'filters' && event.target.tagName==='SELECT') filter(form);
  if (form?.id === 'new-ticket') updateSlaHint();
});
document.addEventListener('click',async event=>{
  const btn = event.target.closest('button,a.skip');
  if (!btn) return;
  const data = btn.dataset;
  try {
    if (btn.classList.contains('skip')) { event.preventDefault(); document.querySelector('main')?.focus(); }
    else if ('menu' in data) setMenu(true);
    else if ('menuClose' in data) setMenu(false);
    else if ('close' in data) dialog.close();
    else if ('account' in data) { setMenu(false); account(); }
    else if ('search' in data) searchDialog();
    else if ('new' in data) newTicket(data.new);
    else if ('days' in data) navigation('#/'+readRoute().page+'?days='+data.days);
    else if ('retry' in data) await boot();
    else if ('refresh' in data) await render();
    else if ('assign' in data) await assignment();
    else if ('transition' in data) transitionDialog(data.transition);
    else if ('claim' in data) { btn.disabled=true; await updateTicket({action:'claim'}); }
    else if ('profile' in data) {
      btn.disabled=true;
      session = await api('/session/demo','POST',{profileId:Number(data.profile)});
      dialog.close();
      navigation('#/overview');
      toast('Профиль: '+roleName[session.user.role]);
    } else if ('logout' in data) {
      await api('/session/logout','POST',{});
      dialog.close();
      await boot();
    }
  } catch (error) {
    if (error.status===409 && !dialog.open) { await render(); toast(error.message); }
    else displayError(dialog.open?dialog:null,error);
  } finally { if (btn.tagName === 'BUTTON') btn.disabled=false; }
});
dialog.addEventListener('click',e=>{
  if (e.target!==dialog) return;
  const rect=dialog.getBoundingClientRect();
  if (e.clientX<rect.left || e.clientX>rect.right || e.clientY<rect.top || e.clientY>rect.bottom) dialog.close();
});
document.addEventListener('keydown',event=>{
  if (event.key==='Escape') setMenu(false);
  if (event.key==='/' && session?.user && !dialog.open && !event.ctrlKey && !event.metaKey &&
      !event.target.closest('input,textarea,select,[contenteditable]')) {
    event.preventDefault(); searchDialog();
  }
});
window.addEventListener('hashchange',()=>{ setMenu(false); render(); });
boot();
