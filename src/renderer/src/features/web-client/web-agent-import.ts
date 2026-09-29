import { type AgentSummary, GROK_BOT_EXPORT_URL, resolveRemoteAgentImportResult } from "@openbot/contracts/ipc";
import { AGENT_IMPORT_UPLOAD_BYTES } from "@openbot/contracts/team-protocol/agent-import-v1";
import {
  applyAgentImport,
  discardAgentImport,
  stageAgentImport,
  type TeamApiRequest,
} from "@openbot/team-client/team-api-requests";
import { currentText } from "@openbot/ui/text";
import type { AgentImportCalls } from "../servers/ServerImportPanel";
import { openWebLink } from "./web-attachments";
import { chooseFiles } from "./web-channels-runtime";

/** The file's bytes as Base64, read by the browser rather than byte by byte. */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("The file could not be read.")));
    reader.readAsDataURL(file);
  });
}

/**
 * Server settings > Import in the browser client: the export goes to the connected host with
 * `agent-import-v1`. The export skill ships with the web client, and saving it downloads it.
 */
export function createWebAgentImportCalls(options: {
  request: (serverId: string) => TeamApiRequest;
  listAgents: () => Promise<AgentSummary[]>;
  saveFile: (file: { name: string; base64: string }) => void;
}): AgentImportCalls {
  return {
    async choose(serverId) {
      // The host is checked before the chooser opens, and nothing is awaited before it.
      const request = options.request(serverId);
      const [file] = await chooseFiles({ multiple: false, accept: ".zip,application/zip" });
      if (!file) return null;
      if (file.size === 0) throw new Error(currentText().t("error.import.chooseZip"));
      if (file.size > AGENT_IMPORT_UPLOAD_BYTES) throw new Error(currentText().t("error.import.remoteZipTooLarge"));
      return stageAgentImport(request, {
        name: file.name,
        mimeType: "application/zip",
        base64: await readBase64(file),
      });
    },
    async apply(input, serverId) {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const result = await applyAgentImport(options.request(serverId), input, timezone);
      return resolveRemoteAgentImportResult(result, await options.listAgents());
    },
    discard: (token, serverId) => discardAgentImport(options.request(serverId), token),
    async readSkill() {
      const skill = await import("../../../../../resources/agent-import/grok-bot/SKILL.md?raw");
      return skill.default;
    },
    async saveSkill() {
      const text = await this.readSkill();
      const bytes = new TextEncoder().encode(text);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      options.saveFile({ name: "SKILL.md", base64: btoa(binary) });
      return { saved: true };
    },
    openExportAgent() {
      void openWebLink(GROK_BOT_EXPORT_URL);
    },
  };
}
