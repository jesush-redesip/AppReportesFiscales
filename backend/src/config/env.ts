import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  db: {
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 1433),
    // No fixed tenant database anymore — which one to use is decided per-session at
    // login time (the user picks a company, its `BD` comes from
    // GENERAL.dbo.EMPRESAS.PATHBD) and served via `shared/db/tenant-pool.ts`.
    // `GENERAL` is the ICG platform's shared login/tenant-directory database
    // (USUARIOS/EMPRESAS/EMPRESASUSUARIO) — lives on the same SQL Server instance,
    // confirmed against the decompiled `login.jar`.
    generalDatabase: process.env.GENERAL_DB_NAME ?? 'GENERAL',
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
  },
  jwtSecret: required('JWT_SECRET'),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  /** Instalado como servicio: el backend sirve también el frontend compilado (frontend/dist). */
  produccion: process.env.NODE_ENV === 'production',
  actualizador: {
    /** Repositorio público de GitHub con los Releases ("usuario/repositorio"). Vacío = desactivado. */
    repo: (process.env.UPDATE_REPO ?? '').trim(),
    /** Nombre del servicio de Windows que se detiene y arranca al actualizar. */
    servicio: (process.env.SERVICE_NAME ?? '').trim(),
    /** Opcional: token de GitHub, solo para no chocar con el límite de 60 consultas/hora. */
    tokenGithub: (process.env.GITHUB_TOKEN ?? '').trim(),
    /** Solo para pruebas (un servidor que imite la API de GitHub). */
    apiGithub: (process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, ''),
  },
};
