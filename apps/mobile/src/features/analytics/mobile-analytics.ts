import { OpenPanel, type TrackHandlerPayload } from "@openpanel/react-native";
import * as Application from "expo-application";
import { Platform } from "react-native";
import { MobileAnalytics } from "./analytics-core";
import { MOBILE_EVENTS, type MobileEventName, sanitizeMobileEvent } from "./events";

const metadata = {
  surface: "mobile",
  environment: "production",
  event_schema_version: 1,
  platform: Platform.OS,
  app_version: Application.nativeApplicationVersion ?? "unknown",
  build_number: Application.nativeBuildVersion ?? "unknown",
};

// RN's SDK adds Android install referrers and paths itself. Replace its final
// properties so those additions cannot expose campaign URLs or route identifiers.
export function filterMobilePayload(event: TrackHandlerPayload): boolean {
  if (!mobileAnalytics.isEnabled()) return false;
  if (event.type === "identify") {
    event.payload = { profileId: event.payload.profileId, email: event.payload.email, properties: metadata };
    return true;
  }
  if (event.type !== "track") return false;
  const name = Object.keys(MOBILE_EVENTS).find(
    (candidate): candidate is MobileEventName => candidate === event.payload.name,
  );
  if (!name) return false;
  event.payload.properties = {
    ...sanitizeMobileEvent(name, event.payload.properties ?? {}),
    ...metadata,
    __referrer: "",
    __path: "",
  };
  return true;
}

export const mobileAnalytics = new MobileAnalytics(() => {
  const clientId = process.env.EXPO_PUBLIC_OPENPANEL_CLIENT_ID;
  const clientSecret = process.env.EXPO_PUBLIC_OPENPANEL_CLIENT_SECRET;
  if (
    __DEV__ ||
    process.env.EXPO_PUBLIC_APP_ENV !== "production" ||
    !clientId ||
    !clientSecret ||
    (Platform.OS !== "ios" && Platform.OS !== "android")
  )
    return null;
  const client = new OpenPanel({
    apiUrl: "https://analytics.openbot.run/api",
    clientId,
    clientSecret,
    filter: filterMobilePayload,
    debug: false,
  });
  // The SDK retries below its payload filter. Keep one signal for each consent
  // period so even retries delayed until after opt-in remain aborted.
  let transport = new AbortController();
  const send = client.api.fetch.bind(client.api);
  client.api.fetch = (path, data, options) => send(path, data, { ...options, signal: transport.signal });
  return {
    track: (name, properties) => client.track(name, properties),
    identify: (user) => client.identify(user),
    clear: () => {
      transport.abort();
      transport = new AbortController();
      client.queue.length = 0;
      client.clear();
    },
  };
});
