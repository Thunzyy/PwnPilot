import { lazy } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LazyBoundary } from "../LazyBoundary";

describe("LazyBoundary", () => {
  it("renders a fallback while lazy content is still loading", () => {
    const PendingView = lazy(() => new Promise<never>(() => {}));

    render(
      <LazyBoundary fallbackLabel="Loading project view">
        <PendingView />
      </LazyBoundary>,
    );

    expect(screen.getByText("Loading project view")).toBeInTheDocument();
  });

  it("renders the lazy content once it resolves", async () => {
    const ReadyView = lazy(async () => ({
      default: () => <div>Ready</div>,
    }));

    render(
      <LazyBoundary fallbackLabel="Loading project view">
        <ReadyView />
      </LazyBoundary>,
    );

    expect(await screen.findByText("Ready")).toBeInTheDocument();
  });
});
