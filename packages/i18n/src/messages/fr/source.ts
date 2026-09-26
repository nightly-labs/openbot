import { messages as errorAgent } from "./error/agent";
import { messages as errorApp } from "./error/app";
import { messages as errorAttachment } from "./error/attachment";
import { messages as errorAuth } from "./error/auth";
import { messages as errorBackend } from "./error/backend";
import { messages as errorComputerUse } from "./error/computerUse";
import { messages as errorHost } from "./error/host";
import { messages as errorImport } from "./error/import";
import { messages as errorKind } from "./error/kind";
import { messages as errorMarketplace } from "./error/marketplace";
import { messages as errorMcp } from "./error/mcp";
import { messages as errorProvider } from "./error/provider";
import { messages as errorRemote } from "./error/remote";
import { messages as errorSite } from "./error/site";
import { messages as errorSkill } from "./error/skill";
import { messages as errorStorage } from "./error/storage";
import { messages as errorTeam } from "./error/team";
import { messages as errorUpdate } from "./error/update";
import { messages as errorVoice } from "./error/voice";
import { messages as statusAgent } from "./status/agent";
import { messages as statusComputerUse } from "./status/computerUse";
import { messages as statusHost } from "./status/host";
import { messages as statusProvider } from "./status/provider";
import { messages as statusRemote } from "./status/remote";
import { messages as statusUpdate } from "./status/update";

/** Text the main process, a host or the team client sends as English and a screen translates. */
export const source = {
  ...errorKind,
  ...errorApp,
  ...errorTeam,
  ...errorAuth,
  ...errorHost,
  ...errorRemote,
  ...errorAgent,
  ...errorProvider,
  ...errorComputerUse,
  ...errorVoice,
  ...errorBackend,
  ...errorSkill,
  ...errorMarketplace,
  ...errorSite,
  ...errorAttachment,
  ...errorImport,
  ...errorUpdate,
  ...errorMcp,
  ...errorStorage,
  ...statusHost,
  ...statusRemote,
  ...statusAgent,
  ...statusProvider,
  ...statusComputerUse,
  ...statusUpdate,
} as const;
