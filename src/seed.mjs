import { DAY, HOUR, deadline, serviceDefinitions } from './domain.mjs';

const people = [
  [1, 'Мария Соколова', 'm.sokolova', 'Управление цифрового развития', 'coordinator'],
  [2, 'Илья Морозов', 'i.morozov', 'Управление цифрового развития', 'specialist'],
  [3, 'Анна Левина', 'a.levina', 'Отдел обращений граждан', 'employee'],
  [4, 'Ольга Белова', 'o.belova', 'Управление цифрового развития', 'specialist'],
  [5, 'Денис Орлов', 'd.orlov', 'Управление делопроизводства', 'employee'],
  [6, 'Алия Ким', 'a.kim', 'Правовое управление', 'employee'],
  [7, 'Павел Миронов', 'p.mironov', 'Территориальный отдел', 'employee']
];

// Fictional cases are interleaved across services so each week contains different topics.
const cases = [
  ['Восстановить маршрут согласования приказа', 'Не открывается карточка входящего письма', 'Настроить журнал распоряжений', 'Вернуть приложение к проекту ответа', 'Обновить шаблон служебной записки', 'Настроить замещение на время отпуска', 'Не загружается реестр входящих документов', 'Добавить согласующего в маршрут письма'],
  ['Открыть доступ к журналу обращений', 'Настроить роль специалиста приёмной', 'Восстановить вход в ведомственный реестр', 'Добавить сотрудника в группу согласования', 'Сменить подразделение в учётной записи', 'Открыть доступ к архиву распоряжений', 'Выдать права на реестр поручений', 'Подключить нового сотрудника к СЭД'],
  ['Продлить сертификат электронной подписи', 'Проверить подпись на исходящем письме', 'Настроить носитель для подписания актов', 'Обновить цепочку сертификатов', 'Подпись не отображается в карточке решения', 'Настроить подписание пакета документов', 'Заменить сертификат руководителя отдела', 'Проверить подпись межведомственного запроса'],
  ['Восстановить связь с территориальным отделом', 'Подключить кабинет к защищённой сети', 'Проверить доступность сетевой папки', 'Настроить рабочее подключение из филиала', 'Восстановить сетевой диск канцелярии', 'Перенести сетевую точку в приёмной', 'Нет связи с ведомственным порталом', 'Проверить канал межведомственного обмена'],
  ['Настроить сканирование входящих писем', 'Подключить принтер в окне приёма', 'Установить модуль работы с реестром', 'Подготовить рабочее место в канцелярии', 'Восстановить печать бланков', 'Обновить клиент документооборота', 'Настроить сканер для архива обращений', 'Перенести профиль на служебный ноутбук'],
  ['Настроить связь для выездной комиссии', 'Проверить микрофоны в зале совещаний', 'Подключить филиал к видеосовещанию', 'Обновить адрес переговорной комнаты', 'Настроить трансляцию заседания', 'Восстановить звук в малой переговорной', 'Подготовить ВКС для межведомственной встречи', 'Проверить камеру в территориальном отделе']
];
const descriptions = [
  'При обработке документа в ведомственной системе возникла проблема. Просим проверить настройки маршрута и сообщить, когда можно продолжить регистрацию.',
  'Сотруднику подразделения требуется доступ для исполнения служебного поручения. Заявку согласовал руководитель отдела. Просим проверить профиль и назначенные права.',
  'При работе с подписанными документами требуется помощь специалиста. Оригиналы и носитель находятся на рабочем месте ответственного сотрудника.',
  'Проблема воспроизводится на рабочем месте в здании управления. Просим проверить подключение и сообщить результат через карточку заявки.',
  'Оборудование используется для ежедневного приёма документов. Специалист может согласовать время подключения в комментариях к заявке.',
  'Подразделению предстоит рабочее совещание с территориальным отделом. Просим проверить оборудование и провести тестовое подключение.'
];
const solutions = [
  'Маршрут согласования обновлён. Контрольный документ прошёл регистрацию.',
  'Права назначены по согласованной роли. Доступ проверен с заявителем.',
  'Настройки сертификата обновлены. Проверка тестовой подписи прошла успешно.',
  'Подключение восстановлено. Внутренний ресурс доступен с рабочего места.',
  'Настройки рабочего места восстановлены и проверены вместе с сотрудником.',
  'Тестовый сеанс связи завершён. Звук и изображение доступны обеим сторонам.'
];
const resolutionAgeDays = [0,0,0,1,1,1,1,1,2,2,3,3,3,3,4,4,4,5,5,6,6,6,7,8,9,10,12,14,16,19,22,25];

export function seedDemo(db, now) {
  const addUser = db.prepare('INSERT INTO users(id,name,email,unit,role) VALUES(?,?,?,?,?)');
  for (const [id, name, email, unit, role] of people) addUser.run(id, name, email + '@gosdesk.example', unit, role);
  const addTicket = db.prepare(`INSERT INTO tickets
    (id,subject,description,serviceId,requesterId,assigneeId,priority,status,createdAt,updatedAt,dueAt,resolvedAt,closedAt,version)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const addEvent = db.prepare('INSERT INTO events(ticketId,actorId,kind,detail,at) VALUES(?,?,?,?,?)');

  for (let i = 0; i < 48; i++) {
    const s = i % 6;
    const [serviceId, , , , baseHours] = serviceDefinitions[s];
    const subject = cases[s][Math.floor(i / 6)];
    const requester = [3, 5, 6, 7, 3][i % 5];
    const priority = ['normal', 'high', 'normal', 'low', 'normal'][i % 5];
    const budget = deadline(0, baseHours, priority);
    const historical = i < 32;
    const activeStatus = ['in_progress', 'new', 'waiting', 'in_progress', 'new'];
    const status = historical ? (i % 4 === 0 ? 'resolved' : 'closed') : activeStatus[(i - 32) % 5];
    const assignee = status === 'new' ? null : (i % 3 ? 2 : 4);
    let resolvedAt = null;
    let closedAt = null;
    let createdAt;
    if (historical) {
      const age = resolutionAgeDays[i] * DAY + (i % 11 + 1) * HOUR;
      resolvedAt = now - age;
      createdAt = resolvedAt - Math.round(budget * (i % 7 === 0 ? 1.24 : 0.25 + (i % 6) / 10));
      if (status === 'closed') closedAt = resolvedAt + Math.min(age / 2, 2 * HOUR);
    } else {
      const elapsed = i % 5 === 0 ? 1.23 + i % 3 / 10 : 0.12 + (i % 7) / 12;
      createdAt = now - Math.round(budget * elapsed);
    }
    const id = 1001 + i;
    const assignedAt = createdAt + Math.round(((resolvedAt ?? now) - createdAt) * 0.18);
    const waitingAt = createdAt + Math.round((now - createdAt) * 0.48);
    const events = [[requester, 'created', '', createdAt]];
    if (assignee) events.push([1, 'assigned', people.find(person => person[0] === assignee)[1], assignedAt]);
    if (status === 'waiting') events.push([assignee, 'waiting', 'Уточните, пожалуйста, номер кабинета и удобное время для проверки.', waitingAt]);
    if (resolvedAt) events.push([assignee, 'resolved', solutions[s], resolvedAt]);
    if (closedAt) events.push([requester, 'closed', 'Результат проверен сотрудником подразделения.', closedAt]);
    const updatedAt = events.at(-1)[3];
    addTicket.run(id, subject, descriptions[s], serviceId, requester, assignee, priority, status,
      createdAt, updatedAt, createdAt + budget, resolvedAt, closedAt, events.length);
    for (const [actor, kind, detail, at] of events) addEvent.run(id, actor, kind, detail, at);
  }
}
