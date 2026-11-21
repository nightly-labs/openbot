import { ANALYTICS_GENERATIONS } from "@openbot/telemetry";
import type { TrackHandlerPayload } from "@openpanel/react-native";
import { Platform } from "react-native";
import { nativeApplication, nativeApplicationVersion, nativeBuildVersion } from "@/shared/lib/native-application";
import { MobileAnalytics } from "./analytics-core";
import { MOBILE_EVENTS, type MobileEventName, sanitizeMobileEvent } from "./events";
import { mobileReportQueue } from "./failure-reports";

const metadata = {
  surface: "mobile",
  environment: "production",
  event_schema_version: ANALYTICS_GENERATIONS.mobile,
  platform: Platform.OS,
  app_version: nativeApplicationVersion() ?? "unknown",
  build_number: nativeBuildVersion() ?? "unknown",
};

function filterMobilePayload(event: TrackHandlerPayload): boolean {
  if (!mobileAnalytics.isSending()) return false;
  const installId = mobileAnalytics.anonymousProfileId();
  if (event.type === "identify") {
    if (installId) return false;
    event.payload = { profileId: event.payload.profileId, email: event.payload.email, properties: metadata };
    return true;
  }
  if (event.type !== "track") return false;
  const name = Object.keys(MOBILE_EVENTS).find(
    (candidate): candidate is MobileEventName => candidate === event.payload.name,
  );
  if (!name) return false;
  if (installId) event.payload.profileId = installId;
  const timestamp = event.payload.properties?.__timestamp;
  event.payload.properties = {
    ...sanitizeMobileEvent(name, event.payload.properties ?? {}),
    ...metadata,
    ...(typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp))
      ? { __timestamp: new Date(timestamp).toISOString() }
      : {}),
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
    (Platform.OS !== "ios" && Platform.OS !== "android") ||
    !nativeApplication
  )
    return null;
  const { OpenPanel }: typeof import("@openpanel/react-native") = require("@openpanel/react-native");
  const client = new OpenPanel({
    apiUrl: "https://analytics.openbot.run/api",
    clientId,
    clientSecret,
    filter: filterMobilePayload,
    debug: false,
  });
  let transport = new AbortController();
  const send = client.api.fetch.bind(client.api);
  client.api.fetch = (path, data, options) => send(path, data, { ...options, signal: transport.signal });
  return {
    track: (name, properties, timestamp, profileId) =>
      client.track(name, {
        ...properties,
        ...(timestamp ? { __timestamp: timestamp } : {}),
        ...(profileId ? { profileId } : {}),
      }),
    identify: (user) => client.identify(user),
    clear: () => {
      transport.abort();
      transport = new AbortController();
      client.queue.length = 0;
      client.clear();
    },
  };
}, mobileReportQueue);
