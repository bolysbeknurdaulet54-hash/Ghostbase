import { brand, date, dateSpan, dateTime, deadlineLabel, empty, esc, flowChart, icon, initials, listUrl,
  metric, newButton, num, pct, priorityName, roleName, sectionTitle, selectOptions, slaChart, statusBadge, statusName, ticketTable } from './ui.js';

export const pages = {
  overview: ['Сводка', 'grid-1x2'], tickets: ['Реестр заявок', 'inbox'],
  catalog: ['Каталог услуг', 'layers'], analytics: ['Аналитика', 'bar-chart-line']
};
export function shell(session, page, detail) {
  const { user } = session;
  return `<div class="workspace">
    <aside id="sidebar"><a href="#/overview" class="brand">${brand()}</a>
      <div class="side-caption">Ведомственная ИТ-служба</div>
      <nav aria-label="Навигация">${Object.entries(pages).map(([key,[label,symbol]]) =>
      `<a href="#/${key}" class="nav-link ${key===page?'active':''}" ${key===page?'aria-current="page"':''}>${icon(symbol)}${label}</a>`).join('')}</nav>
      <div class="sidebar-end"><div class="side-rule"></div><button class="account" data-account aria-label="Профиль — ${esc(user.name)}">
      <span class="avatar">${esc(initials(user.name))}</span><span><strong>${esc(user.name)}</strong><small>${roleName[user.role]}</small></span>${icon('chevron-expand')}</button></div>
    </aside>
    <button class="backdrop" aria-label="Закрыть меню" data-menu-close></button>
    <div class="main-pane"><header class="topbar"><button class="icon-button mobile-menu" data-menu aria-controls="sidebar" aria-expanded="false" aria-label="Открыть меню">${icon('list')}</button>
      <div class="crumb"><span>Рабочее пространство</span>${icon('chevron-right')}<b>${detail ? 'Карточка заявки' : pages[page]?.[0] ?? 'Страница'}</b></div>
      <div class="top-tools"><button class="quick-search" data-search>${icon('search')}<span>Найти заявку</span><kbd>/</kbd></button>
      ${session.mode === 'demo' ? `<button class="demo-label" data-account title="Сменить демонстрационный профиль"><i></i>Деморежим</button>` : ''}</div></header>
      <main id="main" tabindex="-1" aria-busy="true"></main></div></div>`;
}

export function overview(summary) {
  const c = summary.counters;
  const waiting = summary.distribution.find(x => x.status === 'waiting')?.count ?? 0;
  const formatted = date(summary.asOf,{ weekday:'long',day:'numeric',month:'long',year:'numeric' });
  return sectionTitle('Сводка службы', formatted[0].toUpperCase()+formatted.slice(1), newButton()) +
    `<div class="metrics">
    ${metric('Активные заявки', num(c.open), waiting+' в ожидании ответа','inbox','blue',listUrl({active:'1'}))}
    ${metric('Без исполнителя', num(c.unassigned), 'Из '+c.open+' активных заявок','person-plus','violet',listUrl({assignee:'unassigned'}))}
    ${metric('Просрочены', num(c.overdue), pct(c.overdue,c.open)+'% активной очереди','clock-history','orange',listUrl({deadline:'overdue'}))}
    ${metric('Решено за '+summary.days+' дн.',num(c.resolved), 'В пределах срока: '+c.met,'check2-circle','green','#/analytics?days='+summary.days)}</div>
    <div class="overview-charts">${flowChart(summary)}${slaChart(summary)}</div>
    <section class="panel table-panel"><header class="panel-head"><div><h2>Требуют внимания</h2><p>Просроченные заявки и сроки в ближайшие 24 часа</p></div>
    <a class="text-link" href="#/tickets">Весь реестр ${icon('arrow-right')}</a></header>${ticketTable(summary.attention, summary.asOf, true)}</section>`;
}

export function registry(result, params, catalog, session) {
  const p = Object.fromEntries(params);
  const services = Object.fromEntries(catalog.services.map(s => [s.id,s.name]));
  const filtered = [...params.keys()].some(key => key !== 'page' && params.get(key));
  const exportUrl = '/api/export.csv?' + params.toString();
  const pageUrl = n => listUrl({ ...p,page:n });
  const tabs = [['Все заявки',{}],['Активные',{active:'1'}],['Без исполнителя',{assignee:'unassigned'}]];
  if (session.user.role === 'specialist') tabs.push(['Назначены мне',{assignee:'mine'}]);
  const currentTab = p.assignee ? 'assignee:'+p.assignee : p.active ? 'active:1' : '';
  return sectionTitle('Реестр заявок','Поиск, назначение исполнителей и контроль сроков',newButton()) + `
    <section class="panel registry"><div class="tabs">${tabs.map(([label,scope])=>{
      const key = Object.entries(scope).flat().join(':');
      return `<a class="${currentTab===key?'selected':''}" href="${esc(listUrl({...p,active:'',assignee:'',page:1,...scope}))}">${label}</a>`;
    }).join('')}</div>
    <form id="filters"><div class="search-input">${icon('search')}<input type="search" name="q" aria-label="Поиск заявок" maxlength="150" placeholder="Номер, тема, заявитель или подразделение" value="${esc(p.q)}"><button class="search-submit" type="submit">Найти</button></div>
    <div class="filter-row"><select name="service" aria-label="Услуга">${selectOptions(services,p.service,'Все услуги')}</select>
    <select name="status" aria-label="Статус">${selectOptions(statusName,p.status,'Все статусы')}</select>
    <select name="priority" aria-label="Приоритет">${selectOptions(priorityName,p.priority,'Все приоритеты')}</select>
    <select name="deadline" aria-label="Срок">${selectOptions({overdue:'Просрочены',soon:'В ближайшие 24 ч'},p.deadline,'Любой срок')}</select>
    ${filtered ? '<a href="#/tickets" class="reset">Сбросить</a>' : ''}</div></form>
    <div class="result-bar"><strong>Найдено заявок <b>${num(result.total)}</b></strong><a class="text-link" href="${esc(exportUrl)}" download>${icon('download')}Скачать CSV</a></div>
    ${ticketTable(result.items,Date.now())}<div class="pagination"><span>Страница ${result.page} из ${Math.max(1,Math.ceil(result.total/result.pageSize))}</span>
    <div>${result.page>1?`<a class="button small" href="${esc(pageUrl(result.page-1))}">${icon('chevron-left')}Назад</a>`:''}
    ${result.page*result.pageSize<result.total?`<a class="button small" href="${esc(pageUrl(result.page+1))}">Далее${icon('chevron-right')}</a>`:''}</div></div></section>`;
}

export function catalogView(catalog) {
  return sectionTitle('Каталог услуг', 'Выберите услугу, чтобы подать заявку в ведомственную ИТ-службу.') +
    `<div class="service-grid">${catalog.services.map((s,index)=>`<article class="panel service-card">
    <div class="service-symbol tone-${index%3}">${icon(s.icon)}</div><h2>${esc(s.name)}</h2><p>${esc(s.description)}</p>
    <div class="service-sla">${icon('clock')}Обычный приоритет · ${s.baseHours} ч</div>
    <button data-new="${esc(s.id)}" class="service-action">Подать заявку ${icon('arrow-right')}</button></article>`).join('')}</div>`;
}

function breakdown(title, subtitle, rows, linked) {
  const maximum = Math.max(1,...rows.map(r=>r.count));
  return `<section class="panel ranking"><header class="panel-head"><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div></header>
    ${rows.length ? rows.map(row=>`<div class="rank-row"><div>${linked?`<a href="${esc(listUrl({active:1,service:row.id}))}">${esc(row.name)}</a>`:esc(row.unit)}<b>${num(row.count)}</b></div>
    <div class="track"><i style="width:${100*row.count/maximum}%"></i></div></div>`).join('') : empty('Пока нет обращений за период')}</section>`;
}
export function analytics(summary) {
  const { counters:c } = summary;
  return sectionTitle('Аналитика службы','Отчёт за '+dateSpan(summary)+' · календарные дни UTC') +
    `<div class="metrics">
    ${metric('Поступило',num(c.created),'За выбранный период','inbox','blue')}
    ${metric('Решено',num(c.resolved),'За выбранный период','check2-circle','green')}
    ${metric('Доля в срок',c.resolved ? pct(c.met,c.resolved)+'%' : '—',c.met+' решений из '+c.resolved,'clock','violet')}
    ${metric('Открыто сейчас',num(c.open),'Без исполнителя: '+c.unassigned,'layers','orange',listUrl({active:1}))}</div>
    <div class="overview-charts">${flowChart(summary)}${slaChart(summary)}</div>
    <div class="split">${breakdown('Нагрузка по услугам','Активные заявки на текущий момент',summary.services,true)}
    ${breakdown('Подразделения','Поступило заявок за выбранный период',summary.departments,false)}</div>`;
}

const eventLabels = { created:'Заявка зарегистрирована', assigned:'Назначен исполнитель', waiting:'Запрошено уточнение',
  in_progress:'Работа возобновлена', reopened:'Заявка возвращена в работу', resolved:'Предложено решение', closed:'Заявка закрыта', comment:'Комментарий' };
export const transitionLabels = { waiting:'Запросить уточнение', resolved:'Предложить решение', closed:'Подтвердить и закрыть', in_progress:'Вернуть в работу' };
export function detailView(model) {
  const { ticket:t, events, actions } = model;
  const controls = [
    actions.claim && `<button class="button primary" data-claim>${icon('person-check')}Взять в работу</button>`,
    actions.assign && `<button class="button ${t.assigneeId?'':'primary'}" data-assign>${icon('person-plus')}${t.assigneeId?'Сменить исполнителя':'Назначить исполнителя'}</button>`,
    ...actions.transitions.map(s=>`<button class="button ${['resolved','closed'].includes(s)?'primary':''}" data-transition="${s}">${transitionLabels[s]}</button>`)
  ].filter(Boolean).join('');
  const field = (label,value) => `<div class="detail-field"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
  return `<a class="back-link" href="#/tickets">${icon('arrow-left')}В реестр заявок</a><div class="ticket-heading">
    <div><span class="ticket-code">ГД-${t.id}</span>${statusBadge(t.status)}</div><h1>${esc(t.subject)}</h1></div>
    <div class="detail-layout"><div class="detail-body"><section class="panel pad"><h2>Описание</h2><p class="prose">${esc(t.description)}</p>${controls?'<div class="actions">'+controls+'</div>':''}</section>
    <section class="panel pad"><h2>История заявки</h2><ol class="timeline">${[...events].reverse().map(e=>`<li class="event-${esc(e.kind)}"><i></i><div>
      <strong>${esc(eventLabels[e.kind] ?? e.kind)}</strong><small>${esc(e.actorName)} · <time datetime="${new Date(e.at).toISOString()}">${esc(dateTime(e.at))}</time></small>
      ${e.detail?`<p>${esc(e.detail)}</p>`:''}</div></li>`).join('')}</ol>
      ${actions.comment?`<form id="comment" class="comment-form"><label for="comment-body">Добавить комментарий</label><textarea id="comment-body" name="body" required maxlength="2000" rows="3"></textarea>
      <div class="inline-error" role="alert"></div><button class="button" type="submit">${icon('send')}Отправить</button></form>`:''}</section></div>
    <aside class="panel pad info"><h2>Карточка заявки</h2><dl>${field('Заявитель',t.requesterName)}${field('Подразделение',t.unit)}
    ${field('Услуга',t.serviceName)}${field('Приоритет',priorityName[t.priority])}${field('Исполнитель',t.assigneeName??'Без исполнителя')}
    ${field('Зарегистрирована',dateTime(t.createdAt))}${field('Срок исполнения',dateTime(t.dueAt))}
    </dl><span class="deadline ${esc(t.deadlineState)}">${icon('clock')}${esc(deadlineLabel(t))}</span></aside></div>`;
}
