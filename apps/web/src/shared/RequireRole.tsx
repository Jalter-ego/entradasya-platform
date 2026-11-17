import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useSession, type Role } from './session';

/** Muestra el contenido solo al rol indicado. La API vuelve a comprobarlo en el servidor. */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user } = useSession();
  const location = useLocation();
  const account = role === 'organizer' ? 'organizador' : role === 'customer' ? 'cliente' : role === 'doorman' ? 'portero' : null;

  if (!user) {
    return (
      <section className="page page--narrow notice">
        <h1>Inicia sesión para continuar</h1>
        <p>{account ? `Esta sección requiere una cuenta de ${account}.` : 'Inicia sesión con una cuenta autorizada.'}</p>
        <Link className="btn btn--primary" to={`/login?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`}>
          Iniciar sesión
        </Link>
      </section>
    );
  }
  if (user.role !== role) {
    return (
      <section className="page page--narrow notice">
        <h1>No tienes acceso a esta sección</h1>
        <p>Tu cuenta no tiene permisos para esta sección.</p>
        <Link className="btn btn--secondary" to="/">
          Ir a la cartelera
        </Link>
      </section>
    );
  }
  return <>{children}</>;
}
