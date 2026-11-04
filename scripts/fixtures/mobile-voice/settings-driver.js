import assert from "node:assert/strict";
import {
  loadVoiceSettings,
  saveVoiceSettings,
  useVoiceSettings,
} from "../../../apps/mobile/src/features/voice/model/voice-settings";
import { entries } from "./settings-native";

const key = "openbot.mobile.voice-settings.v1";
entries.set(key, JSON.stringify({ engine: "elevenlabs", recognition: "parakeet", supertonicVoice: "M2" }));
await loadVoiceSettings();
assert.deepEqual(useVoiceSettings.getState().liveVoiceAccounts, {}, "An upgrade opted in an existing user.");
await saveVoiceSettings({ liveVoiceAccounts: { "account-a": true } });
useVoiceSettings.setState({ ready: false, liveVoiceAccounts: {} });
await loadVoiceSettings();
assert.equal(useVoiceSettings.getState().liveVoiceAccounts["account-a"], true, "Consent was not saved on this phone.");
assert.equal(useVoiceSettings.getState().liveVoiceAccounts["account-b"], undefined, "Consent crossed accounts.");
assert.equal(useVoiceSettings.getState().recognition, "parakeet", "Consent changed the local recognizer.");
await saveVoiceSettings({ supertonicVoice: "F2" });
assert.equal(JSON.parse(entries.get(key)).liveVoiceAccounts["account-a"], true, "A local voice change lost consent.");
entries.set(key, JSON.stringify({ liveVoiceAccounts: { "account-a": "true", "account-b": true } }));
useVoiceSettings.setState({ ready: false });
await loadVoiceSettings();
assert.equal(
  useVoiceSettings.getState().liveVoiceAccounts["account-a"],
  undefined,
  "Damaged storage opted in an account.",
);
assert.equal(useVoiceSettings.getState().liveVoiceAccounts["account-b"], true);
process.stdout.write(
  `${JSON.stringify({ passed: true, upgradeStaysLocal: true, persistedAccountIsolation: true, localSettingsPreserved: true, malformedConsentDenied: true })}\n`,
);
