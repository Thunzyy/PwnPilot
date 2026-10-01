import { describe, expect, it, vi, beforeEach } from "vitest";
import { toast } from "sonner";

import { showApiErrorToast } from "@/lib/apiToast";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

describe("showApiErrorToast", () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockReset();
  });

  it("shows backend error details as the toast description", () => {
    showApiErrorToast(
      "Failed to add source",
      {
        response: {
          data: {
            error: {
              message: "Selected project cannot write to this vault path.",
            },
          },
        },
      },
      "Could not add this source.",
    );

    expect(toast.error).toHaveBeenCalledWith("Failed to add source", {
      description: "Selected project cannot write to this vault path.",
    });
  });

  it("falls back when no backend message is available", () => {
    showApiErrorToast("Failed to sync", null, "Could not start sync.");

    expect(toast.error).toHaveBeenCalledWith("Failed to sync", {
      description: "Could not start sync.",
    });
  });
});
