import { describe, expect, test } from "bun:test";
import { endpointLabel, logEvent } from "../src/log.ts";

const privateBase = "https://proxy.internal.example/secret-prefix/api/v1";

describe("logging", () => {
  test("names an upstream call without repeating the endpoint it was configured with", () => {
    const label = endpointLabel(`${privateBase}/suggests?Query=%D0%9C&Language=ru`, privateBase);
    expect(label).toBe("suggests");
    expect(label).not.toContain("proxy.internal.example");
    expect(label).not.toContain("secret-prefix");
  });

  test("keeps the path below the endpoint, which is what tells the calls apart", () => {
    expect(endpointLabel(`${privateBase}/railway-service/carscheme?CarNumber=12`, privateBase)).toBe("railway-service/carscheme");
    expect(endpointLabel(`${privateBase}/carscheme/image/552/PcFirstStorey`, privateBase)).toBe("carscheme/image/552/PcFirstStorey");
  });

  test("falls back to the path alone when the URL is not under the configured endpoint", () => {
    const label = endpointLabel("https://elsewhere.example/some/path?q=1", privateBase);
    expect(label).toBe("some/path");
    expect(label).not.toContain("elsewhere.example");
  });

  test("writes one line of JSON per event", () => {
    const written: string[] = [];
    const original = console.log;
    console.log = (line: string) => written.push(line);
    try { logEvent({ tool: "search_full_compartments", ms: 12, ok: true }); } finally { console.log = original; }
    expect(written).toHaveLength(1);
    const event = JSON.parse(written[0]!);
    expect(event).toMatchObject({ tool: "search_full_compartments", ms: 12, ok: true });
    expect(event.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
