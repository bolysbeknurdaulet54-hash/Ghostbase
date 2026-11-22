import { actionsFor, DAY, deadline, deadlineState, member, priorities, Problem, statuses, textField, visibility } from './domain.mjs';
import { transaction } from './database.mjs';

export const joins = `FROM tickets t JOIN services s ON s.id=t.serviceId
  JOIN users u ON u.id=t.requesterId LEFT JOIN users a ON a.id=t.assigneeId`;
const columns = `t.id,t.subject,t.description,t.serviceId,t.requesterId,t.assigneeId,t.priority,t.status,
  t.createdAt,t.updatedAt,t.dueAt,t.resolvedAt,t.closedAt,t.version,
  s.name AS serviceName,u.name AS requesterName,u.unit AS unit,a.name AS assigneeName`;
export const activeSql = "t.status IN ('new','in_progress','waiting')";

function record(db, user, id) {
  const scope = visibility(user);
  const item = db.prepare(`SELECT ${columns} ${joins} WHERE t.id=? AND ${scope.sql}`).get(id, ...scope.args);
  if (!item) throw new Problem(404, 'Заявка не найдена.', 'not_found');
  return item;
}

export function ticketDetail(db, user, id, now) {
  const ticket = record(db, user, id);
  const events = db.prepare(`SELECT e.id,e.at,e.kind,e.detail,u.name AS actorName FROM events e
    JOIN users u ON u.id=e.actorId WHERE ticketId=? ORDER BY e.at,e.id`).all(id);
  return { ticket: { ...ticket, deadlineState: deadlineState(ticket, now) }, events, actions: actionsFor(user, ticket) };
}

function addEvent(db, ticketId, actorId, kind, detail, now) {
  db.prepare('INSERT INTO events(ticketId,actorId,kind,detail,at) VALUES(?,?,?,?,?)').run(ticketId, actorId, kind, detail, now);
}

export function createTicket(db, user, input, now) {
  const subject = textField(input.subject, 'Тема', 5, 150);
  const description = textField(input.description, 'Описание', 10, 4000);
  const priority = member(input.priority, priorities, 'Выберите приоритет.');
  const service = db.prepare('SELECT * FROM services WHERE id=?').get(String(input.serviceId ?? ''));
  if (!service) throw new Problem(422, 'Выберите услугу из каталога.', 'validation');
  const key = input.requestKey ?? null;
  if (key !== null && (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(key))) {
    throw new Problem(422, 'Некорректный ключ регистрации.', 'validation');
  }
  return transaction(db, () => {
    if (key) {
      const prior = db.prepare('SELECT * FROM tickets WHERE requesterId=? AND requestKey=?').get(user.id, key);
      if (prior) {
        if (prior.subject !== subject || prior.description !== description || prior.serviceId !== service.id || prior.priority !== priority) {
          throw new Problem(409, 'Этот ключ регистрации уже использован для другого обращения.', 'request_key_conflict');
        }
        return ticketDetail(db, user, prior.id, now);
      }
    }
    const id = Number(db.prepare(`INSERT INTO tickets(subject,description,serviceId,requesterId,priority,status,createdAt,updatedAt,dueAt,requestKey)
      VALUES(?,?,?,?,?,'new',?,?,?,?)`).run(subject, description, service.id, user.id, priority, now, now, deadline(now, service.baseHours, priority), key).lastInsertRowid);
    addEvent(db, id, user.id, 'created', '', now);
    return ticketDetail(db, user, id, now);
  });
}

function requireAction(allowed) {
  if (!allowed) throw new Problem(403, 'Действие недоступно для вашей роли или текущего статуса.', 'forbidden_action');
}

function assign(db, user, ticket, input, actions, now) {
  const claim = input.action === 'claim';
  requireAction(claim ? actions.claim : actions.assign);
  const assigneeId = claim ? user.id : input.assigneeId;
  const agent = Number.isSafeInteger(assigneeId) && db.prepare("SELECT id,name FROM users WHERE id=? AND role='specialist'").get(assigneeId);
  if (!agent) throw new Problem(422, 'Выберите ИТ-специалиста.', 'validation');
  if (agent.id === ticket.assigneeId) throw new Problem(422, 'Этот специалист уже ведёт заявку.', 'validation');
  db.prepare(`UPDATE tickets SET assigneeId=?, status=CASE WHEN status='new' THEN 'in_progress' ELSE status END WHERE id=?`).run(agent.id, ticket.id);
  addEvent(db, ticket.id, user.id, 'assigned', agent.name, now);
}

function transition(db, user, ticket, input, actions, now) {
  const status = member(input.status, statuses, 'Неизвестный статус.');
  requireAction(actions.transitions.includes(status));
  const requiresNote = ['waiting', 'resolved'].includes(status) || (status === 'in_progress' &&
    (ticket.status === 'resolved' || (user.id === ticket.requesterId && user.id !== ticket.assigneeId && user.role !== 'coordinator')));
  const note = textField(input.note ?? '', 'Пояснение', requiresNote ? 3 : 0, 2000);
  const resolvedAt = status === 'resolved' ? now : (status === 'closed' ? ticket.resolvedAt : null);
  db.prepare('UPDATE tickets SET status=?,resolvedAt=?,closedAt=? WHERE id=?').run(status, resolvedAt, status === 'closed' ? now : null, ticket.id);
  const kind = ticket.status === 'resolved' && status === 'in_progress' ? 'reopened' : status;
  addEvent(db, ticket.id, user.id, kind, note, now);
}

export function changeTicket(db, user, id, input, now, comment = false) {
  return transaction(db, () => {
    const ticket = record(db, user, id);
    if (!Number.isSafeInteger(input.version) || input.version < 1) throw new Problem(422, 'Укажите версию карточки.', 'validation');
    if (ticket.version !== input.version) throw new Problem(409, 'Карточка уже изменилась. Обновите её перед сохранением.', 'version_conflict');
    const actions = actionsFor(user, ticket);
    if (comment) {
      requireAction(actions.comment);
      addEvent(db, id, user.id, 'comment', textField(input.body, 'Комментарий', 1, 2000), now);
    } else if (input.action === 'assign' || input.action === 'claim') {
      assign(db, user, ticket, input, actions, now);
    } else if (input.action === 'transition') {
      transition(db, user, ticket, input, actions, now);
    } else {
      throw new Problem(422, 'Неизвестное действие.', 'validation');
    }
    db.prepare('UPDATE tickets SET updatedAt=?,version=version+1 WHERE id=?').run(now, id);
    return ticketDetail(db, user, id, now);
  });
}

function buildFilter(user, params, now) {
  const scope = visibility(user);
  const clauses = [scope.sql];
  const args = [...scope.args];
  function equals(column, value) { clauses.push(column + '=?'); args.push(value); }
  const status = params.get('status');
  const priority = params.get('priority');
  if (status) equals('t.status', member(status, statuses, 'Неизвестный статус.'));
  if (priority) equals('t.priority', member(priority, priorities, 'Неизвестный приоритет.'));
  if (params.get('service')) equals('t.serviceId', params.get('service'));
  const active = params.get('active');
  if (active && !['0','1'].includes(active)) throw new Problem(422, 'Некорректный фильтр активных заявок.');
  if (active === '1') clauses.push(activeSql);
  const assignee = params.get('assignee');
  if (assignee && !['mine','unassigned'].includes(assignee)) throw new Problem(422, 'Некорректный фильтр исполнителя.');
  if (assignee === 'mine') equals('t.assigneeId', user.id);
  if (assignee === 'unassigned') clauses.push('t.assigneeId IS NULL');
  const deadlineFilter = params.get('deadline');
  if (deadlineFilter && !['overdue','soon'].includes(deadlineFilter)) throw new Problem(422, 'Некорректный фильтр срока.');
  if (deadlineFilter === 'overdue') { clauses.push(activeSql, 't.dueAt < ?'); args.push(now); }
  if (deadlineFilter === 'soon') { clauses.push(activeSql, 't.dueAt BETWEEN ? AND ?'); args.push(now, now + DAY); }
  const query = (params.get('q') ?? '').trim();
  if (query) {
    if (query.length > 150) throw new Problem(422, 'Поисковый запрос слишком длинный.');
    clauses.push(`(instr(fold(t.subject),fold(?)) > 0 OR instr(fold(u.unit),fold(?)) > 0
      OR instr(fold(u.name),fold(?)) > 0 OR CAST(t.id AS TEXT)=?)`);
    args.push(query, query, query, query.replace(/^(?:ГД[-–\s]?|#)/iu, ''));
  }
  return { where: clauses.join(' AND '), args };
}

function listItem(row, now) {
  const { description, ...rest } = row;
  return { ...rest, deadlineState: deadlineState(row, now) };
}

export function listTickets(db, user, params, now, all = false) {
  const { where, args } = buildFilter(user, params, now);
  const base = `${joins} WHERE ${where}`;
  const sort = 'ORDER BY t.createdAt DESC,t.id DESC';
  if (all) return db.prepare(`SELECT ${columns} ${base} ${sort}`).all(...args).map(row => listItem(row, now));
  const pageSize = 10;
  const requested = Number(params.get('page') ?? 1);
  if (!Number.isSafeInteger(requested) || requested < 1) throw new Problem(422, 'Некорректный номер страницы.');
  const { total } = db.prepare(`SELECT COUNT(*) AS total ${base}`).get(...args);
  const page = Math.min(requested, Math.max(1, Math.ceil(total / pageSize)));
  const rows = db.prepare(`SELECT ${columns} ${base} ${sort} LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize);
  return { items: rows.map(row => listItem(row, now)), total, page, pageSize };
}

export function attentionTickets(db, user, now) {
  const scope = visibility(user);
  return db.prepare(`SELECT ${columns} ${joins} WHERE ${scope.sql} AND ${activeSql} AND t.dueAt<=?
    ORDER BY t.dueAt,t.id LIMIT 5`).all(...scope.args, now + DAY).map(row => listItem(row, now));
}

export function ticketsCsv(rows) {
  const headers = ['Номер','Тема','Услуга','Подразделение','Заявитель','Исполнитель','Статус','Приоритет','Создана (UTC)','Срок (UTC)'];
  const values = rows.map(t => [`ГД-${t.id}`,t.subject,t.serviceName,t.unit,t.requesterName,t.assigneeName ?? '',
    statuses[t.status],priorities[t.priority],new Date(t.createdAt).toISOString(),new Date(t.dueAt).toISOString()]);
  const cell = value => {
    let str = String(value);
    if (/^[\s]*[=+@-]|^[\t\r\n]/u.test(str)) str = "'" + str;
    return '"' + str.replaceAll('"', '""') + '"';
  };
  return '\uFEFF' + [headers, ...values].map(row => row.map(cell).join(';')).join('\r\n') + '\r\n';
}
