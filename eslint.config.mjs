import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".superpowers/**",
  ]),
  {
    // Money, units and dates go through lib/regional.ts so they follow Settings → Regional.
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    ignores: ["lib/regional.ts", "**/*.test.ts", "lib/llm/model-test/**", "components/ui/**", "app/generated/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "CallExpression[callee.property.name=/^toLocale(Date|Time)String$/]", message: "Use fmt.date/fmt.time from lib/regional.ts." },
        { selector: "CallExpression[callee.property.name='toLocaleString'][callee.object.type='NewExpression'][callee.object.callee.name='Date']", message: "Use fmt.dateTime from lib/regional.ts." },
        { selector: "Literal[value='USD']", message: "Use the household currency (getFormat/useFormat)." },
      ],
    },
  },
]);

export default eslintConfig;
