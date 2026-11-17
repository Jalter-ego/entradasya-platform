import { BrowserRouter, Link, Route, Routes, useSearchParams } from 'react-router-dom';
import { CatalogPage } from './features/events/pages/CatalogPage';
import { EventDetailPage } from './features/events/pages/EventDetailPage';
import { EventFormPage } from './features/events/pages/EventFormPage';
import { OrganizerEventsPage } from './features/events/pages/OrganizerEventsPage';
import { Layout } from './shared/Layout';
import { LoginPage } from './shared/LoginPage';
import { RequireRole } from './shared/RequireRole';
import { SessionProvider } from './shared/session';

/**
 * Lugar provisorio del checkout: lo reemplaza P3 (features/orders).
 * Recibe ?eventId&sectorId&quantity desde el detalle del evento.
 */
function CheckoutPlaceholder() {
  const [params] = useSearchParams();
  return (
    <section className="page page--narrow notice">
      <h1>Checkout en construcción</h1>
      <p>
        Aquí continúa la compra (P3). Selección recibida: {params.get('quantity')} entrada(s) del sector{' '}
        <code>{params.get('sectorId')}</code>.
      </p>
      <Link className="btn btn--secondary" to={`/eventos/${params.get('eventId') ?? ''}`}>
        Volver al evento
      </Link>
    </section>
  );
}

function NotFound() {
  return (
    <section className="page page--narrow notice">
      <h1>Esta página no existe</h1>
      <p>Puede que el enlace esté mal escrito o que la página se haya movido.</p>
      <Link className="btn btn--primary" to="/">
        Ver la cartelera
      </Link>
    </section>
  );
}

export function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="login" element={<LoginPage />} />
          <Route element={<Layout />}>
            <Route index element={<CatalogPage />} />
            <Route path="eventos/:id" element={<EventDetailPage />} />
            <Route
              path="organizador/eventos"
              element={
                <RequireRole role="organizer">
                  <OrganizerEventsPage />
                </RequireRole>
              }
            />
            <Route
              path="organizador/eventos/nuevo"
              element={
                <RequireRole role="organizer">
                  <EventFormPage />
                </RequireRole>
              }
            />
            <Route
              path="organizador/eventos/:id"
              element={
                <RequireRole role="organizer">
                  <EventFormPage />
                </RequireRole>
              }
            />
            <Route path="checkout" element={<CheckoutPlaceholder />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}
