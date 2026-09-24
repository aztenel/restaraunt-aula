import { PlaceholderPage } from '../common/PlaceholderPage';

// TODO(ordering): зоны доставки — полигоны на карте (leaflet-geoman), минимальная сумма, стоимость, бесплатно от.
export function DeliveryZonesPage() {
  return (
    <PlaceholderPage
      section="deliveryZones"
      endpoints={[
        { method: 'GET', path: '/api/v1/admin/delivery-zones?branchId=' },
        { method: 'POST', path: '/api/v1/admin/delivery-zones', note: '{ branchId, polygon, minOrder, fee, freeFrom }' },
        { method: 'PUT', path: '/api/v1/admin/delivery-zones/{id}' },
        { method: 'DELETE', path: '/api/v1/admin/delivery-zones/{id}' },
      ]}
    />
  );
}
