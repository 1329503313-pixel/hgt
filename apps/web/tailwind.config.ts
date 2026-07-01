import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        page: "#F5F7FA",
        card: "#FFFFFF",
        primary: "#2563EB",
        accent: "#14B8A6",
        warning: "#F97316",
        danger: "#DC2626",
        ink: "#111827",
        body: "#374151",
        muted: "#6B7280",
        weak: "#9CA3AF",
        line: "#E5E7EB"
      },
      boxShadow: {
        soft: "0 8px 24px rgba(17, 24, 39, 0.06)"
      }
    }
  },
  plugins: []
} satisfies Config;
