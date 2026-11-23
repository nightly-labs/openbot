import * as SecureStore from "expo-secure-store";
import { z } from "zod";
import { create } from "zustand";

const key = "openbot.mobile.location-always-allowed.v1";
const VALUE_LIMIT = 2048;

const allowedSchema = z.array(z.string().min(1));

function agentKey(serverId: string, agentId: string): string {
  return `${serverId}\n${agentId}`;
}

function read(): string[] {
  try {
    const parsed = allowedSchema.safeParse(JSON.parse(SecureStore.getItem(key) ?? "[]"));
    return parsed.success ? withinStoreLimit(parsed.data) : [];
  } catch {
    return [];
  }
}

const useLocationAlwaysAllowedStore = create<{ keys: readonly string[] }>(() => ({ keys: read() }));

export function useLocationAlwaysAllowed(serverId: string, agentId: string | undefined): boolean {
  return useLocationAlwaysAllowedStore((state) => (agentId ? state.keys.includes(agentKey(serverId, agentId)) : false));
}

function knownKeys(): string[] {
  return [...useLocationAlwaysAllowedStore.getState().keys];
}

function withinStoreLimit(keys: readonly string[]): string[] {
  const kept = [...keys];
  while (kept.length > 0 && JSON.stringify(kept).length > VALUE_LIMIT) kept.shift();
  return kept;
}

function save(keys: readonly string[]): void {
  const kept = withinStoreLimit(keys);
  if (JSON.stringify(kept) === JSON.stringify(useLocationAlwaysAllowedStore.getState().keys)) return;
  useLocationAlwaysAllowedStore.setState({ keys: kept });
  SecureStore.setItemAsync(key, JSON.stringify(kept)).catch(() => undefined);
}

function serverOf(entry: string): string {
  return entry.slice(0, entry.indexOf("\n"));
}

export function setLocationAlwaysAllowed(serverId: string, agentId: string, allowed: boolean): void {
  const entry = agentKey(serverId, agentId);
  const rest = knownKeys().filter((candidate) => candidate !== entry);
  save(allowed ? [...rest, entry] : rest);
}

export function forgetLocationAlwaysAllowed(serverIds: ReadonlySet<string>): void {
  save(knownKeys().filter((entry) => !serverIds.has(serverOf(entry))));
}

export function retainLocationAlwaysAllowed(serverIds: readonly string[]): void {
  save(knownKeys().filter((entry) => serverIds.includes(serverOf(entry))));
}

export function deleteLocationAlwaysAllowed(): void {
  useLocationAlwaysAllowedStore.setState({ keys: [] });
  SecureStore.deleteItemAsync(key).catch(() => undefined);
}
