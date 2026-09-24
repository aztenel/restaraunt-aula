import { PlaceholderPage } from '../common/PlaceholderPage';

// TODO(ordering): очередь и карточка заказа, смена статуса по allowedTransitions от сервера,
//   отклонение с возвратом, заказ по телефону (канал admin).
export function OrdersPage() {
  return (
    <PlaceholderPage
      section="orders"
      endpoints={[
        { method: 'GET', path: '/api/v1/admin/orders?branchId=&status=&from=&to=&q=&page=', note: 'список, фильтры' },
        { method: 'GET', path: '/api/v1/admin/orders/{id}', note: 'позиции, суммы, платежи, allowedTransitions' },
        { method: 'POST', path: '/api/v1/admin/orders/{id}/transitions', note: '{ to, reason? }' },
        { method: 'POST', path: '/api/v1/admin/orders/{id}/reject', note: 'отказ оплаченного заказа + возврат' },
        { method: 'POST', path: '/api/v1/admin/orders/{id}/refunds', note: '{ amount?: Money, reason }' },
        { method: 'POST', path: '/api/v1/admin/orders', note: 'заказ по телефону (channel=admin)' },
      ]}
    />
  );
}
