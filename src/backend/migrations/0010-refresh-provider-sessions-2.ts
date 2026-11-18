import { refreshProviderSessionsForDynamicTools } from "./0009-refresh-provider-sessions-1";
import type { OpenBotMigration } from "./migration";

export const migration: OpenBotMigration = {
  version: 10,
  name: "refresh-provider-sessions-2",
  up: refreshProviderSessionsForDynamicTools,
};
