import { json } from './helpers.js';
import { reportRange } from '../task/task-report.js';

/**
 * Дашборд: тренд поверх уже существующих отчётов, а не третий источник
 * правды. Числа те же, что в «Отчёте по обязательствам» и «Отчёте по
 * времени» — здесь только дневной ряд для графика вместо одной суммы
 * за период, и оба отчёта рядом, а не за два разных клика.
 */
export function createDashboardHandler() {
  return async function handleDashboard(req, res, ctx, url, path, method) {
    if (path !== '/api/v1/dashboard' || method !== 'GET') return false;
    const session = await ctx.requireSession(req);
    if (!ctx.taskReport) throw Object.assign(new Error('Дашборд доступен в режиме с базой данных'), { code: 'REPORT_UNAVAILABLE', statusCode: 503, expose: true });
    const scope = url.searchParams.get('scope') === 'mine' ? 'mine' : 'team';
    const range = reportRange({ from: url.searchParams.get('from'), to: url.searchParams.get('to') });
    const [tasks, time] = await Promise.all([
      ctx.taskReport.build(session, { from: range.from, to: range.to, scope }),
      ctx.timeEntries?.enabled
        ? Promise.all([
            ctx.timeEntries.dailyTotals(session, { from: range.from, to: range.to, scope }),
            ctx.timeEntries.report(session, { from: range.from, to: range.to, scope }),
          ]).then(([daily, report]) => ({ daily, totalSeconds: report.totalSeconds }))
        : Promise.resolve(null),
    ]);
    json(res, 200, { range, scope: tasks.scope, tasks: { totals: tasks.totals, daily: tasks.daily }, time });
    return true;
  };
}
