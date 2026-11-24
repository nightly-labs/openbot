import {
  DEFAULT_MEDIA_APPROVAL_CREDITS_SETTING,
  type MediaApprovalCreditsSetting,
  type MediaApprovalCreditsUpdate,
  parseMediaApprovalCreditsSetting,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { PreferenceStore } from "./preference-file";

type MediaApprovalCreditsPreferenceStore = PreferenceStore<MediaApprovalCreditsSetting>;

export function createMediaApprovalCreditsPreferenceStore(path: string): MediaApprovalCreditsPreferenceStore {
  return new PreferenceStore({
    path,
    defaultValue: DEFAULT_MEDIA_APPROVAL_CREDITS_SETTING,
    decode: (parsed) =>
      isDynamicRecord(parsed) && parsed.version === 1 ? parseMediaApprovalCreditsSetting(parsed) : null,
  });
}

export type MediaApprovalCreditsControl = ReturnType<typeof mediaApprovalCreditsControl>;

export function mediaApprovalCreditsControl(store: MediaApprovalCreditsPreferenceStore, onChange: () => void) {
  return {
    get: () => store.get(),
    set: Effect.fn("MediaApprovalCredits.set")(function* (update: MediaApprovalCreditsUpdate) {
      const saved = yield* store.set({ ...store.get(), ...update });
      onChange();
      return saved;
    }),
  };
}

interface CreditAsksMuted {
  members: string[];
}

type CreditAsksMutedStore = PreferenceStore<CreditAsksMuted>;

function parseCreditAsksMuted(value: unknown): CreditAsksMuted | null {
  if (!isDynamicRecord(value) || value.version !== 1 || !Array.isArray(value.members)) return null;
  const members = value.members.filter((member): member is string => typeof member === "string");
  return { members: [...new Set(members)] };
}

export function createCreditAsksMutedStore(path: string): CreditAsksMutedStore {
  return new PreferenceStore({ path, defaultValue: { members: [] }, decode: parseCreditAsksMuted });
}

export type CreditAsksControl = ReturnType<typeof creditAsksControl>;

export interface CreditAsksPerson {
  id: string;
  canAdminister: boolean;
}

export function creditAsksControl(settings: MediaApprovalCreditsControl, muted: CreditAsksMutedStore) {
  const setMuted = Effect.fn("CreditAsks.setMuted")(function* (person: CreditAsksPerson | null, mute: boolean) {
    if (!person || person.canAdminister) {
      yield* settings.set({ askWhenBlocked: !mute });
      return;
    }
    const others = muted.get().members.filter((member) => member !== person.id);
    yield* muted.set({ members: mute ? [...others, person.id] : others });
  });
  return {
    mutedFor: (person: CreditAsksPerson | null) =>
      !person || person.canAdminister ? !settings.get().askWhenBlocked : muted.get().members.includes(person.id),
    muted: (personIds: readonly string[]) => {
      const members = new Set(muted.get().members);
      return personIds.length > 0 && personIds.every((personId) => members.has(personId));
    },
    enableAgents: () => settings.set({ agents: true }).pipe(Effect.asVoid),
    mute: (person: CreditAsksPerson | null) => setMuted(person, true),
    setMuted,
  };
}
