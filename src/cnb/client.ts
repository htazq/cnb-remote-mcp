/**
 * Thin CNB OpenAPI client.
 *
 * Endpoint knowledge lives in the tool modules; this class only handles
 * transport concerns: base URL, bearer auth, CNB JSON content negotiation,
 * timeouts and error normalization.
 *
 * Auth convention (per official docs):
 *   Authorization: Bearer <token>
 *   Accept: application/vnd.cnb.api+json
 */

export class CnbApiError extends Error {
  readonly status: number;
  readonly traceparent?: string;
  readonly body?: string;

  constructor(status: number, message: string, opts?: { traceparent?: string; body?: string }) {
    super(message);
    this.name = "CnbApiError";
    this.status = status;
    this.traceparent = opts?.traceparent;
    this.body = opts?.body;
  }
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface CnbClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ERROR_BODY = 2_000;

export class CnbClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: CnbClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  get tokenFingerprint(): string {
    return `cnb:${this.token.slice(0, 4)}…${this.token.slice(-4)}`;
  }

  async get<T>(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    let qs = "";
    if (query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) params.append(key, String(value));
      }
      const encoded = params.toString();
      qs = encoded ? `?${encoded}` : "";
    }
    return this.request<T>("GET", `${path}${qs}`);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }

  delete<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("DELETE", path, body);
  }

  /** Raw text fetch (file contents, logs). */
  async getText(path: string): Promise<string> {
    const res = await this.raw("GET", path, undefined, "text/plain, */*");
    return res.text();
  }

  private async request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    accept?: string,
  ): Promise<T> {
    const res = await this.raw(method, path, body, accept);
    const text = await res.text();
    if (text.length === 0) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  private async raw(
    method: HttpMethod,
    path: string,
    body?: unknown,
    accept = "application/vnd.cnb.api+json",
  ): Promise<Response> {
    if (!path.startsWith("/")) throw new Error(`Internal error: path must start with / (${path})`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: accept,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) {
        const errBody = (await res.text().catch(() => "")).slice(0, MAX_ERROR_BODY);
        throw new CnbApiError(res.status, `CNB API ${method} ${path} -> ${res.status}`, {
          traceparent: res.headers.get("traceparent") ?? undefined,
          body: errBody,
        });
      }
      return res;
    } catch (err) {
      if (err instanceof CnbApiError) throw err;
      if ((err as Error).name === "AbortError") {
        throw new CnbApiError(504, `CNB API ${method} ${path} timed out after ${this.timeoutMs}ms`);
      }
      throw new CnbApiError(502, `CNB API unreachable: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Convert any thrown error into a concise, credential-free message for the LLM. */
export function describeCnbError(err: unknown): string {
  if (err instanceof CnbApiError) {
    const hint =
      err.status === 401
        ? " (upstream CNB token is missing, invalid or expired)"
        : err.status === 403
          ? " (the CNB token lacks permission for this operation)"
          : err.status === 404
            ? " (resource not found or no access)"
            : err.status === 429
              ? " (rate limited by CNB, retry later)"
              : "";
    const body = err.body ? `: ${err.body.replace(/\s+/g, " ").slice(0, 500)}` : "";
    return `CNB API error ${err.status}${hint}${body}${err.traceparent ? ` [trace ${err.traceparent}]` : ""}`;
  }
  return (err as Error)?.message ?? String(err);
}
