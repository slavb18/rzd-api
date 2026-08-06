import { describe, expect, test } from "bun:test";
import app from "../app.ts";
import { redact, schemeImageUrl } from "../src/log.ts";

describe("scheme image endpoint", () => {
  test("builds a link to this server, never to the configured upstream", () => {
    const url = schemeImageUrl("https://rzd-api.example", 306, "PcFirstStorey", [9, 10, 11, 12]);
    expect(url).toBe("https://rzd-api.example/scheme/306/PcFirstStorey.png?free=9%2C10%2C11%2C12");
    expect(url).not.toContain("proxy");
  });

  test("refuses a scheme id that is not a number", async () => {
    const response = await app.handle(new Request("https://example.vercel.app/scheme/not-a-number/PcFirstStorey.png"));
    expect(response.status).toBe(400);
  });

  test("refuses a layout the API does not define", async () => {
    const response = await app.handle(new Request("https://example.vercel.app/scheme/306/Whatever.png"));
    expect(response.status).toBe(400);
  });

  test("never serves anything for a traversal attempt", async () => {
    const response = await app.handle(new Request("https://example.vercel.app/scheme/306/../../etc/passwd"));
    expect(response.status).not.toBe(200);
    expect(response.headers.get("content-type") ?? "").not.toContain("image");
  });

  test("never tells a stranger which endpoint it failed to reach", async () => {
    const previous = { ...process.env };
    Object.assign(process.env, { RZD_BASE_URL: "https://secret-host.invalid/hidden-prefix/api/v1", RZD_TIMEOUT_MS: "1", RZD_RETRY_TOTAL: "0" });
    try {
      const response = await app.handle(new Request("https://example.vercel.app/scheme/552/PcFirstStorey.png?free=1,2"));
      const body = await response.text();
      expect(response.status).toBe(502);
      expect(body).not.toContain("secret-host");
      expect(body).not.toContain("hidden-prefix");
    } finally {
      for (const key of ["RZD_BASE_URL", "RZD_TIMEOUT_MS", "RZD_RETRY_TOTAL"]) delete process.env[key];
      Object.assign(process.env, previous);
    }
  });

  test("strips the configured endpoint out of a message before it is written down", () => {
    const message = redact("fetch failed for https://proxy.internal.example/secret-prefix/api/v1/suggests", "https://proxy.internal.example/secret-prefix/api/v1");
    expect(message).toBe("fetch failed for <endpoint>/suggests");
  });

  test("refuses more places than a carriage could hold", async () => {
    const free = Array.from({ length: 40 }, (_, index) => index + 1).join(",");
    const response = await app.handle(new Request(`https://example.vercel.app/scheme/306/PcFirstStorey.png?free=${free}`));
    expect(response.status).toBe(400);
  });
});
