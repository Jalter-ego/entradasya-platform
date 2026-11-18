import { config } from '../config/config.js';
import { EventsClient } from './eventsClient.js';
import { NotificationsClient } from './notificationsClient.js';
import { PaymentsClient } from './paymentsClient.js';
import { TicketsClient } from './ticketsClient.js';

export interface Clients {
  events: EventsClient;
  payments: PaymentsClient;
  tickets: TicketsClient;
  notifications: NotificationsClient;
}

export function createClients(): Clients {
  const { services, http } = config;
  return {
    events: new EventsClient({ name: 'events', ...services.events, timeoutMs: http.timeoutMs }),
    payments: new PaymentsClient({ name: 'payments', ...services.payments, timeoutMs: http.timeoutMs }),
    tickets: new TicketsClient({ name: 'tickets', ...services.tickets, timeoutMs: http.ticketsTimeoutMs }),
    notifications: new NotificationsClient({ name: 'notifications', ...services.notifications, timeoutMs: http.timeoutMs }),
  };
}
