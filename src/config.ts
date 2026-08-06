import { RzdValidationError } from "./errors.ts";

export interface RzdConfig {
  language: "ru" | "en";
  baseUrl: string;
  b2bBaseUrl?: string;
  timeoutMs: number;
  retryTotal: number;
  retryBackoffMs: number;
  stationCacheTtlMs: number;
  stationCacheSize: number;
  proxy?: string;
  userAgent?: string;
  referer?: string;
}

export const defaultConfig: RzdConfig = {
  language: "ru",
  baseUrl: "https://ticket.rzd.ru/api/v1",
  timeoutMs: 25_000,
  retryTotal: 3,
  retryBackoffMs: 500,
  stationCacheTtlMs: 3_600_000,
  stationCacheSize: 256,
};

export function makeConfig(config: Partial<RzdConfig> = {}): RzdConfig {
  const value = { ...defaultConfig, ...config };
  if (!['ru', 'en'].includes(value.language)) throw new RzdValidationError("language must be either 'ru' or 'en'.");
  for (const [name, url] of [["baseUrl", value.baseUrl], ["b2bBaseUrl", value.b2bBaseUrl]] as const) {
    if (url !== undefined && !/^https?:\/\//.test(url)) throw new RzdValidationError(`${name} must be an absolute HTTP(S) URL.`);
  }
  if (value.timeoutMs <= 0 || value.retryTotal < 0 || value.retryBackoffMs < 0 || value.stationCacheTtlMs < 0 || value.stationCacheSize < 0) throw new RzdValidationError("Numeric configuration values are outside their supported range.");
  return value;
}
