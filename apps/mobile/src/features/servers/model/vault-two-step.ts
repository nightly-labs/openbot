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
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

export interface LiveTwoStepCode {
  code: string;
  period: number;
  expiresAt: number;
}

const RETRY_MS = 30_000;
const RELOAD_GRACE_MS = 5_000;

export function useSecondClock(active = true): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    let timer: ReturnType<typeof setTimeout>;
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

export function secondsLeft(code: LiveTwoStepCode, now: number): number {
  return Math.max(0, Math.ceil((code.expiresAt - now) / 1000));
}

export function useServerVaultCodes(serverId: string, hasKeys: boolean) {
  const canManageTwoStep = useMobileWorkspaceSelector((workspace) => workspace.canManageVaultTwoStep(serverId));
  const { loadVaultCodes } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const focused = useIsFocused();
  const query = useQuery({
    queryKey: queryKeys.serverVaultCodes(queryScope, serverId),
    enabled: focused && hasKeys && canManageTwoStep,
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

async function draftCode(key: TwoStepKey, at: number): Promise<string> {
  return twoStepCodeFromMac(await hmac(key.algorithm, key.secret, twoStepMessage(key.period, at)), key.digits);
}

export function useDraftTwoStepCode(keyText: string) {
  const key = useMemo(() => (keyText.trim() ? parseTwoStepKey(keyText) : null), [keyText]);
  const now = useSecondClock(key !== null);
  const [shown, setShown] = useState<{ key: TwoStepKey; code: LiveTwoStepCode } | null>(null);
  const run = useRef(0);
  const ofKey = shown && shown.key === key ? shown.code : undefined;
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
      () => undefined,
    );
  }, [key, staleAt]);
  return { code: key ? ofKey : undefined, now, valid: key !== null };
}

interface TwoStepSetupStore {
  formId: string | null;
  site: string;
  keyText: string;
  finished: { formId: string; keyText: string } | null;
  start: (formId: string, site: string) => void;
  setKeyText: (keyText: string) => void;
  finish: () => void;
  take: (formId: string) => string | null;
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
