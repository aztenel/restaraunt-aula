'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, Marker, TileLayer, Tooltip } from 'react-leaflet';

// Метка — SVG через divIcon: стандартные PNG-иконки Leaflet ломаются при сборке бандлером.
const pinIcon = L.divIcon({
  className: '',
  iconSize: [36, 46],
  iconAnchor: [18, 44],
  tooltipAnchor: [0, -40],
  html: `<svg width="36" height="46" viewBox="0 0 36 46" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M18 45s15-14.2 15-26A15 15 0 0 0 3 19c0 11.8 15 26 15 26Z" fill="#57351e" stroke="#fffcf7" stroke-width="2"/>
    <circle cx="18" cy="19" r="6" fill="#d9ae4f"/></svg>`,
});

export default function BranchMapLeaflet({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={16}
      scrollWheelZoom={false}
      className="h-full w-full"
      attributionControl
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <Marker position={[lat, lng]} icon={pinIcon} title={label} alt={label}>
        <Tooltip direction="top" permanent={false}>
          {label}
        </Tooltip>
      </Marker>
    </MapContainer>
  );
}
