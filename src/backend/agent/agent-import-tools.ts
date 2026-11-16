import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { isAgentImportKey } from "@openbot/contracts/ipc";
import { z } from "zod";

const AGENT_IMPORT_KEY_MAX = 64;

export const previewAgentImportToolSchema = z
  .object({
    zipPath: z
      .string()
      .trim()
      .min(1)
      .max(INPUT_LIMITS.path)
      .describe("Absolute path to an OpenBot agent export .zip on this computer."),
  })
  .strict();

export const applyAgentImportToolSchema = z
  .object({
    token: z.string().trim().min(1).max(INPUT_LIMITS.identifier).describe("Token from preview_agent_import."),
    keys: z
      .array(z.string().trim().min(1).max(AGENT_IMPORT_KEY_MAX))
      .min(1)
      .max(INPUT_LIMITS.agents)
      .refine((keys) => keys.every(isAgentImportKey), "Each key must match the export.")
      .refine((keys) => new Set(keys).size === keys.length, "Pass each agent key once.")
      .describe("Agent keys from preview_agent_import to import."),
    channelKeys: z
      .array(z.string().trim().min(1).max(AGENT_IMPORT_KEY_MAX))
      .max(INPUT_LIMITS.agents)
      .refine((keys) => keys.every(isAgentImportKey), "Each channel key must match the export.")
      .refine((keys) => new Set(keys).size === keys.length, "Pass each channel key once.")
      .optional()
      .describe("Optional group chat keys from the preview to import."),
  })
  .strict();

export const AGENT_IMPORT_TOOL_NAMES: ReadonlySet<string> = new Set(["preview_agent_import", "apply_agent_import"]);
