const { existsSync } = require("node:fs");
const { join } = require("node:path");

const GOOGLE_SERVICES_FILE = "./google-services.json";

/** @param {{ config: import('expo/config').ExpoConfig }} context */
module.exports = ({ config }) =>
  existsSync(join(__dirname, GOOGLE_SERVICES_FILE))
    ? { ...config, android: { ...config.android, googleServicesFile: GOOGLE_SERVICES_FILE } }
    : config;
