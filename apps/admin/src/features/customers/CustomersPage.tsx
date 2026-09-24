import { PlaceholderPage } from '../common/PlaceholderPage';

// TODO(customers): база гостей — поиск по телефону, история, теги, аллергии, согласия, сегменты и выгрузка.
export function CustomersPage() {
  return (
    <PlaceholderPage
      section="customers"
      endpoints={[
        { method: 'GET', path: '/api/v1/admin/customers?q=&tags=&page=' },
        { method: 'GET', path: '/api/v1/admin/customers/{id}', note: 'профиль + история' },
        { method: 'PATCH', path: '/api/v1/admin/customers/{id}' },
        { method: 'GET', path: '/api/v1/admin/customers/export?segment=', note: 'XLSX' },
      ]}
    />
  );
}
