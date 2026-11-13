import {
  type ClientAgentSummary,
  decodeRemoteAgentImportResult,
  GROK_BOT_EXPORT_URL,
  resolveRemoteAgentImportResult,
} from "@openbot/contracts/ipc";
import { AGENT_IMPORT_UPLOAD_BYTES } from "@openbot/contracts/team-protocol/agent-import-v1";
import {
  decodeHermesImportReadResponse,
  HERMES_IMPORT_ROUTES,
} from "@openbot/contracts/team-protocol/hermes-import-v1";
import {
  applyAgentImport,
  discardAgentImport,
  stageAgentImport,
  stageAgentImportInParts,
  type TeamApiRequest,
} from "@openbot/team-client/team-api-requests";
import { currentText } from "@openbot/ui/text";
import { Effect } from "effect";
import type { AgentImportCalls } from "../servers/ServerImportPanel";
import { openWebLink } from "./web-attachments";
import { chooseFiles } from "./web-channels-runtime";

/** The file's bytes as Base64, read by the browser rather than byte by byte. */
export function readBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    });
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error(currentText().t("server.import.readFailed"))),
    );
    reader.readAsDataURL(file);
  });
}

/**
 * Server settings > Import in the browser client: the export goes to the connected host in parts
 * with `agent-import-v2`, or with `agent-import-v1`. The export skill ships with the web client,
 * and saving it downloads it. The host reads its own Hermes folder with `hermes-import-v1`; the
 * panel offers it only when the host has it.
 */
export function createWebAgentImportCalls(options: {
  request: (serverId: string) => TeamApiRequest;
  /** The host accepts an export of any size with `agent-import-v2`. */
  sendsParts: () => boolean;
  listAgents: () => Promise<ClientAgentSummary[]>;
  saveFile: (file: { name: string; base64: string }) => void;
}): AgentImportCalls {
  return {
    async choose(serverId) {
      // The host is checked before the chooser opens, and nothing is awaited before it.
      const request = options.request(serverId);
      const [file] = await chooseFiles({ multiple: false, accept: ".zip,application/zip" });
      if (!file) return null;
      if (file.size === 0) throw new Error(currentText().t("error.import.chooseZip"));
      if (options.sendsParts())
        return Effect.runPromise(
          stageAgentImportInParts(request, {
            name: file.name,
            size: file.size,
            readPart: (offset, length) => readBase64(file.slice(offset, offset + length)),
          }).pipe(Effect.mapError((error) => error.cause)),
        );
      if (file.size > AGENT_IMPORT_UPLOAD_BYTES)
        throw new Error(currentText().t("error.import.remoteZipTooLargeOldHost"));
      return Effect.runPromise(
        stageAgentImport(request, {
          name: file.name,
          mimeType: "application/zip",
          base64: await readBase64(file),
        }).pipe(Effect.mapError((error) => error.cause)),
      );
    },
    async apply(input, serverId) {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const result = await Effect.runPromise(
        applyAgentImport(options.request(serverId), input, timezone).pipe(Effect.mapError((error) => error.cause)),
      );
      return resolveRemoteAgentImportResult(result, await options.listAgents());
    },
    discard: (token, serverId) =>
      Effect.runPromise(
        discardAgentImport(options.request(serverId), token).pipe(Effect.mapError((error) => error.cause)),
      ),
    async readSkill(source) {
      const skill =
        source === "hermes-agent"
          ? await import("../../../../../resources/agent-import/hermes-agent/SKILL.md?raw")
          : await import("../../../../../resources/agent-import/grok-bot/SKILL.md?raw");
      return skill.default;
    },
    async saveSkill(source) {
      const text = await this.readSkill(source);
      const bytes = new TextEncoder().encode(text);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      options.saveFile({ name: "SKILL.md", base64: btoa(binary) });
      return { saved: true };
    },
    openExportAgent() {
      void openWebLink(GROK_BOT_EXPORT_URL);
    },
    // No folder choice: a browser cannot name a folder of the host.
    hermes: {
      readHermes: (serverId) =>
        options.request(serverId)("POST", HERMES_IMPORT_ROUTES.read, decodeHermesImportReadResponse, {}),
      async applyHermes(input, serverId) {
        const result = await options.request(serverId)(
          "POST",
          HERMES_IMPORT_ROUTES.apply,
          decodeRemoteAgentImportResult,
          {
            token: input.token,
            profiles: input.profiles.map((profile) => ({ key: profile.key, allow: profile.allow })),
          },
        );
        return resolveRemoteAgentImportResult(result, await options.listAgents());
      },
      async discardHermes(token, serverId) {
        await options.request(serverId)("POST", HERMES_IMPORT_ROUTES.discard, () => undefined, { token });
      },
    },
  };
}
