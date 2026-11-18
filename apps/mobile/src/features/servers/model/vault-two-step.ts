// Two-step (TOTP) codes of the Vault of a joined server (`vault-v3`). The host keeps each saved key and
// sends only the current codes. The phone makes a code only from a key that the user typed or scanned
// in the setup steps and has not saved yet, so the user can check the key on the site before saving it.
// Hermes has no `crypto.subtle`, so the phone makes the HMAC from the native digests of `expo-crypto`.

import type { VaultTwoStepCodes } from "@openbot/contracts/ipc";
import {
  parseTwoStepKey,
  type TwoStepAlgorithm,
  type TwoStepKey,
  twoStepCodeFromMac,
  twoStepMessage,
  twoStepRemainingMs,
} from "@openbot/contracts/two-step-code";
import { useQuery } from "@tanstack/react-query";
import { CryptoDigestAlgorithm, digest } from "expo-crypto";
import { useIsFocused } from "expo-router/react-navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

/** A code and the time when the next one starts. */
export interface LiveTwoStepCode {
  code: string;
  /** Seconds that one code is valid. */
  period: number;
  /** Milliseconds since 1970. */
  expiresAt: number;
}

/** The time after a failed load before the codes load again, as on desktop. */
const RETRY_MS = 30_000;
/**
 * The time after a code runs out that it still shows while the next codes load. Sites also accept the
 * previous code, so a copy in this time still works.
 */
const RELOAD_GRACE_MS = 5_000;

/** The time, once a second while `active`. */
export function useSecondClock(active = true): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    let timer: ReturnType<typeof setTimeout>;
    // Each tick lands just after a whole second, so a code changes with the clock of the site.
    const schedule = () => {
      timer = setTimeout(
        () => {
          setNow(Date.now());
          schedule();
        },
        1000 - (Date.now() % 1000) + 10,
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, [active]);
  return now;
}

/** Whole seconds until the next code. */
export function secondsLeft(code: LiveTwoStepCode, now: number): number {
  return Math.max(0, Math.ceil((code.expiresAt - now) / 1000));
}

/**
 * The current codes of the host logins with a key, while the page shows. They load again when the
 * first one runs out, after a saved change (`useServerVault` marks them stale), and 30 seconds after
 * a failed load.
 */
export function useServerVaultCodes(serverId: string, hasKeys: boolean) {
  const { canManageVaultTwoStep } = useMobileWorkspace();
  const { loadVaultCodes } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const focused = useIsFocused();
  const query = useQuery({
    queryKey: queryKeys.serverVaultCodes(queryScope, serverId),
    enabled: focused && hasKeys && canManageVaultTwoStep(serverId),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    queryFn: async (): Promise<ReadonlyMap<string, LiveTwoStepCode>> => {
      const answer: VaultTwoStepCodes = await loadVaultCodes(serverId);
      const received = Date.now();
      return new Map(
        answer.codes.map((code) => [
          code.id,
          { code: code.code, period: code.period, expiresAt: received + code.remainingMs },
        ]),
      );
    },
    refetchInterval: (current) => {
      if (current.state.status === "error") return RETRY_MS;
      const codes = current.state.data;
      if (!codes || codes.size === 0) return false;
      const first = Math.min(...[...codes.values()].map((code) => code.expiresAt));
      return Math.max(250, first - Date.now() + 50);
    },
  });
  // A code that ran out stays for a short time while the next codes load, so it does not flash at each
  // change. A load can wait minutes for an offline host, and a failed load keeps the last codes, so the
  // limit is a time and not the load state.
  const code = (id: string) => {
    const live = query.data?.get(id);
    return live && live.expiresAt + RELOAD_GRACE_MS > Date.now() ? live : undefined;
  };
  return { code, query };
}

const DIGESTS = {
  "SHA-1": { algorithm: CryptoDigestAlgorithm.SHA1, block: 64 },
  "SHA-256": { algorithm: CryptoDigestAlgorithm.SHA256, block: 64 },
  "SHA-512": { algorithm: CryptoDigestAlgorithm.SHA512, block: 128 },
} as const satisfies Record<TwoStepAlgorithm, { algorithm: CryptoDigestAlgorithm; block: number }>;

type Bytes = Uint8Array<ArrayBuffer>;

/** HMAC (RFC 2104) from the native digest. */
async function hmac(name: TwoStepAlgorithm, key: Bytes, message: Bytes): Promise<Bytes> {
  const { algorithm, block } = DIGESTS[name];
  const hash = async (data: Bytes): Promise<Bytes> => new Uint8Array(await digest(algorithm, data));
  const padded = new Uint8Array(block);
  padded.set(key.length > block ? await hash(key) : key);
  const inner = new Uint8Array(block + message.length);
  for (let index = 0; index < block; index++) inner[index] = (padded[index] ?? 0) ^ 0x36;
  inner.set(message, block);
  const innerHash = await hash(inner);
  const outer = new Uint8Array(block + innerHash.length);
  for (let index = 0; index < block; index++) outer[index] = (padded[index] ?? 0) ^ 0x5c;
  outer.set(innerHash, block);
  return hash(outer);
}

/** The code of `key` at `at` (milliseconds since 1970). */
async function draftCode(key: TwoStepKey, at: number): Promise<string> {
  return twoStepCodeFromMac(await hmac(key.algorithm, key.secret, twoStepMessage(key.period, at)), key.digits);
}

/** The live code of a key that the user typed and has not saved. Undefined for no key or an invalid one. */
export function useDraftTwoStepCode(keyText: string) {
  const key = useMemo(() => (keyText.trim() ? parseTwoStepKey(keyText) : null), [keyText]);
  const now = useSecondClock(key !== null);
  const [shown, setShown] = useState<{ key: TwoStepKey; code: LiveTwoStepCode } | null>(null);
  const run = useRef(0);
  const ofKey = shown && shown.key === key ? shown.code : undefined;
  // The tick when no current code is ready, or 0. The effect runs again at each such tick, so a failed
  // digest tries again.
  const staleAt = !ofKey || ofKey.expiresAt <= now ? now : 0;
  useEffect(() => {
    if (!key || staleAt === 0) return;
    const ticket = ++run.current;
    const at = Date.now();
    draftCode(key, at).then(
      (code) => {
        if (ticket !== run.current) return;
        setShown({ key, code: { code, period: key.period, expiresAt: at + twoStepRemainingMs(key.period, at) } });
      },
      // A failed digest keeps the last code until the next try. The key is still saved as typed; the
      // host checks it.
      () => undefined,
    );
  }, [key, staleAt]);
  // The last code stays until the next one is ready, so the digits do not flash a placeholder.
  return { code: key ? ofKey : undefined, now, valid: key !== null };
}

/**
 * The setup in progress: the key text that the key step, the scanner and the check step share. It
 * stays in memory only. The login page takes the finished key and clears it.
 */
interface TwoStepSetupStore {
  /** The login form that started the setup. */
  formId: string | null;
  site: string;
  keyText: string;
  finished: { formId: string; keyText: string } | null;
  start: (formId: string, site: string) => void;
  setKeyText: (keyText: string) => void;
  finish: () => void;
  take: (formId: string) => string | null;
  /** Ends a setup that the user left without Done, so the key does not stay in memory. */
  cancel: (formId: string) => void;
  clear: (formId: string) => void;
}

export const useTwoStepSetup = create<TwoStepSetupStore>()((set, get) => ({
  formId: null,
  site: "",
  keyText: "",
  finished: null,
  start: (formId, site) => set({ formId, site, keyText: "", finished: null }),
  setKeyText: (keyText) => set({ keyText }),
  finish: () => {
    const { formId, keyText } = get();
    if (formId) set({ formId: null, keyText: "", finished: { formId, keyText: keyText.trim() } });
  },
  take: (formId) => {
    const { finished } = get();
    if (finished?.formId !== formId) return null;
    set({ finished: null });
    return finished.keyText;
  },
  cancel: (formId) => {
    if (get().formId === formId) set({ formId: null, site: "", keyText: "" });
  },
  clear: (formId) => {
    const state = get();
    if (state.formId === formId || state.finished?.formId === formId)
      set({ formId: null, site: "", keyText: "", finished: null });
  },
}));
