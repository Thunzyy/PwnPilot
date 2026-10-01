/**
 * useDebounce Hook Tests
 *
 * Validates delay behavior, timer cancellation on rapid updates,
 * and edge cases (delay=0).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebounce } from "../useDebounce";

describe("useDebounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns initial value immediately", () => {
    const { result } = renderHook(() => useDebounce("hello", 300));
    expect(result.current).toBe("hello");
  });

  it("updates value after delay", () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: "hello", delay: 300 } },
    );

    rerender({ value: "world", delay: 300 });
    expect(result.current).toBe("hello");

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe("world");
  });

  it("cancels previous timer on rapid updates", () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: "a", delay: 300 } },
    );

    // Quick update to "b" at ~100ms
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ value: "b", delay: 300 });

    // Quick update to "c" at ~200ms
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ value: "c", delay: 300 });

    // Advance past all possible timers
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Only "c" should have made it through
    expect(result.current).toBe("c");
  });

  it("handles delay of 0", () => {
    const { result } = renderHook(() => useDebounce("fast", 0));

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe("fast");
  });
});
