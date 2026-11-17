import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { devAuth } from './dev-auth';

// En desarrollo Vite reenvía cada API a su servicio, igual que hará Nginx en la demo.
// Puertos del plan; cada uno se puede cambiar con una variable de entorno.
const service = (envName: string, port: number) => ({
  target: process.env[envName] ?? `http://127.0.0.1:${port}`,
  changeOrigin: true,
});

export default defineConfig({
  // devAuth: login de prueba solo en desarrollo, hasta que exista el servicio auth (P1).
  plugins: [react(), devAuth()],
  server: {
    port: 5173,
    proxy: {
      '/api/auth': service('AUTH_URL', 3001),
      '/api/events': service('EVENTS_URL', 3002),
      '/api/orders': service('ORDERS_URL', 3003),
      '/api/tickets': service('TICKETS_URL', 3005),
      '/api/checkin': service('CHECKIN_URL', 3007),
    },
  },
});
