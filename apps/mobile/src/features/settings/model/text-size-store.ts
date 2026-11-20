import { type AppInterfaceSize, DEFAULT_APP_INTERFACE_SIZE } from "@openbot/contracts/ipc";
import { create } from "zustand";

export const useTextSize = create<{ percent: AppInterfaceSize; ready: boolean }>(() => ({
  percent: DEFAULT_APP_INTERFACE_SIZE,
  ready: false,
}));

export function useTextScale(): number {
  return useTextSize((state) => state.percent) / 100;
}
