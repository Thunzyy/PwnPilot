/**
 * XSS Protection Tests (SEC-01)
 *
 * Validates the dual-layer defense (DOMPurify pre-sanitization +
 * rehype-sanitize schema validation) neutralizes all common XSS vectors.
 *
 * Each test renders a MarkdownViewer with an XSS payload and asserts:
 * - No <script> elements in the DOM
 * - No on* event handler attributes on any element
 * - No javascript: protocol in href attributes
 * - No <iframe> elements
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MarkdownViewer } from "../MarkdownViewer";
import { makeDoc } from "./helpers";

/** Assert no dangerous elements or attributes exist in container. */
function assertNoXSS(container: HTMLElement) {
  // No script elements
  expect(container.querySelectorAll("script")).toHaveLength(0);

  // No event handler attributes on any element
  const allElements = container.querySelectorAll("*");
  allElements.forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      expect(attr.name.toLowerCase()).not.toMatch(/^on/);
    });
  });

  // No javascript: protocol in href attributes
  container.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href")?.toLowerCase() ?? "";
    expect(href).not.toMatch(/^javascript:/);
  });

  // No iframes
  expect(container.querySelectorAll("iframe")).toHaveLength(0);
}

const xssPayloads = [
  {
    name: "script tag",
    payload: "<script>alert(1)</script>",
  },
  {
    name: "img onerror",
    payload: '<img onerror=alert(1) src=x>',
  },
  {
    name: "javascript: link",
    payload: "[click](javascript:alert(1))",
  },
  {
    name: "svg onload",
    payload: "<svg onload=alert(1)>",
  },
  {
    name: "iframe injection",
    payload: '<iframe src="javascript:alert(1)"></iframe>',
  },
  {
    name: "event handler in tag",
    payload: '<div onmouseover="alert(1)">hover me</div>',
  },
  {
    name: "data URI",
    payload: '<a href="data:text/html,<script>alert(1)</script>">click</a>',
  },
  {
    name: "encoded script",
    payload: "<scr\x69pt>alert(1)</scr\x69pt>",
  },
  {
    name: "nested script in markdown link",
    payload: '[xss](<script>alert(1)</script>)',
  },
  {
    name: "style attribute injection",
    payload: '<p style="background:url(javascript:alert(1))">styled</p>',
  },
];

describe("XSS Protection (SEC-01)", () => {
  it.each(xssPayloads)("neutralizes: $name", ({ payload }) => {
    const { container } = render(
      <MarkdownViewer doc={makeDoc(payload)} />,
    );
    assertNoXSS(container);
  });

  it("preserves safe markdown content alongside XSS payloads", () => {
    const mixed =
      "Safe **bold** text\n\n<script>alert(1)</script>\n\nMore safe text";
    const { container } = render(
      <MarkdownViewer doc={makeDoc(mixed)} />,
    );

    // Safe content rendered
    expect(container.textContent).toContain("Safe");
    expect(container.textContent).toContain("bold");
    expect(container.textContent).toContain("More safe text");

    // XSS neutralized
    assertNoXSS(container);
  });

  it("strips nested XSS in markdown image alt text", () => {
    const payload = '![<img onerror=alert(1) src=x>](http://example.com/img.png)';
    const { container } = render(
      <MarkdownViewer doc={makeDoc(payload)} />,
    );
    assertNoXSS(container);
  });

  it("strips XSS in frontmatter values rendered by FrontmatterHeader", () => {
    const doc = makeDoc("safe content", {
      title: '<script>alert(1)</script>Malicious Title',
      tags: ["safe", '<img onerror=alert(1) src=x>'],
    });
    const { container } = render(<MarkdownViewer doc={doc} />);

    // Frontmatter values are rendered as text, not HTML
    expect(container.querySelectorAll("script")).toHaveLength(0);
    const allElements = container.querySelectorAll("*");
    allElements.forEach((el) => {
      Array.from(el.attributes).forEach((attr) => {
        expect(attr.name.toLowerCase()).not.toMatch(/^on/);
      });
    });
  });
});
