import { describe, expect, it } from "vitest";
import { createQueryClient } from "../queryClient";

describe("queryClient", () => {
  it("uses stable defaults for server-state queries and mutations", () => {
    const client = createQueryClient();
    const defaults = client.getDefaultOptions();

    expect(defaults.queries).toMatchObject({
      staleTime: 30_000,
      gcTime: 300_000,
      retry: 1,
      refetchOnWindowFocus: false,
    });
    expect(defaults.mutations).toMatchObject({
      retry: 0,
    });
  });
});
