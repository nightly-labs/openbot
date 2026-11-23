import { create } from "zustand";

export const useLiveActivityHost = create<{ serverId: string | null; startedAt: number | null }>(() => ({
  serverId: null,
  startedAt: null,
}));
