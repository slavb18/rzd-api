import { RzdApiError, RzdHttpError, RzdTransportError, RzdValidationError } from "./errors.ts";
import type { RzdConfig } from "./config.ts";
import type { JsonObject } from "./models.ts";

export type JsonPayload = JsonObject | unknown[];

export class RzdTransport {
  #closed = false;
  constructor(readonly config: RzdConfig) {}

  async requestJson(method: "GET" | "POST", url: string, options: { params?: Record<string, unknown>; body?: JsonObject } = {}): Promise<JsonPayload> {
    if (this.#closed) throw new RzdTransportError("The RZD client is closed.");
    if (method !== "GET" && method !== "POST") throw new RzdValidationError(`Unsupported HTTP method: ${method}`);
    const target = new URL(url);
    for (const [key, value] of Object.entries(options.params ?? {})) if (value !== undefined) target.searchParams.set(key, String(value));
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.retryTotal; attempt++) {
      try {
        const response = await fetch(target, {
          method,
          headers: {
            Accept: "application/json, text/plain, */*",
            "User-Agent": this.config.userAgent ?? "Mozilla/5.0 AppleWebKit/537.36 Chrome/146 Safari/537.36",
            Referer: this.config.referer ?? "https://ticket.rzd.ru/",
            ...(options.body ? { "Content-Type": "application/json" } : {}),
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: AbortSignal.timeout(this.config.timeoutMs),
          ...(this.config.proxy ? { proxy: this.config.proxy } : {}),
          tls: { rejectUnauthorized: false },
        } as RequestInit);
        const text = await response.text();
        if (!response.ok) {
          if ([429, 500, 502, 503, 504].includes(response.status) && attempt < this.config.retryTotal) {
            const retryAfter = Number(response.headers.get("retry-after"));
            await Bun.sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : this.config.retryBackoffMs * 2 ** attempt);
            continue;
          }
          throw new RzdHttpError(response.status, text.slice(0, 300).trim());
        }
        let payload: unknown;
        try { payload = JSON.parse(text); } catch { throw new RzdTransportError(`RZD returned non-JSON content: ${text.slice(0, 300).trim()}`); }
        if (!isObject(payload) && !Array.isArray(payload)) throw new RzdTransportError("RZD returned a JSON scalar instead of an object or array.");
        if (isObject(payload)) this.#raiseApiError(payload);
        return payload;
      } catch (error) {
        if (error instanceof RzdHttpError || error instanceof RzdApiError || error instanceof RzdTransportError) throw error;
        lastError = error;
        if (attempt < this.config.retryTotal) { await Bun.sleep(this.config.retryBackoffMs * 2 ** attempt); continue; }
      }
    }
    throw new RzdTransportError(`RZD request failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  #raiseApiError(payload: JsonObject): void {
    const info = payload.errorInfo;
    if (isObject(info) && String(info.Code ?? "0") !== "0") throw new RzdApiError(info.Code, String(info.Message ?? "RZD API returned an error."));
    if (typeof payload.message === "string" && payload.message) throw new RzdApiError(undefined, payload.message);
  }
  close(): void { this.#closed = true; }
}

export function isObject(value: unknown): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
