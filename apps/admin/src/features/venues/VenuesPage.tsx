import { PlaceholderPage } from '../common/PlaceholderPage';

// TODO(reservation): залы и места (типы — справочник), вместимость, депозит, правила брони.
export function VenuesPage() {
  return (
    <PlaceholderPage
      section="venues"
      endpoints={[
        { method: 'GET', path: '/api/v1/admin/venue-types' },
        { method: 'GET', path: '/api/v1/admin/halls?branchId=' },
        { method: 'POST', path: '/api/v1/admin/halls/{hallId}/venues' },
        { method: 'PUT', path: '/api/v1/admin/venues/{id}' },
      ]}
    />
  );
}
