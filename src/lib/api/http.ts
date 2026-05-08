/**
 * Shared `fetch` wrapper for the typed API layer.
 *
 * - Always sends/receives JSON unless the body is `FormData` (which the
 *   browser must set the multipart boundary on itself).
 * - Throws an `Error` with a useful message on non-2xx responses,
 *   preferring the API's `error` field when present.
 * - `null` responses (HTTP 204) parse as `null`.
 */

export interface ApiErrorBody {
  error?: string;
  issues?: { fieldErrors?: Record<string, string[]> };
}

export class ApiError extends Error {
  status: number;
  body: ApiErrorBody;
  constructor(message: string, status: number, body: ApiErrorBody) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export async function http<T>(input: string, init?: RequestInit): Promise<T> {
  const isFormData =
    typeof FormData !== 'undefined' && init?.body instanceof FormData;

  const headers: Record<string, string> = isFormData
    ? { ...(init?.headers as Record<string, string> | undefined) }
    : { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string> | undefined) };

  const res = await fetch(input, { ...init, headers });

  if (res.status === 204) {
    return null as unknown as T;
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new ApiError(body.error ?? `Request failed with status ${res.status}`, res.status, body);
  }

  // Some endpoints respond with empty bodies on 200; tolerate that.
  const text = await res.text();
  if (!text) return null as unknown as T;
  return JSON.parse(text) as T;
}
