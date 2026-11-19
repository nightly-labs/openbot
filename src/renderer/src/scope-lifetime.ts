import { getOwner, isDisposed } from "solid-js";

export function createScopeGuard(): () => boolean {
  const owner = getOwner();
  return () => !(owner && isDisposed(owner));
}
