export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const roles = {
  employee: 'Сотрудник',
  specialist: 'ИТ-специалист',
  coordinator: 'Координатор'
};
export const statuses = {
  new: 'Новая',
  in_progress: 'В работе',
  waiting: 'Ожидает ответа',
  resolved: 'Решена',
  closed: 'Закрыта'
};
export const priorities = { low: 'Низкий', normal: 'Обычный', high: 'Высокий' };
export const serviceDefinitions = [
  ['documents', 'Документооборот', 'Регистрация писем, маршруты согласования и работа в системе электронного документооборота.', 'file-earmark-text', 24],
  ['access', 'Доступ к системам', 'Учётные записи и права доступа к ведомственным реестрам и информационным системам.', 'key', 48],
  ['signature', 'Электронная подпись', 'Выпуск и продление сертификатов, настройка носителя и проверка подписи документов.', 'pen', 24],
  ['network', 'Защищённая сеть', 'Подключение к внутренней сети, удалённый доступ и доступность сетевых ресурсов.', 'diagram-3', 12],
  ['workplace', 'Рабочее место', 'Настройка компьютеров, служебного ПО, принтеров и сканеров подразделения.', 'pc-display', 48],
  ['meetings', 'Видеосвязь', 'Организация межведомственных совещаний, переговорные комнаты и оборудование ВКС.', 'camera-video', 12]
];

export class Problem extends Error {
  constructor(status, message, code = 'request_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function textField(value, name, min, max) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (result.length < min || result.length > max) {
    throw new Problem(422, `Поле «${name}» должно содержать от ${min} до ${max} символов.`, 'validation');
  }
  return result;
}

export function member(value, dictionary, message) {
  if (typeof value !== 'string' || !Object.hasOwn(dictionary, value)) {
    throw new Problem(422, message, 'validation');
  }
  return value;
}

export function deadline(createdAt, baseHours, priority) {
  const factor = { low: 2, normal: 1, high: 0.5 }[priority];
  return createdAt + baseHours * factor * HOUR;
}

export function isActive(status) {
  return ['new', 'in_progress', 'waiting'].includes(status);
}

export function deadlineState(ticket, now) {
  if (!isActive(ticket.status)) return ticket.resolvedAt <= ticket.dueAt ? 'met' : 'missed';
  if (now > ticket.dueAt) return 'overdue';
  return ticket.dueAt - now <= DAY ? 'soon' : 'on_time';
}

export function actionsFor(user, ticket) {
  const requester = user.id === ticket.requesterId;
  const coordinator = user.role === 'coordinator';
  const owner = user.role === 'specialist' && user.id === ticket.assigneeId;
  const transitions = new Set();
  if ((coordinator || owner) && ticket.status === 'in_progress') {
    transitions.add('waiting').add('resolved');
  }
  if (ticket.status === 'waiting') {
    if (coordinator || owner || requester) transitions.add('in_progress');
    if (coordinator || owner) transitions.add('resolved');
  }
  if (ticket.status === 'resolved' && (coordinator || requester)) {
    transitions.add('in_progress').add('closed');
  }
  return {
    claim: user.role === 'specialist' && ticket.status === 'new' && ticket.assigneeId === null,
    assign: coordinator && isActive(ticket.status),
    comment: ticket.status !== 'closed',
    transitions: [...transitions]
  };
}

// Alias t is used by every ticket-scoped query, including reports and CSV.
export function visibility(user) {
  if (user.role === 'coordinator') return { sql: '1 = 1', args: [] };
  if (user.role === 'specialist') {
    return { sql: '(t.assigneeId = ? OR t.assigneeId IS NULL OR t.requesterId = ?)', args: [user.id, user.id] };
  }
  return { sql: 't.requesterId = ?', args: [user.id] };
}
