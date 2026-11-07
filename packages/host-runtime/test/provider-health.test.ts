import { describe, expect, it, vi } from "vitest";
import { probeProviderHealth, providerHealthUrls } from "../src/provider-health.js";

const response = (status: number) => new Response(null, { status });
const fakeFetch = (handler: (url: string) => Response) =>
  vi.fn(async (input: string | URL | Request) => handler(String(input))) as unknown as typeof fetch;

describe("provider health probe", () => {
  it("checks the API prefix and the site root without sending credentials", async () => {
    expect(providerHealthUrls("https://gateway.example/proxy/v1")).toEqual([
      "https://gateway.example/proxy/ready",
      "https://gateway.example/proxy/health",
      "https://gateway.example/ready",
      "https://gateway.example/health",
    ]);
    const request = fakeFetch((url) => response(url.endsWith("/ready") ? 200 : 503));
    await expect(
      probeProviderHealth(
        "https://gateway.example/v1",
        { Authorization: "Bearer secret" },
        { fetch: request, timeoutMs: 50 },
      ),
    ).resolves.toEqual({ healthy: true, status: 200, reason: null });
    expect(request).toHaveBeenCalledTimes(1);
    const headers = (vi.mocked(request).mock.calls[0]?.[1] as RequestInit | undefined)?.headers;
    expect(new Headers(headers).get("Authorization")).toBeNull();
  });

  it("treats a failing readiness endpoint as unavailable without trying liveness", async () => {
    const request = fakeFetch(() => response(503));
    await expect(
      probeProviderHealth("https://gateway.example/v1", undefined, {
        fetch: request,
        timeoutMs: 50,
      }),
    ).resolves.toEqual({ healthy: false, status: 503, reason: "HTTP 503" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("falls back to liveness and then to the authenticated model catalog", async () => {
    const request = fakeFetch((url) =>
      response(url.endsWith("/ready") || url.endsWith("/health") ? 404 : 200),
    );
    await expect(
      probeProviderHealth(
        "https://gateway.example/v1",
        { Authorization: "Bearer secret" },
        { fetch: request, timeoutMs: 50 },
      ),
    ).resolves.toEqual({ healthy: true, status: 200, reason: null });
    expect(request).toHaveBeenCalledTimes(3);
    expect(vi.mocked(request).mock.calls[2]?.[0]).toBe("https://gateway.example/v1/models");
    const headers = new Headers(
      (vi.mocked(request).mock.calls[2]?.[1] as RequestInit | undefined)?.headers,
    );
    expect(headers.get("Authorization")).toBe("Bearer secret");
  });

  it("returns an unhealthy result for network failures", async () => {
    const request = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(
      probeProviderHealth("https://gateway.example/v1", undefined, {
        fetch: request,
        timeoutMs: 50,
      }),
    ).resolves.toMatchObject({
      healthy: false,
      status: null,
      reason: "connect ECONNREFUSED",
    });
  });
});
