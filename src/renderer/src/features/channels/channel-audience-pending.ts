import { type ChannelAudienceInput, parseChannelAudienceInput } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";

const KEY = "openbot:channel-audience-pending";
const LIMIT = 20;
const BYTE_LIMIT = 1024 * 1024;
interface PendingAudience {
  scope: string;
  input: ChannelAudienceInput;
}
function read(): PendingAudience[] {
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return [];
  if (new TextEncoder().encode(raw).byteLength > BYTE_LIMIT)
    throw new Error(sourceText("error.backend.channelAudienceStorageInvalid"));
  const value = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > LIMIT)
    throw new Error(sourceText("error.backend.channelAudienceStorageInvalid"));
  return value.map((entry) => {
    if (!isDynamicRecord(entry) || typeof entry.scope !== "string" || entry.scope.length > 1024)
      throw new Error(sourceText("error.backend.channelAudienceStorageInvalid"));
    return { scope: entry.scope, input: parseChannelAudienceInput(entry.input) };
  });
}
export function pendingChannelAudience(scope: string, channelId: string): ChannelAudienceInput | null {
  return read().find((entry) => entry.scope === scope && entry.input.channelId === channelId)?.input ?? null;
}
export function saveChannelAudience(scope: string, input: ChannelAudienceInput): void {
  if (!scope || scope.length > 1024) throw new Error(sourceText("error.backend.channelAudienceStorageInvalid"));
  const entries = read();
  if (entries.some((entry) => entry.scope === scope && entry.input.channelId === input.channelId))
    throw new Error(sourceText("error.backend.channelAudiencePending"));
  const next = JSON.stringify([...entries, { scope, input: parseChannelAudienceInput(input) }]);
  if (entries.length >= LIMIT || new TextEncoder().encode(next).byteLength > BYTE_LIMIT)
    throw new Error(sourceText("error.backend.channelAudienceStorageFull"));
  // Storage failure rejects before the network call. Unconfirmed inputs are never evicted.
  window.localStorage.setItem(KEY, next);
}
export function clearChannelAudience(scope: string, input: ChannelAudienceInput): void {
  window.localStorage.setItem(
    KEY,
    JSON.stringify(
      read().filter(
        (entry) =>
          entry.scope !== scope ||
          entry.input.channelId !== input.channelId ||
          entry.input.operationId !== input.operationId,
      ),
    ),
  );
}
