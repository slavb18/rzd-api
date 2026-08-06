import { describe, expect, test } from "bun:test";
import { makeConfig, RzdClient, RzdValidationError } from "../src/index.ts";

describe("configuration", () => {
  test("applies defaults and overrides", () => {
    expect(makeConfig({ language: "en" }).baseUrl).toBe("https://ticket.rzd.ru/api/v1");
  });
  test("rejects invalid URLs", () => {
    expect(() => makeConfig({ baseUrl: "ftp://example.test" })).toThrow(RzdValidationError);
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
