/**
 * Marco PROVISORIO de la aplicación (encabezado y pie). La navegación por rol definitiva
 * es de P1; cada feature agrega aquí su enlace.
 */
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useSession } from './session';

export function Layout() {
  const { user, signOut } = useSession();

  return (
    <div className="app">
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <header className="site-header">
        <div className="site-header__inner">
          <Link to="/" className="brand" aria-label="EntradasYa, inicio">
            <svg viewBox="0 0 32 32" aria-hidden="true" className="brand__mark">
              <path d="M4 8h24v5a3 3 0 0 0 0 6v5H4v-5a3 3 0 0 0 0-6z" />
            </svg>
            <span>EntradasYa</span>
          </Link>
          <nav className="site-nav" aria-label="Principal">
            <NavLink to="/" end>
              Cartelera
            </NavLink>
            {user?.role === 'organizer' && <NavLink to="/organizador/eventos">Mis eventos</NavLink>}
            {user?.role === 'customer' && <NavLink to="/mis-entradas">Mis entradas</NavLink>}
          </nav>
          <div className="site-header__session">
            {user ? (
              <>
                <span className="site-header__user" title={user.email}>
                  {user.email ?? 'Sesión iniciada'}
                </span>
                <button type="button" className="btn btn--ghost-light btn--sm" onClick={signOut}>
                  Cerrar sesión
                </button>
              </>
            ) : (
              <Link to="/login" className="btn btn--primary btn--sm">
                Iniciar sesión
              </Link>
            )}
          </div>
        </div>
      </header>

      <main id="contenido" className="site-main">
        <Outlet />
      </main>

      <footer className="site-footer">
        <p>EntradasYa es un proyecto académico: los pagos son simulados y no se cobra dinero real.</p>
      </footer>
    </div>
  );
}
