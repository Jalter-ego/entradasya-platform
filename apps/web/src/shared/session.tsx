/**
 * Sesión PROVISORIA. La sesión real (login, registro, token vencido, navegación por rol)
 * la implementa P1 en features/auth y reemplaza este archivo manteniendo la misma interfaz:
 * useSession() -> { token, user, signIn(token), signOut() }.
 *
 * Mientras tanto, /login usa el auth de prueba de Vite (apps/web/dev-auth.ts).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Role = 'customer' | 'organizer' | 'doorman' | string;

export interface SessionUser {
  id: string;
  role: Role;
  email?: string;
  expiresAt: number;
}

interface SessionValue {
  token: string | null;
  user: SessionUser | null;
  signIn: (token: string) => boolean;
  signOut: () => void;
}

const STORAGE_KEY = 'entradasya.token';
const SessionContext = createContext<SessionValue | null>(null);

/** Lee los claims para mostrar la interfaz. La verificación real la hace cada backend. */
function decode(token: string): SessionUser | null {
  try {
    const payload = token.split('.')[1];
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof json.sub !== 'string' || typeof json.role !== 'string' || typeof json.exp !== 'number') return null;
    if (json.exp * 1000 <= Date.now()) return null;
    return { id: json.sub, role: json.role, email: json.email, expiresAt: json.exp * 1000 };
  } catch {
    return null;
  }
}

function readStored(): string | null {
  try {
    const token = localStorage.getItem(STORAGE_KEY);
    return token && decode(token) ? token : null;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(readStored);

  const signIn = useCallback((next: string) => {
    if (!decode(next)) return false;
    setToken(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* sin almacenamiento: la sesión dura hasta recargar */
    }
    return true;
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* nada que limpiar */
    }
  }, []);

  // Cierra la sesión en cuanto vence el token, aunque la pestaña siga abierta.
  useEffect(() => {
    const user = token ? decode(token) : null;
    if (!token) return;
    if (!user) {
      signOut();
      return;
    }
    // setTimeout acepta como máximo ~24,8 días; si falta más, se revisa al recargar.
    const ms = Math.min(user.expiresAt - Date.now(), 2 ** 31 - 1);
    const timer = setTimeout(signOut, ms);
    return () => clearTimeout(timer);
  }, [token, signOut]);

  const value = useMemo<SessionValue>(() => {
    const user = token ? decode(token) : null;
    return { token: user ? token : null, user, signIn, signOut };
  }, [token, signIn, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession debe usarse dentro de <SessionProvider>');
  return ctx;
}
