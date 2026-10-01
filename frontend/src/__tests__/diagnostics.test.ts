import { beforeEach, describe, expect, it } from "vitest";

import {
  buildApiDiagnosticsEvent,
  classifyDiagnosticsUrl,
  isDevDiagnosticsEnabled,
} from "@/lib/diagnostics";
import { useDiagnosticsStore } from "@/stores/diagnosticsStore";

describe("diagnostics helpers", () => {
  it("enables diagnostics UI only for development builds", () => {
    expect(isDevDiagnosticsEnabled(true)).toBe(true);
    expect(isDevDiagnosticsEnabled(false)).toBe(false);
  });

  it("classifies operational URLs by owning subsystem", () => {
    expect(classifyDiagnosticsUrl("/terminal/sessions")).toBe("terminal");
    expect(classifyDiagnosticsUrl("/api/v1/terminal/ws/session-1")).toBe(
      "terminal"
    );
    expect(classifyDiagnosticsUrl("/projects/p1/vpn-status")).toBe("vpn");
    expect(classifyDiagnosticsUrl("/settings/vpn-platforms")).toBe("vpn");
    expect(classifyDiagnosticsUrl("/ai/providers")).toBe("ai");
    expect(classifyDiagnosticsUrl("/ws/ai/global")).toBe("ai");
    expect(classifyDiagnosticsUrl("/projects/p1")).toBe("api");
  });

  it("builds a readable API diagnostics event from an axios error payload", () => {
    const event = buildApiDiagnosticsEvent({
      code: "ERR_BAD_RESPONSE",
      message: "Request failed with status code 502",
      config: {
        method: "get",
        url: "/projects/p1/vpn-status",
      },
      response: {
        status: 502,
        data: {
          detail: "HTB VPN platform unavailable",
        },
      },
    });

    expect(event).toMatchObject({
      category: "vpn",
      severity: "error",
      title: "VPN API request failed",
      message: "HTB VPN platform unavailable",
      method: "GET",
      status: 502,
      source: "/projects/p1/vpn-status",
      code: "ERR_BAD_RESPONSE",
    });
  });
});

describe("diagnostics store", () => {
  beforeEach(() => {
    useDiagnosticsStore.getState().clearEvents();
  });

  it("records newest events first and trims old entries", () => {
    for (let index = 0; index < 85; index += 1) {
      useDiagnosticsStore.getState().recordEvent({
        category: "api",
        severity: "error",
        title: `Event ${index}`,
        message: `Failure ${index}`,
        source: `/api/${index}`,
      });
    }

    const events = useDiagnosticsStore.getState().events;

    expect(events).toHaveLength(80);
    expect(events[0]).toMatchObject({
      title: "Event 84",
      count: 1,
    });
    expect(events.at(-1)).toMatchObject({
      title: "Event 5",
    });
  });

  it("clears all captured events", () => {
    useDiagnosticsStore.getState().recordEvent({
      category: "terminal",
      severity: "error",
      title: "Terminal WebSocket failed",
      message: "Unable to connect",
    });

    useDiagnosticsStore.getState().clearEvents();

    expect(useDiagnosticsStore.getState().events).toEqual([]);
  });
});
