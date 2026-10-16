export type ApiBody<T> = Partial<T> & { message?: string };

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  data: ApiBody<T>;
}

/** Llamada JSON a la API propia. Nunca lanza: devuelve el estado y el mensaje del servidor. */
export async function requestJson<T = unknown>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, {
      ...init,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    const data = (await response.json().catch(() => ({}))) as ApiBody<T>;
    return { ok: response.ok, status: response.status, data };
  } catch {
    return {
      ok: false,
      status: 0,
      data: { message: "No se pudo conectar con el servidor." } as ApiBody<T>,
    };
  }
}
