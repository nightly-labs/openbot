import type { AgentMessage, AgentProfile } from "@openbot/ui/data";
import { createStore } from "solid-js";

type StoredValue = AgentProfile | AgentMessage;
type StoredSetter = (value: StoredValue) => void;

const storeSetters = new WeakMap<object, StoredSetter>();

function isAgentProfile(value: StoredValue): value is AgentProfile {
  return "avatarSeed" in value;
}

function replaceFields<T extends object>(current: T, next: T): void {
  for (const key of Object.keys(current)) {
    if (!Object.hasOwn(next, key)) Reflect.deleteProperty(current, key);
  }
  Object.assign(current, next);
}

export function createStoredProfile(value: AgentProfile): AgentProfile {
  const initial = Object.assign({}, value);
  const [store, setStore] = createStore(initial);
  storeSetters.set(store, (next) => {
    if (isAgentProfile(next)) {
      setStore((current) => {
        replaceFields(current, next);
      });
    }
  });
  return store;
}

export function createStoredMessage(value: AgentMessage): AgentMessage {
  const initial = Object.assign({}, value);
  const [store, setStore] = createStore(initial);
  storeSetters.set(store, (next) => {
    if (!isAgentProfile(next)) {
      setStore((current) => {
        replaceFields(current, next);
      });
    }
  });
  return store;
}

export function updateStored(store: StoredValue, value: StoredValue): void {
  storeSetters.get(store)?.(value);
}
