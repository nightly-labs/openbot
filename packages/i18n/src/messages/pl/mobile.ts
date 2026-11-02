import type { PartialTranslation } from "../../message";
import type { AppMobileMessages } from "../en/mobile";
import { messages as mobileAgent } from "./mobile/agent";
import { messages as mobileApp } from "./mobile/app";
import { messages as mobileAppLock } from "./mobile/appLock";
import { messages as mobileAuth } from "./mobile/auth";
import { messages as mobileBrowser } from "./mobile/browser";
import { messages as mobileChannel } from "./mobile/channel";
import { messages as mobileChat } from "./mobile/chat";
import { messages as mobileLink } from "./mobile/link";
import { messages as mobileLiveActivity } from "./mobile/liveActivity";
import { messages as mobileMarketplace } from "./mobile/marketplace";
import { messages as mobileOnboarding } from "./mobile/onboarding";
import { messages as mobileSearch } from "./mobile/search";
import { messages as mobileServer } from "./mobile/server";
import { messages as mobileSettings } from "./mobile/settings";
import { messages as mobileShare } from "./mobile/share";
import { messages as mobileShared } from "./mobile/shared";
import { messages as mobileWorkflow } from "./mobile/workflow";
import { messages as mobileWorkspace } from "./mobile/workspace";
import { shared } from "./shared";
import { source } from "./source";

/** The mobile catalog: shared keys, source text, and the mobile areas only. */
export const plMobile = {
  ...shared,
  ...source,
  ...mobileApp,
  ...mobileAppLock,
  ...mobileChat,
  ...mobileBrowser,
  ...mobileSearch,
  ...mobileAgent,
  ...mobileChannel,
  ...mobileAuth,
  ...mobileServer,
  ...mobileSettings,
  ...mobileLink,
  ...mobileLiveActivity,
  ...mobileMarketplace,
  ...mobileOnboarding,
  ...mobileWorkspace,
  ...mobileWorkflow,
  ...mobileShare,
  ...mobileShared,
} as const satisfies PartialTranslation<AppMobileMessages>;
