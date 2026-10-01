/**
 * CodeBlock -- Custom `pre` component override for react-markdown.
 *
 * Features:
 * - Always-visible copy-to-clipboard button (top-right)
 * - Language label extracted from className (top-left)
 * - Line numbers in left gutter (non-selectable)
 * - Horizontal scroll for long pentest commands
 * - App-themed dark styling via CSS classes (CalloutStyles.css)
 */
import {
  type ReactNode,
  type ReactElement,
  type HTMLAttributes,
  isValidElement,
  useState,
  useCallback,
} from "react";
import { Copy, Check } from "lucide-react";

/** Recursively extract plain text from a React element tree. */
type CodeElementProps = {
  className?: string;
  children?: ReactNode;
};

function isCodeElement(node: ReactNode): node is ReactElement<CodeElementProps> {
  return isValidElement<CodeElementProps>(node);
}

function extractTextContent(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (!node) return "";
  if (Array.isArray(node)) return node.map(extractTextContent).join("");
  if (isCodeElement(node)) return extractTextContent(node.props.children);
  return "";
}

/** Extract language identifier from className like "language-python". */
function extractLanguage(className?: string): string {
  if (!className) return "text";
  const match = className.match(/language-(\S+)/);
  return match ? match[1] : "text";
}

/** Copy text to clipboard with fallback for non-secure contexts. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand("copy");
    document.body.removeChild(textarea);
    return success;
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  const color = copied ? "var(--color-accent-green)" : "var(--color-text-muted)";

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? "Copied" : "Copy code"}
      className="code-block-copy"
      style={{ color }}
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
    </button>
  );
}

/**
 * Replaces the default `<pre>` element rendered by react-markdown.
 * Expects a single `<code>` child produced by rehype-highlight.
 */
export function CodeBlock(props: HTMLAttributes<HTMLPreElement>) {
  const { children, ...rest } = props;

  const codeChild = isCodeElement(children) ? children : null;
  const codeClassName = codeChild?.props.className;
  const language = extractLanguage(codeClassName);
  const rawText = extractTextContent(children).replace(/\n$/, "");
  const lineCount = rawText.split("\n").length;

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span className="code-block-lang">{language}</span>
        <CopyButton text={rawText} />
      </div>

      <div className="code-block-body">
        <div
          aria-hidden="true"
          className="code-block-gutter"
          style={{ minWidth: lineCount >= 100 ? "3.5em" : "2.5em" }}
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className="code-block-gutter-line">{i + 1}</div>
          ))}
        </div>

        <pre {...rest}>{children}</pre>
      </div>
    </div>
  );
}
