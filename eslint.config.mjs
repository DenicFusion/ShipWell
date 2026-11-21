import { defineConfig } from "eslint/config";
import next from "eslint-config-next";
import firebaseRulesPlugin from "@firebase/eslint-plugin-security-rules";

export default defineConfig([
  {
    extends: [...next],
    rules: {
      "@next/next/no-img-element": "off",
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  {
    ignores: ["dist/**/*", ".next/**/*"],
  },
  firebaseRulesPlugin.configs["flat/recommended"],
]);
