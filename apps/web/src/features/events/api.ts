import { api } from '../../shared/api';

export type EventStatus = 'draft' | 'published' | 'cancelled';

export interface Sector {
  id: string;
  name: string;
  priceMinor: number;
  capacity: number;
  available: number;
}

export interface EventItem {
  id: string;
  organizerId: string;
  title: string;
  description: string;
  venue: string;
  city: string;
  category: string;
  startsAt: string;
  imageUrl: string | null;
  currency: string;
  status: EventStatus;
  createdAt: string;
  updatedAt: string;
  sectors: Sector[];
}

export interface SectorInput {
  name: string;
  priceMinor: number;
  capacity: number;
}

export interface EventInput {
  title: string;
  description: string;
  venue: string;
  city: string;
  category: string;
  startsAt: string;
  imageUrl: string | null;
}

/**
 * Reporte de ventas que expone orders (P3): GET /api/orders/reports/events/:eventId.
 * Forma PROPUESTA; confirmar con P3 y ajustar aquí si cambia.
 */
export interface SalesReport {
  eventId: string;
  currency: string;
  paidOrders: number;
  ticketsSold: number;
  revenueMinor: number;
  bySector?: { sectorId: string; sectorName?: string; ticketsSold: number; revenueMinor: number }[];
}

const base = '/api/events';
type Token = string | null;

export const eventsApi = {
  listPublished: (signal?: AbortSignal) =>
    api<{ items: EventItem[] }>(`${base}?limit=100`, { signal }).then((r) => r.items),
  get: (id: string, token: Token, signal?: AbortSignal) =>
    api<EventItem>(`${base}/${encodeURIComponent(id)}`, { token, signal }),
  listMine: (token: Token, signal?: AbortSignal) =>
    api<{ items: EventItem[] }>(`${base}/mine`, { token, signal }).then((r) => r.items),
  create: (token: Token, body: EventInput & { sectors: SectorInput[] }) =>
    api<EventItem>(base, { method: 'POST', token, body }),
  update: (token: Token, id: string, body: Partial<EventInput>) =>
    api<EventItem>(`${base}/${id}`, { method: 'PATCH', token, body }),
  publish: (token: Token, id: string) => api<EventItem>(`${base}/${id}/publish`, { method: 'POST', token }),
  cancel: (token: Token, id: string) => api<EventItem>(`${base}/${id}/cancel`, { method: 'POST', token }),
  addSector: (token: Token, id: string, body: SectorInput) =>
    api<EventItem>(`${base}/${id}/sectors`, { method: 'POST', token, body }),
  updateSector: (token: Token, id: string, sectorId: string, body: Partial<SectorInput>) =>
    api<EventItem>(`${base}/${id}/sectors/${sectorId}`, { method: 'PATCH', token, body }),
  deleteSector: (token: Token, id: string, sectorId: string) =>
    api<EventItem>(`${base}/${id}/sectors/${sectorId}`, { method: 'DELETE', token }),
  salesReport: (token: Token, id: string, signal?: AbortSignal) =>
    api<SalesReport>(`/api/orders/reports/events/${id}`, { token, signal }),
};

// ------------------------------------------------------------- derivados para la UI

export function minPrice(event: EventItem): number | null {
  return event.sectors.length ? Math.min(...event.sectors.map((s) => s.priceMinor)) : null;
}

export function totals(event: EventItem) {
  const capacity = event.sectors.reduce((sum, s) => sum + s.capacity, 0);
  const available = event.sectors.reduce((sum, s) => sum + s.available, 0);
  return { capacity, available, committed: capacity - available };
}

export type Availability = 'available' | 'few' | 'soldOut';

/** "Pocos lugares" cuando queda el 10 % o menos (o 10 lugares o menos). */
export function availabilityOf(available: number, capacity: number): Availability {
  if (available <= 0) return 'soldOut';
  if (available <= Math.max(10, capacity * 0.1)) return 'few';
  return 'available';
}

export const STATUS_LABEL: Record<EventStatus, string> = {
  draft: 'Borrador',
  published: 'Publicado',
  cancelled: 'Cancelado',
};

/** Mensajes en español para los códigos de error de events. */
export function errorMessage(code: string, fallback: string): string {
  const messages: Record<string, string> = {
    NO_SECTORS: 'Agrega al menos un sector antes de publicar.',
    EVENT_IN_PAST: 'La fecha del evento ya pasó. Cámbiala para poder publicarlo.',
    EVENT_CANCELLED: 'El evento está cancelado y ya no admite cambios.',
    SECTOR_NAME_TAKEN: 'Ya hay un sector con ese nombre en este evento.',
    CAPACITY_BELOW_COMMITTED: fallback,
    SECTOR_HAS_RESERVATIONS: 'Este sector ya tiene compras y no se puede borrar.',
    LAST_SECTOR: 'Un evento publicado necesita al menos un sector.',
    UNAUTHORIZED: 'Tu sesión venció. Inicia sesión de nuevo.',
    FORBIDDEN: 'Solo el organizador del evento puede modificarlo.',
  };
  return messages[code] ?? fallback;
}
