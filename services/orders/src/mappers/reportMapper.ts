import type { SalesReport, SectorSales, SectorSalesRow } from '../types/report.js';
import { toSafeInteger } from '../utils/safeInteger.js';

export function toSalesReport(eventId: string, rows: SectorSalesRow[]): SalesReport {
  const currencies = new Set(rows.map((row) => row.currency));
  if (currencies.size > 1) throw new Error('Ventas del evento con monedas distintas');

  const sectors: SectorSales[] = rows.map((row) => ({
    sectorId: row.sector_id,
    sectorName: row.sector_name,
    ordersPaid: row.orders_paid,
    ticketsSold: toSafeInteger(row.tickets_sold),
    revenueMinor: toSafeInteger(row.revenue_minor),
  }));

  return {
    eventId,
    currency: rows[0]?.currency ?? null,
    ordersPaid: sectors.reduce((sum, sector) => sum + sector.ordersPaid, 0),
    ticketsSold: toSafeInteger(sectors.reduce((sum, sector) => sum + sector.ticketsSold, 0)),
    revenueMinor: toSafeInteger(sectors.reduce((sum, sector) => sum + sector.revenueMinor, 0)),
    sectors,
  };
}
