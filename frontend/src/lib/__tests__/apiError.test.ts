import { describe, expect, it } from "vitest";

import { getUserFacingErrorMessage } from "@/lib/apiError";

describe("getUserFacingErrorMessage", () => {
  it("prefers structured backend error messages", () => {
    expect(
      getUserFacingErrorMessage(
        {
          response: {
            data: {
              error: {
                code: "REPORT_EVALUATION_FAILED",
                message: "Gemini provider returned an empty response",
              },
            },
          },
        },
        "Evaluation failed",
      ),
    ).toBe("Gemini provider returned an empty response");
  });

  it("uses detail payloads before generic Error messages", () => {
    expect(
      getUserFacingErrorMessage(
        {
          message: "Request failed with status code 500",
          response: {
            data: {
              detail: "HTB VPN API token is missing",
            },
          },
        },
        "VPN status unavailable",
      ),
    ).toBe("HTB VPN API token is missing");
  });

  it("falls back when the error has no useful message", () => {
    expect(getUserFacingErrorMessage(null, "Something failed")).toBe(
      "Something failed",
    );
  });
});
