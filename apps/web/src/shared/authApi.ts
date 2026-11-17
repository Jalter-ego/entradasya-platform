import { api } from './api';

/**
 * Inicio de sesión. Hoy usa el auth de PRUEBA de Vite (apps/web/dev-auth.ts).
 * Cuando P1 entregue el servicio auth, cambiar LOGIN_URL a '/api/auth/login'
 * (misma respuesta: { token }) y borrar dev-auth.ts.
 */
const LOGIN_URL = import.meta.env.DEV ? '/dev-auth/login' : '/api/auth/login';

export function login(email: string, password: string) {
  return api<{ token: string }>(LOGIN_URL, { method: 'POST', body: { email, password } });
}

/** Cuentas que acepta el auth de prueba. Desaparecen en el build final. */
export const DEMO_ACCOUNTS = import.meta.env.DEV
  ? [
      { label: 'Organizador', email: 'organizador@demo.bo', hint: 'Crea y edita eventos' },
      { label: 'Cliente', email: 'cliente@demo.bo', hint: 'Compra entradas' },
      { label: 'Portero', email: 'portero@demo.bo', hint: 'Controla el ingreso' },
    ]
  : [];
export const DEMO_PASSWORD = import.meta.env.DEV ? 'demo1234' : '';
