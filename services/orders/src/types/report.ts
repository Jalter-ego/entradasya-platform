/** Fila agregada por sector, tal como la devuelve pg (las sumas bigint llegan como texto). */
export interface SectorSalesRow {
  sector_id: string;
  sector_name: string;
  currency: string;
  orders_paid: number;
  tickets_sold: string;
  revenue_minor: string;
}

export interface SectorSales {
  sectorId: string;
  sectorName: string;
  ordersPaid: number;
  ticketsSold: number;
  revenueMinor: number;
}

/** Reporte expuesto por HTTP (contracts/orders.openapi.yaml, schema SalesReport). */
export interface SalesReport {
  eventId: string;
  currency: string | null;
  ordersPaid: number;
  ticketsSold: number;
  revenueMinor: number;
  sectors: SectorSales[];
}
