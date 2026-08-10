/** @type {import('@types/eslint').Linter.BaseConfig} */
module.exports = {
  root: true,
  extends: [
    "@remix-run/eslint-config",
    "@remix-run/eslint-config/node",
    // NOT jest-testing-library -- this project uses Vitest (better fit for a Vite-based Remix
    // app), and that preset's rules hard-require a real `jest` package for version detection.
    "prettier",
  ],
  globals: {
    shopify: "readonly"
  },
};
