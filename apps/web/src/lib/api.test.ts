import { expect, it, vi } from "vitest";

it("uses the same-origin API when a build environment contains a backend address", async () => {
  vi.stubEnv("VITE_API_BASE_URL", "https://build-only.example/api");
  try {
    const { apiBaseUrl } = await import("./api");
    expect(apiBaseUrl).toBe("/api");
  } finally {
    vi.unstubAllEnvs();
  }
});
