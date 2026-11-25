import type { BrowserLocation, BrowserPermissionAnswer } from "@openbot/contracts/ipc";
import type { BrowserPermissionRequestState } from "@openbot/contracts/team-protocol/browser-permissions-v1";
import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import { readCurrentLocation } from "@/features/chat/model/location-request";
import { useBrowserPermissionRequest } from "@/features/workspace/components/use-live-workspace";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { useText } from "@/shared/lib/text";

export function browserLocationSite(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

async function deviceLocation(): Promise<BrowserLocation | null> {
  const reading = await readCurrentLocation(true);
  if (reading.status !== "found") return null;
  const { latitude, longitude, accuracyMeters } = reading.location;
  return { latitude, longitude, accuracyMeters };
}

export async function answerBrowserLocation(
  send: (answer: BrowserPermissionAnswer) => Promise<void>,
  request: BrowserPermissionRequestState,
  allow: boolean,
  always = false,
): Promise<"answered" | "unavailable"> {
  const location = allow ? await deviceLocation() : null;
  await send({
    tabId: request.tabId,
    requestId: request.id,
    allow: location !== null,
    ...(location ? { location, ...(always ? { always: true } : {}) } : {}),
  });
  return allow && !location ? "unavailable" : "answered";
}

export function useBrowserLocationRequest({
  serverId,
  tabId,
  enabled,
  notify,
}: {
  serverId: string;
  tabId: string | null;
  enabled: boolean;
  notify: (message: string) => void;
}): void {
  const { t } = useText();
  const { answerBrowserPermission } = useMobileWorkspace();
  const request = useBrowserPermissionRequest(serverId, enabled ? tabId : null);
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!request || shown.current === request.id) return;
    shown.current = request.id;
    const run = (allow: boolean, always = false) =>
      void answerBrowserLocation((answer) => answerBrowserPermission(serverId, answer), request, allow, always)
        .then((result) => {
          if (result === "unavailable") notify(t("mobile.browser.location.unavailable"));
        })
        .catch(() => notify(t("mobile.browser.location.answerFailed")));
    Alert.alert(
      t("mobile.browser.location.title", { site: browserLocationSite(request.origin) }),
      t("mobile.browser.location.description"),
      [
        { text: t("mobile.browser.location.block"), style: "cancel", onPress: () => run(false) },
        { text: t("mobile.browser.location.allowAlways"), onPress: () => run(true, true) },
        { text: t("mobile.browser.location.allow"), onPress: () => run(true) },
      ],
      { cancelable: false },
    );
  }, [request, serverId, answerBrowserPermission, notify, t]);
}
