import { type CrmSettings, DEFAULT_CRM_SETTINGS } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { CrmError, type CrmSettingsStore } from "../backend/crm/crm-handle";
import { PreferenceStore } from "./preference-file";

export function createCrmPreferenceStore(path: string): PreferenceStore<CrmSettings> {
  return new PreferenceStore({
    path,
    defaultValue: DEFAULT_CRM_SETTINGS,
    decode: (parsed) =>
      isDynamicRecord(parsed) && parsed.version === 1 && isBoolean(parsed.enabled) ? { enabled: parsed.enabled } : null,
  });
}

export function crmSettingsStore(store: PreferenceStore<CrmSettings>): CrmSettingsStore {
  return {
    get: () => store.get(),
    set: (settings) =>
      store
        .set({ enabled: settings.enabled })
        .pipe(
          Effect.mapError(() => new CrmError({ code: "refused", message: sourceText("error.crm.settingsSaveFailed") })),
        ),
  };
}
