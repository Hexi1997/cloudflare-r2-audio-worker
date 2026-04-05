import { describe, expect, it } from "vitest";
import { buildSignaturePayload, signPath, validateAntiLeeching } from "../src/auth";

describe("auth helpers", () => {
  it("builds deterministic signature payloads", () => {
    expect(buildSignaturePayload("/audio/demo.mp3", 123)).toBe("/audio/demo.mp3:123");
  });

  it("creates stable signatures", async () => {
    const signature = await signPath("/audio/demo.mp3", 123, "secret");
    expect(signature).toBe(await signPath("/audio/demo.mp3", 123, "secret"));
  });

  it("rejects missing referer", () => {
    const request = new Request("https://example.com/audio/demo.mp3");
    const result = validateAntiLeeching(request, ["https://allowed.example"], [/curl/i]);
    expect(result.ok).toBe(false);
  });

  it("rejects blocked user agents", () => {
    const request = new Request("https://example.com/audio/demo.mp3", {
      headers: {
        referer: "https://allowed.example/page",
        "user-agent": "curl/8.0.1",
      },
    });
    const result = validateAntiLeeching(request, ["https://allowed.example"], [/curl/i]);
    expect(result.ok).toBe(false);
  });
});
