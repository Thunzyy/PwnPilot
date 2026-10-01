import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AuthScreen } from "../components/Auth/AuthScreen";

describe("AuthScreen", () => {
  it("renders login form", () => {
    render(<AuthScreen />);
    expect(
      screen.getByRole("heading", { name: /Sign in/i })
    ).toBeInTheDocument();
  });
});
