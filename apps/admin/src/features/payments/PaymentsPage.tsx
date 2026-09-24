import { PlaceholderPage } from '../common/PlaceholderPage';

// TODO(payments): платежи и возвраты, ручная регистрация поступления по счёту юрлица.
export function PaymentsPage() {
  return (
    <PlaceholderPage
      section="payments"
      endpoints={[
        { method: 'GET', path: '/api/v1/admin/payments?branchId=&status=&purpose=&from=&to=' },
        { method: 'GET', path: '/api/v1/admin/payments/{id}' },
        { method: 'POST', path: '/api/v1/admin/payments/{id}/refunds', note: '{ amount?: Money, reason }' },
        { method: 'POST', path: '/api/v1/admin/payments/bank-transfers', note: 'поступление по счёту' },
      ]}
    />
  );
}
