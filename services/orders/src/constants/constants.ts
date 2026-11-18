export const SERVICE_NAME = 'orders';

export const BODY_LIMIT = '32kb';

export const DB_POOL = {
  max: 10,
  connectionTimeoutMillis: 5_000,
  queryTimeoutMillis: 10_000,
  idleInTransactionTimeoutMillis: 15_000,
} as const;

export const SHUTDOWN_TIMEOUT_MS = 10_000;

export const JWT_ALGORITHM = 'RS256';

export const ROLES = {
  CUSTOMER: 'customer',
  ORGANIZER: 'organizer',
  DOORMAN: 'doorman',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const INTERNAL_TOKEN_MIN_LENGTH = 24;

export const INTERNAL_TOKEN_HEADER = 'x-internal-token';

/** Motivos de una llamada interna sin respuesta definitiva: el resultado remoto es desconocido. */
export const REMOTE_UNAVAILABLE = {
  TIMEOUT: 'TIMEOUT',
  NETWORK_ERROR: 'NETWORK_ERROR',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
} as const;

export const MAX_TICKETS_PER_ORDER = 6;

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

export const DEMO_PAYMENT = {
  METHOD: 'demo_card',
  APPROVE_LAST4: '1111',
  REJECT_LAST4: '0000',
} as const;

/** Estados de docs/database/README.md §5. Deben coincidir con los CHECK de la migración. */
export const ORDER_STATUS = {
  PENDING: 'pending',
  PAID: 'paid',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
} as const;

export const RESERVATION_STATUS = {
  NOT_STARTED: 'not_started',
  PENDING: 'pending',
  ACTIVE: 'active',
  RELEASE_PENDING: 'release_pending',
  RELEASED: 'released',
  FAILED: 'failed',
} as const;

export const PAYMENT_STATUS = {
  NOT_STARTED: 'not_started',
  PENDING: 'pending',
  UNKNOWN: 'unknown',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const;

export const TICKET_STATUS = {
  NOT_STARTED: 'not_started',
  PENDING: 'pending',
  ISSUED: 'issued',
} as const;

export const NOTIFICATION_STATUS = {
  NOT_STARTED: 'not_started',
  PENDING: 'pending',
  SENT: 'sent',
  FAILED: 'failed',
  UNKNOWN: 'unknown',
} as const;

export const ERROR_STEP = {
  RESERVATION: 'reservation',
  PAYMENT: 'payment',
  TICKETS: 'tickets',
  NOTIFICATION: 'notification',
} as const;

type Values<T> = T[keyof T];
export type OrderStatus = Values<typeof ORDER_STATUS>;
export type ReservationStatus = Values<typeof RESERVATION_STATUS>;
export type PaymentStatus = Values<typeof PAYMENT_STATUS>;
export type TicketStatus = Values<typeof TICKET_STATUS>;
export type NotificationStatus = Values<typeof NOTIFICATION_STATUS>;
export type ErrorStep = Values<typeof ERROR_STEP>;

export const PAGINATION = {
  defaultPerPage: 10,
  maxPerPage: 100,
} as const;

export const ORDER_LOCK = {
  waitMs: 10_000,
  pollMs: 200,
} as const;

export const RESERVATION_REJECTIONS: Record<string, string> = {
  SOLD_OUT: 'SOLD_OUT',
  EVENT_NOT_AVAILABLE: 'EVENT_NOT_AVAILABLE',
  NOT_FOUND: 'EVENT_NOT_FOUND',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  RESERVATION_RELEASED: 'RESERVATION_RELEASED',
};

export const PROGRESS_ERRORS = {
  RESERVATION_MISMATCH: 'RESERVATION_MISMATCH',
  PAYMENT_MISMATCH: 'PAYMENT_MISMATCH',
  TICKETS_MISMATCH: 'TICKETS_MISMATCH',
  AMOUNT_OUT_OF_RANGE: 'AMOUNT_OUT_OF_RANGE',
} as const;

export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_JSON: 'INVALID_JSON',
  BODY_TOO_LARGE: 'BODY_TOO_LARGE',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  SOLD_OUT: 'SOLD_OUT',
  PAYMENT_REJECTED: 'PAYMENT_REJECTED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
