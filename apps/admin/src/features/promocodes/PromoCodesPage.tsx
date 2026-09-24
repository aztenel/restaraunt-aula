import { PlaceholderPage } from '../common/PlaceholderPage';

// TODO(ordering): промокоды (процент / сумма / бесплатная доставка, лимиты, сроки, филиалы).
export function PromoCodesPage() {
  return (
    <PlaceholderPage
      section="promocodes"
      endpoints={[
        { method: 'GET', path: '/api/v1/admin/promocodes?q=&active=' },
        { method: 'POST', path: '/api/v1/admin/promocodes' },
        { method: 'PUT', path: '/api/v1/admin/promocodes/{id}' },
      ]}
    />
  );
}
