import { describe, expect, it, vi } from "vitest";
import { probeGatewayHealth } from "../../src/buddy/health.js";

describe("primary gateway health", () => {
  it("reports the configured primary as a provider target", async () => {
    const request = vi.fn(
      async (input: string | URL | Request) =>
        new Response(null, { status: String(input).endsWith("/ready") ? 200 : 503 }),
    ) as unknown as typeof fetch;
    const health = await probeGatewayHealth(
      {},
      {
        fetch: request,
        timeoutMs: 50,
        readConnection: async () => ({
          url: new URL("https://gateway.example/v1/models"),
          headers: new Headers({ Authorization: "Bearer secret" }),
          providerId: "sub2api",
        }),
      },
    );
    expect(health).toMatchObject({
      supported: true,
      healthy: true,
      providers: [
        {
          id: "sub2api",
          name: "sub2api",
          baseUrl: "https://gateway.example/v1",
          fallback: false,
          healthy: true,
          status: 200,
        },
      ],
    });
  });

  it("reports an unavailable configuration without throwing", async () => {
    const health = await probeGatewayHealth(
      {},
      {
        readConnection: async () => {
          throw new Error("config missing");
        },
      },
    );
    expect(health).toMatchObject({
      supported: true,
      healthy: false,
      status: null,
      reason: "config missing",
      providers: [],
    });
  });
});
