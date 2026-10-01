import { afterEach, describe, expect, it, vi } from "vitest";

import {
  alignLocalApiBaseToCurrentHostname,
  buildLocalApiBaseCandidates,
  isHealthyPwnPilotResponse,
  selectHealthyApiBase,
} from "../client";

describe("client local API discovery", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("prefers a healthy local backend on 8001 when 8000 is not PwnPilot", async () => {
    const candidates = buildLocalApiBaseCandidates({ hostname: "localhost" });
    const probe = vi.fn(async (base: string) => {
      if (base === "http://localhost:8001") {
        return { app: "PwnPilot", status: "healthy", version: "0.1.0" };
      }

      if (base === "http://localhost:8000") {
        return { app: "Tomcat", status: "ok" };
      }

      throw new Error("Connection refused");
    });

    await expect(selectHealthyApiBase(candidates, probe)).resolves.toBe(
      "http://localhost:8001"
    );
    expect(probe).toHaveBeenCalledWith("http://localhost:8000");
    expect(probe).toHaveBeenCalledWith("http://localhost:8001");
  });

  it("only treats PwnPilot health responses as valid", () => {
    expect(
      isHealthyPwnPilotResponse({
        app: "PwnPilot",
        status: "healthy",
        version: "0.1.0",
      })
    ).toBe(true);
    expect(isHealthyPwnPilotResponse({ app: "Tomcat", status: "ok" })).toBe(
      false
    );
    expect(isHealthyPwnPilotResponse(null)).toBe(false);
  });

  it("skips a hanging local probe instead of waiting forever", async () => {
    vi.useFakeTimers();
    const candidates = [
      "http://127.0.0.1:8000",
      "http://127.0.0.1:8001",
    ];
    const probe = vi.fn((base: string) => {
      if (base === "http://127.0.0.1:8000") {
        return new Promise(() => undefined);
      }

      return Promise.resolve({
        app: "PwnPilot",
        status: "healthy",
        version: "0.1.0",
      });
    });

    const selectedBasePromise = selectHealthyApiBase(candidates, probe, 1500);

    await vi.advanceTimersByTimeAsync(1500);

    await expect(selectedBasePromise).resolves.toBe("http://127.0.0.1:8001");
    expect(probe).toHaveBeenNthCalledWith(1, "http://127.0.0.1:8000");
    expect(probe).toHaveBeenNthCalledWith(2, "http://127.0.0.1:8001");
  });

  it("aligns a configured local loopback API base to the current localhost hostname", () => {
    expect(
      alignLocalApiBaseToCurrentHostname("http://127.0.0.1:8001", {
        hostname: "localhost",
      })
    ).toBe("http://localhost:8001");
  });

  it("keeps configured non-local API bases unchanged", () => {
    expect(
      alignLocalApiBaseToCurrentHostname("https://api.example.com", {
        hostname: "localhost",
      })
    ).toBe("https://api.example.com");
  });
});
