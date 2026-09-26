import type { PartialTranslation } from "../../message";
import type { AppMessages } from "../en/index";
import { messages as account } from "./account";
import { messages as agent } from "./agent";
import { messages as agentSettings } from "./agentSettings";
import { messages as agentTemplate } from "./agentTemplate";
import { messages as app } from "./app";
import { messages as attachment } from "./attachment";
import { messages as browser } from "./browser";
import { messages as channel } from "./channel";
import { messages as chat } from "./chat";
import { messages as composer } from "./composer";
import { messages as computerUse } from "./computerUse";
import { messages as conversation } from "./conversation";
import { messages as customProvider } from "./customProvider";
import { messages as dialog } from "./dialog";
import { messages as files } from "./files";
import { messages as importAgent } from "./import";
import { messages as island } from "./island";
import { messages as marketplace } from "./marketplace";
import { messages as mcp } from "./mcp";
import { messages as memory } from "./memory";
import { messages as menu } from "./menu";
import { messages as notification } from "./notification";
import { messages as onboarding } from "./onboarding";
import { messages as plugin } from "./plugin";
import { messages as preview } from "./preview";
import { messages as prompt } from "./prompt";
import { messages as provider } from "./provider";
import { messages as queue } from "./queue";
import { messages as remoteDesktop } from "./remoteDesktop";
import { messages as routine } from "./routine";
import { messages as server } from "./server";
import { messages as settings } from "./settings";
import { shared } from "./shared";
import { messages as sharedTable } from "./sharedTable";
import { messages as sidebar } from "./sidebar";
import { messages as skill } from "./skill";
import { source } from "./source";
import { messages as startup } from "./startup";
import { messages as team } from "./team";
import { messages as update } from "./update";
import { messages as usage } from "./usage";
import { messages as webClient } from "./webClient";
import { messages as window } from "./window";

/**
 * Japanese. Written from the English source and not yet reviewed by a native speaker: read it as a
 * first draft that is safe to ship behind an explicit language choice, not as final copy. A key that
 * is missing here renders its English source.
 *
 * Notes for a reviewer. The interface uses です・ます throughout, because the English source speaks
 * to the user directly rather than reporting state. Product names stay in Latin script: OpenBot is
 * the application name, and ZIP and JSON are the file formats a picker shows.
 *
 * This is the desktop catalog: shared keys, source text, and every desktop area.
 */
export const ja = {
  ...shared,
  ...source,
  ...menu,
  ...notification,
  ...dialog,
  ...startup,
  ...window,
  ...settings,
  ...provider,
  ...app,
  ...composer,
  ...attachment,
  ...chat,
  ...queue,
  ...prompt,
  ...conversation,
  ...agentSettings,
  ...routine,
  ...memory,
  ...skill,
  ...sharedTable,
  ...preview,
  ...browser,
  ...marketplace,
  ...plugin,
  ...customProvider,
  ...update,
  ...server,
  ...team,
  ...remoteDesktop,
  ...mcp,
  ...webClient,
  ...account,
  ...onboarding,
  ...usage,
  ...sidebar,
  ...channel,
  ...agent,
  ...agentTemplate,
  ...importAgent,
  ...files,
  ...island,
  ...computerUse,
} as const satisfies PartialTranslation<AppMessages>;
