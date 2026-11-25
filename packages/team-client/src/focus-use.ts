import { FOCUS_USE_INTERVAL_MS } from "@openbot/contracts/team-protocol/focus-use-v1";

export function createFocusUsePing(send: (serverId: string) => void, now = Date.now) {
  let target: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const sentAt = new Map<string, number>();

  function schedule() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const serverId = target;
    if (serverId === null) return;
    const last = sentAt.get(serverId);
    const delay = last === undefined ? 0 : Math.max(0, last + FOCUS_USE_INTERVAL_MS - now());
    timer = setTimeout(() => {
      timer = null;
      sentAt.set(serverId, now());
      send(serverId);
      schedule();
    }, delay);
  }

  return {
    setTarget(serverId: string | null) {
      if (serverId === target) return;
      target = serverId;
      schedule();
    },
    dispose() {
      target = null;
      schedule();
    },
  };
}
