import * as SecureStore from "expo-secure-store";
import { z } from "zod";
import { create } from "zustand";

const key = "openbot.mobile.location-always-allowed.v1";
const MAX_AGENTS = 200;

const allowedSchema = z.array(z.string().min(1));

function agentKey(serverId: string, agentId: string): string {
  return `${serverId}\n${agentId}`;
}

function read(): string[] | null {
  try {
    const parsed = allowedSchema.safeParse(JSON.parse(SecureStore.getItem(key) ?? "[]"));
    return parsed.success ? parsed.data.slice(-MAX_AGENTS) : [];
  } catch {
    return null;
  }
}

const useLocationAlwaysAllowedStore = create<{ keys: readonly string[] }>(() => ({ keys: read() ?? [] }));

export function useLocationAlwaysAllowed(serverId: string, agentId: string | undefined): boolean {
  return useLocationAlwaysAllowedStore((state) => (agentId ? state.keys.includes(agentKey(serverId, agentId)) : false));
}

export function setLocationAlwaysAllowed(serverId: string, agentId: string, allowed: boolean): void {
  const entry = agentKey(serverId, agentId);
  const saved = read();
  const known = [...new Set([...(saved ?? []), ...useLocationAlwaysAllowedStore.getState().keys])];
  const rest = known.filter((candidate) => candidate !== entry);
  const keys = allowed ? [...rest, entry].slice(-MAX_AGENTS) : rest;
  useLocationAlwaysAllowedStore.setState({ keys });
  SecureStore.setItemAsync(key, JSON.stringify(keys)).catch(() => undefined);
}
