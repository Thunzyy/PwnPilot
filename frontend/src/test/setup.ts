import "@testing-library/jest-dom";
import { vi } from "vitest";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function resolveStorage(kind: "localStorage" | "sessionStorage"): Storage {
  if (typeof window === "undefined") {
    return createMemoryStorage();
  }

  const candidate = window[kind];
  if (
    candidate &&
    typeof candidate.getItem === "function" &&
    typeof candidate.setItem === "function" &&
    typeof candidate.removeItem === "function" &&
    typeof candidate.clear === "function"
  ) {
    return candidate;
  }

  return createMemoryStorage();
}

const localStorageShim = resolveStorage("localStorage");
const sessionStorageShim = resolveStorage("sessionStorage");

Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: localStorageShim,
});

Object.defineProperty(window, "sessionStorage", {
  configurable: true,
  value: sessionStorageShim,
});

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorageShim,
});

Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: sessionStorageShim,
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: ResizeObserverMock,
});

if (typeof HTMLCanvasElement !== "undefined") {
  const canvasGradientStub = {
    addColorStop: vi.fn(),
  };

  const canvasContextStub = {
    fillStyle: "",
    strokeStyle: "",
    globalCompositeOperation: "source-over",
    createLinearGradient: vi.fn(() => canvasGradientStub),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    drawImage: vi.fn(),
    createImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) })),
    putImageData: vi.fn(),
  };

  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: vi.fn(() => canvasContextStub),
  });
}
