import type { Role } from '../constants/constants.js';

export interface AuthUser {
  id: string;
  role: Role;
  email: string;
}

export type VerifyToken = (token: string) => Promise<AuthUser>;
