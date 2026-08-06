import { describe, expect, test } from "bun:test";
import app from "../app.ts";
import { schemeImageUrl } from "../src/log.ts";

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

  test("refuses more places than a carriage could hold", async () => {
    const free = Array.from({ length: 40 }, (_, index) => index + 1).join(",");
    const response = await app.handle(new Request(`https://example.vercel.app/scheme/306/PcFirstStorey.png?free=${free}`));
    expect(response.status).toBe(400);
  });
});
