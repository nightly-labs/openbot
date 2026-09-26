import type { PartialTranslation } from "../../message";
import type { AppMobileMessages } from "../en/mobile";
import { messages as mobileAgent } from "./mobile/agent";
import { messages as mobileApp } from "./mobile/app";
import { messages as mobileAuth } from "./mobile/auth";
import { messages as mobileChannel } from "./mobile/channel";
import { messages as mobileChat } from "./mobile/chat";
import { messages as mobileLink } from "./mobile/link";
import { messages as mobileSearch } from "./mobile/search";
import { messages as mobileServer } from "./mobile/server";
import { messages as mobileSettings } from "./mobile/settings";
import { messages as mobileShared } from "./mobile/shared";
import { messages as mobileWorkspace } from "./mobile/workspace";
import { shared } from "./shared";
import { source } from "./source";

/** The mobile catalog: shared keys, source text, and the mobile areas only. */
export const frMobile = {
  ...shared,
  ...source,
  ...mobileApp,
  ...mobileChat,
  ...mobileSearch,
  ...mobileAgent,
  ...mobileChannel,
  ...mobileAuth,
  ...mobileServer,
  ...mobileSettings,
  ...mobileLink,
  ...mobileWorkspace,
  ...mobileShared,
} as const satisfies PartialTranslation<AppMobileMessages>;
