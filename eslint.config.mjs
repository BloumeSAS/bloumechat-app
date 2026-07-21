// @ts-check
import eslint from "@eslint/js";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "eslint.config.mjs",
      "app/**",
      "dist/**",
      "renderer/.next/**",
      "renderer/out/**",
      "node_modules/**",
      "coverage/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintPluginPrettierRecommended,
  {
    rules: {
      "prettier/prettier": ["error", { endOfLine: "auto" }],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  // ── main process (Node, CommonJS-ish, no DOM/React) ──
  {
    files: ["main/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  // ── renderer (Next.js/React pages + browser libs) ──
  {
    files: ["renderer/**/*.{ts,tsx}"],
    plugins: { react: reactPlugin, "react-hooks": reactHooksPlugin },
    languageOptions: {
      globals: { ...globals.browser },
    },
    settings: { react: { version: "18.3" } },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      "react/react-in-jsx-scope": "off", // Next.js auto-imports the JSX runtime
      "react/prop-types": "off", // TypeScript already types props
      "react/no-unknown-property": ["error", { ignore: ["jsx", "global"] }], // <style jsx global> is Next.js's built-in styled-jsx, not a DOM prop
    },
  },
  // ── build-tool configs (plain CommonJS Node scripts, not part of the app's tsconfig) ──
  {
    files: ["renderer/next.config.js", "renderer/postcss.config.js", "renderer/tailwind.config.js"],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: "commonjs",
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Test files legitimately use jest.fn()/loosely-typed mocks — same rationale
  // as server-nest/eslint.config.mjs, kept consistent across the org.
  {
    files: ["**/*.spec.ts"],
    languageOptions: { globals: { ...globals.jest } },
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
