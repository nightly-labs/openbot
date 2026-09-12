module.exports = {
  locales: ["en", "pl"],
  output: "src/renderer/src/features/i18n/locales/$LOCALE.json",
  input: ["src/renderer/src/**/*.{ts,tsx}"],
  sort: true,
  createOldCatalogs: false,
};
