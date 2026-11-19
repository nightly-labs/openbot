import { version } from "../../../../package.json";
import channelScreenshot from "../content/guides/media/openbot-101/a-channel.webp";
import { OPENBOT_SITE_URL, openBotSoftwareApplication } from "./site-metadata";

export const OPENBOT_SOFTWARE_APPLICATION = openBotSoftwareApplication({
  version,
  screenshot: new URL(channelScreenshot, OPENBOT_SITE_URL).toString(),
});
