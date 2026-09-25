/**
 * Цвета броней в календаре и состояний мест на карте зала (контраст текста — WCAG AA на заливке).
 * Банкет — отдельный фиолетовый стиль со штриховкой; буфер уборки — серая штриховка.
 */
import type { VenueMapState } from './availability';
import type { ReservationKind, ReservationStatus } from './types';

export interface Swatch {
  fill: string;
  stroke: string;
  text: string;
  dashed?: boolean;
}

export const STATUS_SWATCH: Record<ReservationStatus, Swatch> = {
  pending: { fill: '#fff4d6', stroke: '#c9951a', text: '#5c4400' },
  awaiting_deposit: { fill: '#ffe7d1', stroke: '#d97706', text: '#5a3100' },
  confirmed: { fill: '#dbeafe', stroke: '#3b6fd8', text: '#1d3a7a' },
  arrived: { fill: '#d9f2e1', stroke: '#2f7d4f', text: '#1d4d31' },
  no_show: { fill: '#f1f0ee', stroke: '#a8a29a', text: '#5f5a55', dashed: true },
  cancelled: { fill: '#fbe9e7', stroke: '#b5452c', text: '#6e2414', dashed: true },
  expired: { fill: '#f1f0ee', stroke: '#a8a29a', text: '#5f5a55', dashed: true },
};

export const BANQUET_SWATCH: Swatch = { fill: '#efe1f7', stroke: '#8e44ad', text: '#4a1d63' };

export function itemSwatch(kind: ReservationKind, status: ReservationStatus): Swatch {
  return kind === 'banquet' ? BANQUET_SWATCH : STATUS_SWATCH[status];
}

export const MAP_STATE_SWATCH: Record<VenueMapState, Swatch> = {
  free: { fill: '#e6f4ea', stroke: '#2f7d4f', text: '#1d4d31' },
  soon: { fill: '#fff4d6', stroke: '#c9951a', text: '#5c4400' },
  reserved: { fill: '#dbeafe', stroke: '#3b6fd8', text: '#1d3a7a' },
  seated: { fill: '#b7e1c6', stroke: '#1f6b3f', text: '#123d24' },
  banquet: BANQUET_SWATCH,
  cleanup: { fill: '#ece7e0', stroke: '#9e948a', text: '#4d463f', dashed: true },
  inactive: { fill: '#f5f5f5', stroke: '#c8c8c8', text: '#7a7a7a', dashed: true },
};

export const MAP_STATES: VenueMapState[] = ['free', 'soon', 'reserved', 'seated', 'banquet', 'cleanup', 'inactive'];
