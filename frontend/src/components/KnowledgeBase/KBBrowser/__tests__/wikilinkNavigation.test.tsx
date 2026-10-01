/**
 * Wikilink Navigation Integration Tests (NAV-02 wikilinks)
 *
 * Validates end-to-end wikilink rendering through MarkdownViewer:
 * - [[target]] renders as clickable WikiLink button
 * - [[target|display]] renders display text
 * - wikilink click fires onWikilinkClick callback
 * - regular links open in new tab (target="_blank")
 * - broken wikilinks render with muted styling
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { MarkdownViewer } from "../../MarkdownViewer/MarkdownViewer";
import { makeDoc } from "../../MarkdownViewer/__tests__/helpers";

describe("Wikilink Navigation", () => {
  it("renders [[target]] as clickable wikilink button", () => {
    const doc = makeDoc("See [[nmap]] for details.");
    const { container } = render(<MarkdownViewer doc={doc} />);

    // WikiLink renders as a <button> not <a>
    const buttons = container.querySelectorAll("button");
    const wikilinkBtn = Array.from(buttons).find(
      (btn) => btn.textContent === "nmap",
    );
    expect(wikilinkBtn).toBeTruthy();
    expect(wikilinkBtn?.tagName).toBe("BUTTON");
  });

  it("renders [[target|display]] with display text", () => {
    const doc = makeDoc("Check [[nmap|Network Mapper]] tool.");
    const { container } = render(<MarkdownViewer doc={doc} />);

    // Display text should be "Network Mapper", not "nmap"
    const buttons = container.querySelectorAll("button");
    const wikilinkBtn = Array.from(buttons).find(
      (btn) => btn.textContent === "Network Mapper",
    );
    expect(wikilinkBtn).toBeTruthy();
  });

  it("fires onWikilinkClick when clicking a wikilink", () => {
    const onWikilinkClick = vi.fn();
    const doc = makeDoc("See [[masscan]] for scanning.");

    const { container } = render(
      <MarkdownViewer doc={doc} onWikilinkClick={onWikilinkClick} />,
    );

    const buttons = container.querySelectorAll("button");
    const wikilinkBtn = Array.from(buttons).find(
      (btn) => btn.textContent === "masscan",
    );
    expect(wikilinkBtn).toBeTruthy();

    fireEvent.click(wikilinkBtn!);
    expect(onWikilinkClick).toHaveBeenCalledWith("masscan");
  });

  it("renders regular links with target=_blank", () => {
    const doc = makeDoc("[Example](https://example.com)");
    const { container } = render(<MarkdownViewer doc={doc} />);

    const link = container.querySelector("a");
    expect(link).toBeTruthy();
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
    expect(link?.textContent).toBe("Example");
  });

  it("renders broken wikilink with muted style", () => {
    // Provide a resolveLink that returns null (broken link)
    const resolveLink = () => null;
    const doc = makeDoc("See [[nonexistent]] page.");

    const { container } = render(
      <MarkdownViewer doc={doc} resolveLink={resolveLink} />,
    );

    // Broken wikilinks should render with aria-disabled
    const buttons = container.querySelectorAll("button");
    const brokenBtn = Array.from(buttons).find(
      (btn) => btn.textContent === "nonexistent",
    );
    expect(brokenBtn).toBeTruthy();
    expect(brokenBtn?.getAttribute("aria-disabled")).toBe("true");
    // Title should indicate broken link
    expect(brokenBtn?.getAttribute("title")).toContain("Broken link");
  });

  it("renders multiple wikilinks in same paragraph", () => {
    const doc = makeDoc("Use [[nmap]] and [[masscan]] for recon.");
    const { container } = render(<MarkdownViewer doc={doc} />);

    const buttons = container.querySelectorAll("button");
    const texts = Array.from(buttons).map((btn) => btn.textContent);
    expect(texts).toContain("nmap");
    expect(texts).toContain("masscan");
  });

  it("does not fire onWikilinkClick for broken wikilinks", () => {
    const onWikilinkClick = vi.fn();
    const resolveLink = () => null;
    const doc = makeDoc("See [[broken]] link.");

    const { container } = render(
      <MarkdownViewer
        doc={doc}
        onWikilinkClick={onWikilinkClick}
        resolveLink={resolveLink}
      />,
    );

    const buttons = container.querySelectorAll("button");
    const brokenBtn = Array.from(buttons).find(
      (btn) => btn.textContent === "broken",
    );
    expect(brokenBtn).toBeTruthy();

    fireEvent.click(brokenBtn!);
    // onWikilinkClick should NOT be called for broken links
    expect(onWikilinkClick).not.toHaveBeenCalled();
  });
});
