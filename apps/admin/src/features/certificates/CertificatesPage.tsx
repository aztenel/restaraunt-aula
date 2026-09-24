import { PlaceholderPage } from '../common/PlaceholderPage';

// TODO(payments): продукты сертификатов, выпуск, проверка и погашение кода, блокировка, отчёт.
export function CertificatesPage() {
  return (
    <PlaceholderPage
      section="certificates"
      endpoints={[
        { method: 'GET', path: '/api/v1/admin/certificates?status=&q=' },
        { method: 'POST', path: '/api/v1/admin/certificates/check', note: '{ code } (лимит попыток)' },
        { method: 'POST', path: '/api/v1/admin/certificates/{id}/redeem', note: '{ amount?: Money, branchId }' },
        { method: 'POST', path: '/api/v1/admin/certificates/{id}/block' },
        { method: 'GET', path: '/api/v1/admin/certificate-products' },
      ]}
    />
  );
}
