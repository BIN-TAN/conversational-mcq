import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import nextBaseConfig from "./tooling/eslint-next/base-config.cjs";
import nextPlugin from "./tooling/eslint-next/dist/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname
});

const eslintConfig = [
  ...compat.config(nextBaseConfig),
  nextPlugin.flatConfig.coreWebVitals,
  ...compat.extends("plugin:@typescript-eslint/recommended"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": 1,
      "@typescript-eslint/no-unused-expressions": 1
    }
  },
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      ".data/**",
      "docs/research/**",
      "outputs/**",
      "tooling/eslint-next/dist/**"
    ]
  }
];

export default eslintConfig;
