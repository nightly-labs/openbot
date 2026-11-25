import type {
  MediaApprovalCreditsSetting,
  MediaApprovalCreditsUpdate,
  OpenBotDesktopApi,
} from "@openbot/contracts/ipc";
import { createStore } from "solid-js";

export type HostMediaApprovalCreditsCalls = Pick<
  OpenBotDesktopApi["hostAdmin"],
  "getMediaApprovalCredits" | "setMediaApprovalCredits"
>;

export interface CreditAsksCalls {
  readMuted: (serverId: string) => Promise<{ muted: boolean }>;
  setMuted: (muted: boolean, serverId: string) => Promise<void>;
}

const [settings, setSettings] = createStore<Record<string, MediaApprovalCreditsSetting>>({});
const [askMuted, setAskMuted] = createStore<Record<string, boolean>>({});

function keepMuted(serverId: string, muted: boolean): void {
  setAskMuted((draft) => {
    draft[serverId] = muted;
  });
}

function keep(serverId: string, next: MediaApprovalCreditsSetting): MediaApprovalCreditsSetting {
  setSettings((draft) => {
    draft[serverId] = next;
  });
  return next;
}

export function mediaApprovalCredits(serverId: string): MediaApprovalCreditsSetting | undefined {
  return settings[serverId];
}

export function adoptMediaApprovalCredits(serverId: string, update: MediaApprovalCreditsUpdate): void {
  const current = settings[serverId];
  if (current) keep(serverId, { ...current, ...update });
}

export function forgetMediaApprovalCredits(serverId: string): void {
  setSettings((draft) => {
    delete draft[serverId];
  });
  setAskMuted((draft) => {
    delete draft[serverId];
  });
}

export function creditAsksMuted(serverId: string): boolean | undefined {
  return askMuted[serverId];
}

export function adoptCreditAsksMuted(serverId: string, muted: boolean): void {
  keepMuted(serverId, muted);
  adoptMediaApprovalCredits(serverId, { askWhenBlocked: !muted });
}

export async function loadCreditAsksMuted(serverId: string, calls: CreditAsksCalls): Promise<void> {
  keepMuted(serverId, (await calls.readMuted(serverId)).muted);
}

export async function saveCreditAsksMuted(serverId: string, muted: boolean, calls: CreditAsksCalls): Promise<void> {
  const before = askMuted[serverId];
  keepMuted(serverId, muted);
  try {
    await calls.setMuted(muted, serverId);
  } catch (error) {
    if (before !== undefined) keepMuted(serverId, before);
    throw error;
  }
}

export async function loadMediaApprovalCredits(
  serverId: string,
  calls: HostMediaApprovalCreditsCalls,
): Promise<MediaApprovalCreditsSetting> {
  return keep(serverId, await calls.getMediaApprovalCredits(serverId));
}

export async function saveMediaApprovalCredits(
  serverId: string,
  update: MediaApprovalCreditsUpdate,
  calls: HostMediaApprovalCreditsCalls,
): Promise<MediaApprovalCreditsSetting> {
  const current = settings[serverId];
  const before = current ? { ...current } : undefined;
  if (before) keep(serverId, { ...before, ...update });
  try {
    return keep(serverId, await calls.setMediaApprovalCredits(update, serverId));
  } catch (error) {
    if (before) keep(serverId, before);
    throw error;
  }
}
