import { PlaceholderPage } from '../common/PlaceholderPage';

// TODO(reservation): шахматка броней по местам и времени, подтверждение, отметка пришли/не пришли.
export function ReservationsPage() {
  return (
    <PlaceholderPage
      section="reservations"
      endpoints={[
        { method: 'GET', path: '/api/v1/admin/reservations?branchId=&date=&status=', note: 'список/шахматка' },
        { method: 'GET', path: '/api/v1/admin/reservations/{id}' },
        { method: 'POST', path: '/api/v1/admin/reservations', note: 'бронь по телефону' },
        { method: 'POST', path: '/api/v1/admin/reservations/{id}/confirm | /cancel | /arrived | /no-show' },
      ]}
    />
  );
}
