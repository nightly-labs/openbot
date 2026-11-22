import { type NativeModule, requireOptionalNativeModule } from "expo";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import {
  BACKGROUND_REFRESH_MINUTES,
  type BackgroundRefreshNative,
  type BackgroundRefreshRun,
} from "./background-refresh-native.types";

type RefreshStatus = "available" | "denied" | "restricted" | "unknown";

declare class BackgroundRefreshModule extends NativeModule<{
  onRefresh: (event: { id: string }) => void;
  onExpire: (event: { id: string }) => void;
}> {
  enable(minutes: number): Promise<RefreshStatus>;
  disable(): Promise<void>;
  finish(id: string, success: boolean): Promise<void>;
}

const native = requireOptionalNativeModule<BackgroundRefreshModule>("OpenBotBackgroundRefresh");

function enable(module: BackgroundRefreshModule, run: BackgroundRefreshRun): () => void {
  const runs = new Map<string, AbortController>();
  const refresh = module.addListener("onRefresh", ({ id }) => {
    const controller = new AbortController();
    runs.set(id, controller);
    void run(controller.signal)
      .catch(() => false)
      .then((success) => {
        runs.delete(id);
        return module.finish(id, success);
      })
      .catch(() => undefined);
  });
  const expire = module.addListener("onExpire", ({ id }) => runs.get(id)?.abort());
  void module.enable(BACKGROUND_REFRESH_MINUTES).then(
    (status) => supportLog.add(status === "available" ? "info" : "warn", "app", `Background refresh: ${status}`),
    (error) => supportLog.add("warn", "app", `Background refresh not scheduled: ${supportLogValue(error)}`),
  );
  return () => {
    refresh.remove();
    expire.remove();
    for (const controller of runs.values()) controller.abort();
    void module.disable().catch(() => undefined);
  };
}

export const backgroundRefreshNative: BackgroundRefreshNative | null = native
  ? { install: () => undefined, enable: (run) => enable(native, run) }
  : null;
