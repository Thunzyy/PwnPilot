import { describe, it, expect, beforeEach } from "vitest";
import {
  useCommandGlobalsStore,
  DEFAULT_COMMAND_GLOBALS,
} from "@/stores/commandGlobalsStore";

describe("commandGlobalsStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useCommandGlobalsStore.getState().resetDefaults();
  });

  it("loads defaults when storage is empty", () => {
    const vars = useCommandGlobalsStore.getState().variables;
    expect(vars).toEqual(DEFAULT_COMMAND_GLOBALS);
  });

  it("persists updates to localStorage", () => {
    useCommandGlobalsStore.getState().setVariable("target_ip", "10.0.0.1");
    const stored = JSON.parse(
      localStorage.getItem("pwnpilot:commands:globals:v1") || "{}"
    );
    expect(stored.target_ip).toBe("10.0.0.1");
  });
});
