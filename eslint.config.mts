import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "main.js",
      "*.mjs",
      "*.json"
    ],
  },
  ...(obsidianmd as any).configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
      globals: {
        // Browser globals used in Obsidian plugins
        window: "readonly",
        document: "readonly",
        console: "readonly",
        requestAnimationFrame: "readonly",
        fetch: "readonly",
      },
    },

    // You can add your own configuration to override or add rules
    rules: {
      // Allow fetch for streaming (requestUrl doesn't support streaming)
      "no-restricted-globals": ["error", {
        "name": "fetch",
        "message": "Use requestUrl instead of fetch, except for streaming responses"
      }],
      // Allow console.error, warn, debug
      "no-console": ["error", { allow: ["warn", "error", "debug"] }],
      // Disable sentence case rule
      "obsidianmd/ui/sentence-case": "off",
    },
  },
]);
