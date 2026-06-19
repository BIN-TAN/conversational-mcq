import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        surface: "#f7f8f5",
        ink: "#1e2523",
        muted: "#65716d",
        line: "#d9ded8",
        accent: "#1f7a66",
        "accent-soft": "#dff1eb",
        warning: "#a46612"
      },
      boxShadow: {
        soft: "0 12px 30px rgb(30 37 35 / 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
