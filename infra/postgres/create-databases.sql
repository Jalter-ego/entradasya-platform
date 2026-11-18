-- EntradasYa v1 — Crea las seis bases y sus usuarios exclusivos (P4, tarea D1).
-- Referencia: docs/database/README.md §1.
--
-- Ejecutar como administrador de PostgreSQL (por ejemplo, postgres) con psql.
-- Las claves NO se guardan aquí: llegan como variables de psql.
--
--   psql -U postgres -d postgres -f infra/postgres/create-databases.sql \
--     -v auth_password='...'     -v events_password='...' \
--     -v orders_password='...'   -v payments_password='...' \
--     -v tickets_password='...'  -v checkin_password='...' \
--     [-v with_test_dbs=1]
--
-- Lo normal es usar los envoltorios setup-databases.sh / setup-databases.ps1,
-- que leen las claves de infra/postgres/.env.
--
-- Es idempotente: repetirlo no borra datos. Si el usuario ya existe, actualiza su
-- clave; si la base ya existe, solo reafirma dueño y permisos.
-- Solo crea bases y usuarios: las tablas las crea cada servicio con sus migraciones.

\set ON_ERROR_STOP on

\if :{?with_test_dbs}
\else
  \set with_test_dbs 0
\endif

-- 1. Usuarios: LOGIN, sin privilegios de administración. ------------------------
CREATE TEMP TABLE ey_services (service text, db text, usr text, pw text);
INSERT INTO ey_services VALUES
  ('auth',     'auth_db',     'auth_user',     :'auth_password'),
  ('events',   'events_db',   'events_user',   :'events_password'),
  ('orders',   'orders_db',   'orders_user',   :'orders_password'),
  ('payments', 'payments_db', 'payments_user', :'payments_password'),
  ('tickets',  'tickets_db',  'tickets_user',  :'tickets_password'),
  ('checkin',  'checkin_db',  'checkin_user',  :'checkin_password');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM ey_services WHERE length(pw) < 12) THEN
    RAISE EXCEPTION 'Cada clave debe tener al menos 12 caracteres';
  END IF;
END $$;

SELECT format('CREATE ROLE %I', usr)
  FROM ey_services
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = usr) \gexec

SELECT format(
         'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
         usr, pw)
  FROM ey_services \gexec

-- 2. Bases (y, con with_test_dbs=1, bases desechables <servicio>_test). ----------
CREATE TEMP TABLE ey_databases (db text, usr text);
INSERT INTO ey_databases SELECT db, usr FROM ey_services;
INSERT INTO ey_databases
  SELECT service || '_test', usr FROM ey_services WHERE :with_test_dbs::int = 1;

SELECT format('CREATE DATABASE %I OWNER %I ENCODING %L TEMPLATE template0', db, usr, 'UTF8')
  FROM ey_databases
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = db) \gexec

-- 3. Aislamiento: solo su dueño puede conectarse a cada base. --------------------
SELECT format('ALTER DATABASE %I OWNER TO %I', db, usr) FROM ey_databases \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', db) FROM ey_databases \gexec
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I', db, usr) FROM ey_databases \gexec

-- 4. El dueño de cada base también es dueño de su schema public, para que sus ------
--    migraciones puedan crear tablas tanto en PostgreSQL 14 como en 15+.
\connect auth_db
ALTER SCHEMA public OWNER TO auth_user;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
\connect events_db
ALTER SCHEMA public OWNER TO events_user;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
\connect orders_db
ALTER SCHEMA public OWNER TO orders_user;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
\connect payments_db
ALTER SCHEMA public OWNER TO payments_user;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
\connect tickets_db
ALTER SCHEMA public OWNER TO tickets_user;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
\connect checkin_db
ALTER SCHEMA public OWNER TO checkin_user;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

\if :with_test_dbs
\connect auth_test
ALTER SCHEMA public OWNER TO auth_user;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
\connect events_test
ALTER SCHEMA public OWNER TO events_user;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
\connect orders_test
ALTER SCHEMA public OWNER TO orders_user;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
\connect payments_test
ALTER SCHEMA public OWNER TO payments_user;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
\connect tickets_test
ALTER SCHEMA public OWNER TO tickets_user;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
\connect checkin_test
ALTER SCHEMA public OWNER TO checkin_user;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
\endif

\echo 'Listo: seis bases y seis usuarios exclusivos preparados.'
