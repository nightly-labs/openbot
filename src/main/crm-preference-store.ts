import { type CrmSettings, DEFAULT_CRM_SETTINGS } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { CrmError, type CrmSettingsStore } from "../backend/crm/crm-handle";
import { PreferenceStore } from "./preference-file";

/**
 * The CRM switch of this server, in Server Settings > Experimental. A file without the switch reads
 * as the default, off. The CRM reads it on each agent call and each sync tick, so a change applies at once.
 */
export function createCrmPreferenceStore(path: string): PreferenceStore<CrmSettings> {
  return new PreferenceStore({
    path,
    defaultValue: DEFAULT_CRM_SETTINGS,
    decode: (parsed) =>
      isDynamicRecord(parsed) && parsed.version === 1 && isBoolean(parsed.enabled) ? { enabled: parsed.enabled } : null,
  });
}

/** The store as the CRM service uses it. A failed write is a refusal that the person reads. */
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
