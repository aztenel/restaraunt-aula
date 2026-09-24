import { PlaceholderPage } from '../common/PlaceholderPage';

// TODO(reporting): выручка по дням и каналам, средний чек, конверсия, топ блюд, загрузка залов,
//   воронка банкетов, отмены и причины; выгрузка XLSX (графики — recharts).
export function ReportsPage() {
  return (
    <PlaceholderPage
      section="reports"
      endpoints={[
        { method: 'GET', path: '/api/v1/admin/reports/revenue?branchId=&from=&to=&groupBy=day|channel' },
        { method: 'GET', path: '/api/v1/admin/reports/top-dishes?branchId=&from=&to=' },
        { method: 'GET', path: '/api/v1/admin/reports/venue-load?branchId=&from=&to=' },
        { method: 'GET', path: '/api/v1/admin/reports/banquet-funnel?from=&to=' },
        { method: 'GET', path: '/api/v1/admin/reports/{report}/export.xlsx' },
      ]}
    />
  );
}
