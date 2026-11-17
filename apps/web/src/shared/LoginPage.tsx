/**
 * Pantalla de inicio de sesión y registro. La interfaz queda para P1; solo cambia
 * a dónde se envían los datos (ver shared/authApi.ts).
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from './api';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, login } from './authApi';
import { EyeIcon, EyeOffIcon, LockIcon, MailIcon, UserIcon } from './icons';
import { useSession } from './session';
import './login.css';

type Tab = 'login' | 'register';

function InputWithIcon({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="input-icon">
      {icon}
      {children}
    </div>
  );
}

export function LoginPage() {
  const { signIn, user } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  function destination(role: string) {
    const next = params.get('next');
    if (next && next.startsWith('/') && !next.startsWith('//')) return next;
    return role === 'organizer' ? '/organizador/eventos' : '/';
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Escribe tu correo y tu contraseña.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const { token } = await login(email.trim(), password);
      if (!signIn(token)) throw new Error('token inválido');
      const role = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role as string;
      navigate(destination(role), { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 0 || err.status === 404
            ? 'El servicio de cuentas no está disponible. Intenta más tarde.'
            : err.message
          : 'No se pudo iniciar sesión.',
      );
      setSending(false);
    }
  }

  function fillDemo(demoEmail: string) {
    setTab('login');
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
    setError(null);
  }

  return (
    <div className="auth">
      <div className="auth__glow" aria-hidden="true" />
      <Link to="/" className="auth__brand" aria-label="EntradasYa, volver a la cartelera">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M4 8h24v5a3 3 0 0 0 0 6v5H4v-5a3 3 0 0 0 0-6z" />
        </svg>
        EntradasYa
      </Link>

      <main className="auth__card">
        <div className="auth__tabs" role="tablist" aria-label="Acceso">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'login'}
            onClick={() => {
              setTab('login');
              setError(null);
            }}
          >
            Iniciar sesión
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'register'}
            onClick={() => {
              setTab('register');
              setError(null);
            }}
          >
            Registrarse
          </button>
        </div>

        {user && (
          <p className="auth__notice">
            Ya iniciaste sesión como <strong>{user.email}</strong>.{' '}
            <Link to={destination(user.role)}>Continuar</Link>
          </p>
        )}

        {tab === 'login' ? (
          <form onSubmit={submit} className="auth__form" noValidate>
            <label className="field">
              <span className="field__label">Correo</span>
              <InputWithIcon icon={<MailIcon />}>
                <input
                  className="input"
                  type="email"
                  autoComplete="username"
                  placeholder="tu@correo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </InputWithIcon>
            </label>
            <label className="field">
              <span className="field__label">Contraseña</span>
              <InputWithIcon icon={<LockIcon />}>
                <input
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Tu contraseña"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="input-icon__toggle"
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </InputWithIcon>
            </label>

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={sending}>
              {sending ? 'Ingresando…' : 'Iniciar sesión'}
            </button>
          </form>
        ) : (
          <form
            className="auth__form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              setError('El registro de cuentas estará disponible cuando se conecte el servicio de cuentas. Por ahora usa una cuenta de demo.');
            }}
          >
            <label className="field">
              <span className="field__label">Nombre</span>
              <InputWithIcon icon={<UserIcon />}>
                <input className="input" autoComplete="name" placeholder="Tu nombre" />
              </InputWithIcon>
            </label>
            <label className="field">
              <span className="field__label">Correo</span>
              <InputWithIcon icon={<MailIcon />}>
                <input className="input" type="email" autoComplete="email" placeholder="tu@correo.com" />
              </InputWithIcon>
            </label>
            <label className="field">
              <span className="field__label">Contraseña</span>
              <InputWithIcon icon={<LockIcon />}>
                <input className="input" type="password" autoComplete="new-password" placeholder="Mínimo 8 caracteres" />
              </InputWithIcon>
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn btn--primary btn--lg btn--block">
              Crear cuenta
            </button>
          </form>
        )}

        {DEMO_ACCOUNTS.length > 0 && (
          <section className="auth__demo" aria-labelledby="demo-title">
            <h2 id="demo-title">Cuentas de demo</h2>
            <p>
              Contraseña para todas: <code>{DEMO_PASSWORD}</code>
            </p>
            <ul>
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.email}>
                  <button type="button" onClick={() => fillDemo(a.email)}>
                    <strong>{a.label}</strong>
                    <span>{a.email}</span>
                    <small>{a.hint}</small>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <Link to="/" className="auth__back">
        Volver a la cartelera
      </Link>
    </div>
  );
}
