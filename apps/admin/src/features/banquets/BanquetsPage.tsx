import { PlaceholderPage } from '../common/PlaceholderPage';

// TODO(banquet): воронка заявок, конструктор сметы (версии), счета, документы, календарь мероприятий.
export function BanquetsPage() {
  return (
    <PlaceholderPage
      section="banquets"
      endpoints={[
        { method: 'GET', path: '/api/v1/admin/banquets?status=&managerId=&from=&to=', note: 'воронка' },
        { method: 'GET', path: '/api/v1/admin/banquets/{id}', note: 'заявка, allowedTransitions, SLA' },
        { method: 'POST', path: '/api/v1/admin/banquets/{id}/quotes', note: 'новая версия сметы' },
        { method: 'POST', path: '/api/v1/admin/banquets/{id}/invoices', note: 'счёт физ/юрлицу' },
        { method: 'POST', path: '/api/v1/admin/banquets/{id}/documents/{contract|act}' },
        { method: 'GET', path: '/api/v1/admin/banquets/calendar?branchId=&from=&to=' },
      ]}
    />
  );
}
