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

export const PAGINATION = {
  defaultPerPage: 10,
  maxPerPage: 100,
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
