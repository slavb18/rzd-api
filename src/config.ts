import { RzdValidationError } from "./errors.js";

export interface RzdConfig {
  language: "ru" | "en";
  baseUrl: string;
  b2bBaseUrl?: string;
  /** Public host used only for the scheme image links handed to users. Never derived from
   *  baseUrl: that one may point at a private proxy whose address must not be published. */
  schemeImageBaseUrl: string;
  timeoutMs: number;
  retryTotal: number;
  retryBackoffMs: number;
  stationCacheTtlMs: number;
  stationCacheSize: number;
  /** TLS verification stays on: ticket.rzd.ru presents a publicly trusted certificate.
   *  Only a deployment behind a proxy with a self-signed certificate should turn it off. */
  insecureTls: boolean;
  proxy?: string;
  userAgent?: string;
  referer?: string;
}

export const defaultConfig: RzdConfig = {
  language: "ru",
  baseUrl: "https://ticket.rzd.ru/api/v1",
  schemeImageBaseUrl: "https://ticket.rzd.ru/api/v1/carscheme/image",
  timeoutMs: 25_000,
  retryTotal: 3,
  retryBackoffMs: 500,
  stationCacheTtlMs: 3_600_000,
  stationCacheSize: 256,
  insecureTls: false,
};

export function makeConfig(config: Partial<RzdConfig> = {}): RzdConfig {
  const value = { ...defaultConfig, ...config };
  if (!['ru', 'en'].includes(value.language)) throw new RzdValidationError("language must be either 'ru' or 'en'.");
  for (const [name, url] of [["baseUrl", value.baseUrl], ["b2bBaseUrl", value.b2bBaseUrl], ["schemeImageBaseUrl", value.schemeImageBaseUrl]] as const) {
    if (url !== undefined && !/^https?:\/\//.test(url)) throw new RzdValidationError(`${name} must be an absolute HTTP(S) URL.`);
  }
  if (value.timeoutMs <= 0 || value.retryTotal < 0 || value.retryBackoffMs < 0 || value.stationCacheTtlMs < 0 || value.stationCacheSize < 0) throw new RzdValidationError("Numeric configuration values are outside their supported range.");
  return value;
}

export function configFromEnvironment(
  env: Record<string, string | undefined> = process.env,
): Partial<RzdConfig> {
  return {
    ...(env.RZD_BASE_URL ? { baseUrl: env.RZD_BASE_URL } : {}),
    ...(env.RZD_B2B_BASE_URL ? { b2bBaseUrl: env.RZD_B2B_BASE_URL } : {}),
    ...(env.RZD_SCHEME_IMAGE_BASE_URL ? { schemeImageBaseUrl: env.RZD_SCHEME_IMAGE_BASE_URL } : {}),
    ...(/^(1|true|yes)$/i.test(env.RZD_INSECURE_TLS ?? "") ? { insecureTls: true } : {}),
  };
}
