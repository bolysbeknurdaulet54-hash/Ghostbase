import { DAY, Problem, visibility } from './domain.mjs';
import { activeSql, attentionTickets } from './tickets.mjs';

// UTC midnight keeps the chart and its report window identical in every client timezone.
export function report(db, user, days, now) {
  if (![7, 14, 30].includes(days)) throw new Problem(422, 'Доступны периоды 7, 14 и 30 дней.');
  const scope = visibility(user);
  const today = Math.floor(now / DAY) * DAY;
  const start = today - (days - 1) * DAY;
  const counters = db.prepare(`SELECT COUNT(*) AS open,
    COUNT(*) FILTER (WHERE t.assigneeId IS NULL) AS unassigned,
    COUNT(*) FILTER (WHERE t.dueAt < ?) AS overdue
    FROM tickets t WHERE ${scope.sql} AND ${activeSql}`).get(now, ...scope.args);
  const created = db.prepare(`SELECT CAST(t.createdAt / ? AS INTEGER) AS day, COUNT(*) AS count FROM tickets t
    WHERE ${scope.sql} AND t.createdAt BETWEEN ? AND ? GROUP BY day`).all(DAY, ...scope.args, start, now);
  const resolved = db.prepare(`SELECT CAST(e.at / ? AS INTEGER) AS day, COUNT(*) AS count,
    COUNT(*) FILTER (WHERE e.at<=t.dueAt) AS met FROM events e JOIN tickets t ON t.id=e.ticketId
    WHERE ${scope.sql} AND e.kind='resolved' AND e.at BETWEEN ? AND ? GROUP BY day`).all(DAY, ...scope.args, start, now);
  const daily = Array.from({ length: days }, (_, i) => ({ at: start + i * DAY, created: 0, resolved: 0 }));
  function accumulate(rows, key) {
    for (const row of rows) daily[row.day - start / DAY][key] += row.count;
  }
  accumulate(created, 'created');
  accumulate(resolved, 'resolved');
  const services = db.prepare(`SELECT s.id,s.name,s.icon,COUNT(t.id) AS count FROM services s
    LEFT JOIN tickets t ON t.serviceId=s.id AND ${scope.sql} AND ${activeSql}
    GROUP BY s.id ORDER BY count DESC,s.rowid`).all(...scope.args);
  const departments = db.prepare(`SELECT u.unit,COUNT(*) AS count FROM tickets t JOIN users u ON u.id=t.requesterId
    WHERE ${scope.sql} AND t.createdAt BETWEEN ? AND ? GROUP BY u.unit ORDER BY count DESC,u.unit`).all(...scope.args, start, now);
  const distribution = db.prepare(`SELECT t.status,COUNT(*) AS count FROM tickets t
    WHERE ${scope.sql} AND ${activeSql} GROUP BY t.status`).all(...scope.args);
  return {
    days, start, asOf: now, counters: {
      ...counters, created: created.reduce((sum, row) => sum + row.count, 0),
      resolved: resolved.reduce((sum, row) => sum + row.count, 0),
      met: resolved.reduce((sum, row) => sum + row.met, 0)
    },
    daily, services, departments, distribution, attention: attentionTickets(db, user, now)
  };
}
