import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      ".next-*/**",
      "node_modules/**",
      "node_modules.nosync/**",
      "out/**",
      "build/**",
      "data/**",
      "next-env.d.ts",
    ],
  },
  {
    settings: {
      react: {
        version: "19.2.5",
      },
    },
  },
  ...nextCoreWebVitals,
  {
    rules: {
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;
