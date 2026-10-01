/// <reference types="vitest" />
import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return;
          }

          if (id.includes("@xterm")) {
            return "xterm";
          }

          if (id.includes("@xyflow") || id.includes("@dagrejs/dagre")) {
            return "attack-graph-vendor";
          }

          if (
            id.includes("@codemirror/lang-markdown") ||
            id.includes("@lezer/")
          ) {
            return "codemirror-markdown";
          }

          if (
            id.includes("@codemirror") ||
            id.includes("@uiw/react-codemirror")
          ) {
            return "codemirror";
          }

          if (
            id.includes("highlight.js") ||
            id.includes("rehype-highlight")
          ) {
            return "markdown-highlight";
          }

          if (
            id.includes("react-markdown") ||
            id.includes("remark-") ||
            id.includes("rehype-") ||
            id.includes("dompurify") ||
            id.includes("js-yaml")
          ) {
            return "markdown";
          }

          if (id.includes("@radix-ui")) {
            return "radix";
          }

          if (
            id.includes("lucide-react") ||
            id.includes("react-resizable-panels") ||
            id.includes("sonner")
          ) {
            return "ui-kit";
          }
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/e2e/**",
      "**/test-results/**",
      "**/playwright-report/**",
    ],
    deps: {
      optimizer: {
        web: {
          include: [
            "react-markdown",
            "remark-gfm",
            "remark-frontmatter",
            "rehype-callouts",
            "rehype-highlight",
            "rehype-sanitize",
            "dompurify",
          ],
        },
      },
    },
  },
});
