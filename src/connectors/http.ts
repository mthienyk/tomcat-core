import { ConnectorFailed } from "../errors/index.js";

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export type HttpClientOptions = {
  connector: string;
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
};

export type HttpRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  maxAttempts?: number;
};

export type HttpResponse = {
  status: number;
  ok: boolean;
  text(): Promise<string>;
  json<T>(): Promise<T>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type HttpClient = {
  request(path: string, opts?: HttpRequestOptions): Promise<HttpResponse>;
  json<T>(path: string, opts?: HttpRequestOptions): Promise<T>;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const buildUrl = (baseUrl: string | undefined, path: string): string => {
  if (!baseUrl) return path;
  if (/^https?:\/\//i.test(path)) return path;
  return path.startsWith("/") ? `${baseUrl}${path}` : `${baseUrl}/${path}`;
};

const parseRetryAfter = (header: string | null): number | undefined => {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
};

export const createHttpClient = (options: HttpClientOptions): HttpClient => {
  const {
    connector,
    baseUrl,
    defaultHeaders = {},
    timeoutMs = 15_000,
    maxAttempts = 3,
    baseDelayMs = 250,
    fetchImpl = fetch,
  } = options;

  const request = async (
    path: string,
    opts: HttpRequestOptions = {},
  ): Promise<HttpResponse> => {
    const url = buildUrl(baseUrl, path);
    const method = opts.method ?? "GET";
    const headers: Record<string, string> = { ...defaultHeaders, ...opts.headers };

    let body: string | undefined;
    if (opts.body !== undefined && opts.body !== null) {
      if (typeof opts.body === "string") {
        body = opts.body;
      } else {
        body = JSON.stringify(opts.body);
        if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
      }
    }

    const attempts = opts.maxAttempts ?? maxAttempts;
    const perAttemptTimeout = opts.timeoutMs ?? timeoutMs;

    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), perAttemptTimeout);
      try {
        const init: RequestInit = {
          method,
          headers,
          signal: controller.signal,
        };
        if (body !== undefined) init.body = body;
        const res = await fetchImpl(url, init);
        clearTimeout(timer);

        if (res.ok) {
          return {
            status: res.status,
            ok: true,
            text: () => res.text(),
            json: async <T>() => (await res.json()) as T,
            arrayBuffer: () => res.arrayBuffer(),
          };
        }

        const isRetryable =
          RETRYABLE_STATUS.has(res.status) && attempt < attempts;
        if (!isRetryable) {
          const text = await res.text().catch(() => "");
          throw ConnectorFailed(
            `${connector} ${method} ${path} → HTTP ${res.status}`,
            { status: res.status, body: text.slice(0, 500) },
          );
        }

        const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
        const delay =
          retryAfter ?? baseDelayMs * 2 ** (attempt - 1) + Math.random() * 100;
        await sleep(delay);
        lastError = ConnectorFailed(
          `${connector} ${method} ${path} → HTTP ${res.status}`,
          { status: res.status },
        );
        continue;
      } catch (err) {
        clearTimeout(timer);

        const isAbort =
          err instanceof Error &&
          (err.name === "AbortError" || err.message.includes("aborted"));
        const retryable = isAbort && attempt < attempts;
        if (!retryable) {
          if (err instanceof Error && err.name === "CoreError") throw err;
          throw ConnectorFailed(
            `${connector} ${method} ${path} failed`,
            { cause: err instanceof Error ? err.message : String(err) },
          );
        }
        lastError = err;
        await sleep(baseDelayMs * 2 ** (attempt - 1));
      }
    }

    throw ConnectorFailed(
      `${connector} ${method} ${path} exhausted ${attempts} attempts`,
      { cause: String(lastError) },
    );
  };

  return {
    request,
    async json<T>(path: string, opts?: HttpRequestOptions): Promise<T> {
      const res = await request(path, opts);
      return res.json<T>();
    },
  };
};
