import { describe, expect, test } from "bun:test";
import { configFromEnvironment, makeConfig, RzdClient, RzdValidationError } from "../src/index.ts";

describe("configuration", () => {
  test("applies defaults and overrides", () => {
    expect(makeConfig({ language: "en" }).baseUrl).toBe("https://ticket.rzd.ru/api/v1");
  });
  test("rejects invalid URLs", () => {
    expect(() => makeConfig({ baseUrl: "ftp://example.test" })).toThrow(RzdValidationError);
  });
  test("verifies the upstream TLS certificate by default", () => {
    expect(makeConfig().insecureTls).toBe(false);
  });
  test("allows a deployment behind a self-signed proxy to opt out explicitly", () => {
    expect(configFromEnvironment({ RZD_INSECURE_TLS: "1" })).toEqual({ insecureTls: true });
    expect(configFromEnvironment({ RZD_INSECURE_TLS: "0" })).toEqual({});
  });
  test("fails fast when it runs as a serverless function", () => {
    expect(configFromEnvironment({ VERCEL: "1" })).toEqual({ timeoutMs: 8_000, retryTotal: 1 });
    expect(configFromEnvironment({})).toEqual({});
  });
  test("lets the environment override the serverless timeout", () => {
    expect(configFromEnvironment({ VERCEL: "1", RZD_TIMEOUT_MS: "3000", RZD_RETRY_TOTAL: "0" })).toEqual({ timeoutMs: 3_000, retryTotal: 0 });
  });
  test("reads endpoint overrides from environment", () => {
    expect(configFromEnvironment({
      RZD_BASE_URL: "https://proxy.example/api/",
      RZD_B2B_BASE_URL: "https://proxy.example/b2b/",
    })).toEqual({
      baseUrl: "https://proxy.example/api/",
      b2bBaseUrl: "https://proxy.example/b2b/",
    });
  });
});

describe("client validation", () => {
  test("rejects identical station codes without making a request", async () => {
    const client = new RzdClient();
    await expect(client.getMinimalPrices(2000000, 2000000, futureDate())).rejects.toThrow("must be different");
    client.close();
  });
  test("rejects invalid time", async () => {
    const client = new RzdClient();
    await expect(client.getCarriages(1, 2, futureDate(), "25:00", "001А")).rejects.toThrow("HH:MM");
    client.close();
  });
  test("closed clients cannot resolve stations", async () => {
    const client = new RzdClient(); client.close();
    await expect(client.resolveStationCode(1)).rejects.toThrow("closed");
  });
});

function futureDate(): string { const date = new Date(Date.now() + 86_400_000 * 30); return date.toISOString().slice(0, 10); }
