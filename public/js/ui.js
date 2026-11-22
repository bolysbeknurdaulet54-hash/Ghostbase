export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
})[c]);
export const icon = name => `<i class="icon i-${esc(name)}" aria-hidden="true"></i>`;
export const roleName = { employee: 'Сотрудник', specialist: 'ИТ-специалист', coordinator: 'Координатор' };
export const statusName = { new: 'Новая', in_progress: 'В работе', waiting: 'Ожидает ответа', resolved: 'Решена', closed: 'Закрыта' };
export const priorityName = { low: 'Низкий', normal: 'Обычный', high: 'Высокий' };
export const statusBadge = status => `<span class="status s-${esc(status)}"><i></i>${esc(statusName[status])}</span>`;
export const num = value => Number(value).toLocaleString('ru-RU');
export const pct = (part, total) => total ? Math.round(100 * part / total) : 0;
export const date = (at, opts = { day:'numeric', month:'short' }) => new Intl.DateTimeFormat('ru-RU', opts).format(at);
export const dateTime = at => date(at, { day:'numeric',month:'short',hour:'2-digit',minute:'2-digit' });
export const initials = name => name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
export const brand = () => '<span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><span>ГосДеск</span>';
export const empty = (title, detail = '') => `<div class="empty">${icon('inbox')}<strong>${esc(title)}</strong>${detail ? '<span>'+esc(detail)+'</span>' : ''}</div>`;
export const listUrl = (params = {}) => {
  const search = new URLSearchParams(Object.entries(params).filter(([,v]) => v !== '' && v != null)).toString();
  return '#/tickets' + (search ? '?' + search : '');
};
export const metric = (label, value, context, symbol, theme, url) => {
  const tag = url ? 'a' : 'div';
  return `<${tag} class="metric ${theme}" ${url ? 'href="'+esc(url)+'"' : ''}>
    <div class="metric-label">${esc(label)}<span class="metric-icon">${icon(symbol)}</span></div>
    <strong class="metric-number">${esc(value)}</strong><span class="metric-foot">${esc(context)}</span></${tag}>`;
};
export function deadlineLabel(ticket, now = Date.now()) {
  if (ticket.deadlineState === 'met') return 'Решена в срок';
  if (ticket.deadlineState === 'missed') return 'Решена с опозданием';
  const difference = Math.abs(ticket.dueAt - now);
  const minutes = Math.max(1, Math.ceil(difference / 60_000));
  const span = minutes < 60 ? minutes + ' мин' : (minutes < 48 * 60 ? Math.ceil(minutes / 60) + ' ч' : Math.ceil(minutes / 1440) + ' дн.');
  return ticket.deadlineState === 'overdue' ? 'Просрочена на ' + span : 'Осталось ' + span;
}
export function dateSpan(summary) {
  const opts = { day:'numeric', month:'short', timeZone:'UTC' };
  return date(summary.start, opts) + ' — ' + date(summary.asOf, opts);
}
export function periodControl(days, options = [7,14,30]) {
  return '<div class="segmented" aria-label="Отчётный период">' + options.map(value =>
    `<button type="button" data-days="${value}" aria-pressed="${days === value}">${value} дн.</button>`).join('') + '</div>';
}
export function flowChart(summary, periods = [7,14,30]) {
  const maximum = Math.max(3, ...summary.daily.flatMap(d => [d.created, d.resolved]));
  const step = Math.max(1, Math.ceil(maximum / 3));
  const ceiling = step * 3;
  const points = summary.daily.map((d, index) => {
    const label = date(d.at, { day:'numeric', month:'short', timeZone:'UTC' });
    const accessible = `${label}. Поступило: ${d.created}. Решено: ${d.resolved}.`;
    const tick = summary.days <= 7 ? date(d.at, { weekday:'short',timeZone:'UTC' }) : date(d.at, { day:'numeric',timeZone:'UTC' });
    const show = summary.days < 15 || index % 5 === 0 || index === summary.daily.length - 1;
    return `<div class="day" tabindex="0" aria-label="${esc(accessible)}" data-tip="${esc(label+' · '+d.created+' / '+d.resolved)}">
      <div class="pair"><i class="bar received" style="height:${100*d.created/ceiling}%"></i><i class="bar done" style="height:${100*d.resolved/ceiling}%"></i></div>
      <span class="tick">${show ? esc(tick) : ''}</span></div>`;
  }).join('');
  return `<section class="panel flow"><header class="panel-head"><div><h2>Динамика заявок</h2><p>${esc(dateSpan(summary))} · UTC</p></div>${periodControl(summary.days, periods)}</header>
    <div class="chart"><div class="y-axis">${[ceiling,2*step,step,0].map(n=>'<span>'+n+'</span>').join('')}</div>
    <div class="plot"><div class="grid-lines"><i></i><i></i><i></i><i></i></div><div class="days">${points}</div></div></div>
    <div class="legend"><span><i class="swatch blue"></i>Поступило</span><span><i class="swatch mint"></i>Решено</span></div></section>`;
}
export function slaChart(summary) {
  const { resolved, met } = summary.counters;
  const percent = pct(met, resolved);
  return `<section class="panel sla-panel"><header class="panel-head"><div><h2>Соблюдение сроков</h2><p>Решения за ${summary.days} дн.</p></div><span class="panel-icon">${icon('clock-history')}</span></header>
    <div class="ring-area"><div class="ring" style="--ratio:${percent}%;--ring-rest:${resolved ? 'var(--peach)' : 'var(--line)'}">
      <div><strong>${resolved ? percent+'<small>%</small>' : '—'}</strong><span>${resolved ? 'в срок' : 'нет решений'}</span></div></div></div>
    <div class="sla-legend"><div><span><i class="swatch teal"></i>В срок</span><b>${met}</b></div>
    <div><span><i class="swatch peach"></i>С опозданием</span><b>${resolved-met}</b></div></div></section>`;
}
export function ticketTable(items, now, compact = false) {
  if (!items.length) return empty(compact ? 'Очередь внимания пуста' : 'Заявок не найдено', compact ? 'Здесь появятся заявки с просроченным сроком или сроком в ближайшие сутки.' : 'Попробуйте изменить фильтры или подайте новую заявку.');
  return `<div class="table-scroll" tabindex="0" aria-label="Таблица заявок"><table class="tickets-table ${compact?'compact':''}"><thead><tr>
    <th>Заявка</th>${compact ? '' : '<th>Исполнитель</th>'}<th>Статус</th><th>Срок исполнения</th><th aria-label="Открыть"></th>
    </tr></thead><tbody>${items.map(t=>`<tr>
    <td><a class="subject" href="#/tickets/${t.id}"><span class="ticket-code">ГД-${t.id}</span><strong>${esc(t.subject)}</strong></a>
    <span class="row-sub">${esc(t.unit)} · ${esc(t.serviceName)}</span></td>
    ${compact ? '' : '<td class="assignee">'+esc(t.assigneeName ?? 'Без исполнителя')+'</td>'}
    <td>${statusBadge(t.status)}</td><td><span class="deadline ${esc(t.deadlineState)}">${icon(t.deadlineState === 'overdue' ? 'exclamation-triangle' : 'clock')}${esc(deadlineLabel(t, now))}</span></td>
    <td><a class="row-link" href="#/tickets/${t.id}" aria-label="Открыть ГД-${t.id}">${icon('chevron-right')}</a></td></tr>`).join('')}</tbody></table></div>`;
}
export function selectOptions(values, current, first = '') {
  return (first ? `<option value="">${esc(first)}</option>` : '') + Object.entries(values).map(([key,value]) =>
    `<option value="${esc(key)}" ${key === current ? 'selected' : ''}>${esc(value)}</option>`).join('');
}
export function sectionTitle(title, subtitle, action = '') {
  return `<div class="page-head"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>${action}</div>`;
}
export const newButton = () => `<button class="button primary" data-new>${icon('plus-lg')}Новая заявка</button>`;
