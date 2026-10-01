// Vacío en producción (.env.production): instalado como servicio, el backend sirve el
// frontend y la API en el mismo origen.
const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) || window.location.origin;
const TOKEN_KEY = 'auth_token';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function handleUnauthorized() {
  localStorage.removeItem(TOKEN_KEY);
  // La sesión persistida (usuario/empresa/permisos, ver auth.store) se limpia junto al
  // token: dejarla huérfana haría que el próximo arranque restaure permisos de una
  // sesión ya expirada.
  localStorage.removeItem('auth_sesion');
  if (location.pathname !== '/login') location.href = '/login';
}

function buildUrl(path: string, params?: Record<string, string | number | undefined>): URL {
  const url = new URL(path, BASE_URL);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const resp = await fetch(buildUrl(path, params).toString(), { headers: authHeaders() });
  if (resp.status === 401) handleUnauthorized();
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ message: resp.statusText }));
    throw new Error(body.message ?? `Error ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

export const api = {
  get: request,
  async post<T>(path: string, body: unknown): Promise<T> {
    const resp = await fetch(buildUrl(path).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (resp.status === 401) handleUnauthorized();
    if (!resp.ok) {
      const responseBody = await resp.json().catch(() => ({ message: resp.statusText }));
      throw new Error(responseBody.message ?? `Error ${resp.status}`);
    }
    return resp.json() as Promise<T>;
  },
  async put<T>(path: string, body: unknown): Promise<T> {
    const resp = await fetch(buildUrl(path).toString(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (resp.status === 401) handleUnauthorized();
    if (!resp.ok) {
      const responseBody = await resp.json().catch(() => ({ message: resp.statusText }));
      throw new Error(responseBody.message ?? `Error ${resp.status}`);
    }
    return resp.json() as Promise<T>;
  },
  async delete<T>(path: string, body: unknown): Promise<T> {
    const resp = await fetch(buildUrl(path).toString(), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (resp.status === 401) handleUnauthorized();
    if (!resp.ok) {
      const responseBody = await resp.json().catch(() => ({ message: resp.statusText }));
      throw new Error(responseBody.message ?? `Error ${resp.status}`);
    }
    return resp.json() as Promise<T>;
  },
  /** Returns the raw Response for endpoints that stream a file (e.g. xlsx reports). */
  async getFile(path: string, params?: Record<string, string | number | undefined>): Promise<Response> {
    const resp = await fetch(buildUrl(path, params).toString(), { headers: authHeaders() });
    if (resp.status === 401) handleUnauthorized();
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({ message: resp.statusText }));
      throw new Error(body.message ?? `Error ${resp.status}`);
    }
    return resp;
  },
};
