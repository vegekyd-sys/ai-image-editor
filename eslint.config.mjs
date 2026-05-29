import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // This codebase predates the stricter Next 16 / React Compiler lint set.
      // Keep these as non-blocking so lint can gate real syntax/import issues
      // without forcing a broad historical refactor during feature releases.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@next/next/no-html-link-for-pages": "warn",
      "prefer-const": "warn",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/static-components": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".remotion-bundle/**",
    ".agents/**",
    ".vercel/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".claude/**",
    ".codex/**",
    "infra/**",
    "test-output/**",
    ".playwright-mcp/**",
  ]),
]);

export default eslintConfig;
