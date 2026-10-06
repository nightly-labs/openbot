// The app's structured data, with the two facts that `site-metadata.ts` can not
// import: the newest release, from the changelog, and a picture of the app.

import channelScreenshot from "../content/guides/media/openbot-101/a-channel.webp";
import { LATEST_DESKTOP_RELEASE } from "./changelog-releases";
import { OPENBOT_SITE_URL, openBotSoftwareApplication } from "./site-metadata";

export const OPENBOT_SOFTWARE_APPLICATION = openBotSoftwareApplication({
  release: LATEST_DESKTOP_RELEASE,
  screenshot: new URL(channelScreenshot, OPENBOT_SITE_URL).toString(),
});
