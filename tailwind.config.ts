import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        surface: "#ffffff",
        ink: "#202426",
        muted: "#5F6B68",
        line: "#D7DDD9",
        accent: "#007C41",
        "accent-dark": "#275D38",
        "accent-soft": "#EAF3EE",
        warning: "#8A6B00",
        "ualberta-green-dark": "#275D38",
        "ualberta-green": "#007C41",
        "ualberta-gold": "#FFDB05",
        "ualberta-gold-dark": "#F2CD00",
        "ualberta-green-soft": "#EAF3EE",
        "ualberta-gold-soft": "#FFF8D6",
        "text-main": "#202426",
        "text-muted": "#5F6B68",
        "border-light": "#D7DDD9",
        "panel-gray": "#F5F7F6"
      },
      boxShadow: {
        soft: "0 8px 22px rgb(32 36 38 / 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
