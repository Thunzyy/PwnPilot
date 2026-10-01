/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: "#a372f8",
        "background-dark": "#131118",
        "bg-primary": "#0d1117",
        "bg-secondary": "#161b22",
        "bg-tertiary": "#21262d",
        surface: "#1e1b26",
        "surface-highlight": "#2e2839",
        "text-primary": "#f0f6fc",
        "text-secondary": "#c9d1d9",
        "text-muted": "#8b949e",
        "accent-green": "#3fb950",
        "accent-red": "#f85149",
        "accent-yellow": "#d29922",
        "accent-blue": "#58a6ff",
        "accent-purple": "#a371f7",
        border: "#30363d",
        "border-dark": "#30363d",
        "card-dark": "#161b22",
        popover: "#161b22",
        "popover-foreground": "#f0f6fc",
      },
      fontFamily: {
        display: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      borderRadius: {
        DEFAULT: "0.375rem",
        md: "0.375rem",
        lg: "0.5rem",
        xl: "0.75rem",
        full: "9999px",
      },
    },
  },
  plugins: [],
};
