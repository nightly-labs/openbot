import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { AVATAR_HUES, isAvatarSeed } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createAgentToolSchema, updateProfileToolSchema } from "./agent/profile-tools";
import { OPENBOT_DYNAMIC_TOOLS } from "./openbot-tools";

describe("OpenBot tool declarations", () => {
  it("requires site identity and local source details for mutations", () => {
    const publish = OPENBOT_DYNAMIC_TOOLS.tools.find((tool) => tool.name === "publish_site");
    const replace = OPENBOT_DYNAMIC_TOOLS.tools.find((tool) => tool.name === "replace_site");
    const remove = OPENBOT_DYNAMIC_TOOLS.tools.find((tool) => tool.name === "delete_site");
    expect(publish?.inputSchema).toMatchObject({ required: ["sourcePath", "title", "description"] });
    expect(replace?.inputSchema).toMatchObject({ required: ["siteId", "sourcePath", "title", "description"] });
    expect(remove?.inputSchema).toMatchObject({ required: ["siteId"] });
  });

  it.each([
    ["remember", { text: "A short memory" }, true],
    ["remember", { text: "x".repeat(INPUT_LIMITS.agentMemoryText + 1) }, false],
    ["attach_files_to_response", { paths: [] }, false],
    ["attach_files_to_response", { paths: ["/tmp/report.pdf"] }, true],
    [
      "attach_files_to_response",
      { paths: Array.from({ length: INPUT_LIMITS.attachments + 1 }, () => "/tmp/report.pdf") },
      false,
    ],
    ["assign_agent_section", { agentId: "agent-1", sectionId: null }, true],
    ["assign_agent_section", { agentId: "agent-1" }, false],
    ["update_profile", { agentId: "agent-1", avatarSeed: "agent:1", avatarHue: null }, true],
    ["update_profile", { agentId: "agent-1", avatarSeed: "INVALID" }, false],
    ["update_profile", { agentId: "agent-1", avatarSeed: "x".repeat(129) }, false],
    ["update_profile", { agentId: "agent-1", avatarHue: 123 }, false],
    ["update_profile", { agentId: "agent-1", avatarPath: "/tmp/avatar.png" }, true],
    ["update_profile", { agentId: "agent-1", avatarPath: "" }, false],
    ["update_profile", { agentId: "agent-1", avatarPath: "x".repeat(INPUT_LIMITS.path + 1) }, false],
    ["update_profile", { agentId: "x".repeat(INPUT_LIMITS.identifier + 1) }, false],
    ["update_profile", { agentId: "agent-1", name: "" }, false],
    ["update_profile", { agentId: "agent-1", unexpected: true }, false],
    ["ask_user", { questions: [{ question: "Where?", options: [{ label: "Here" }] }] }, true],
    ["ask_user", { questions: [] }, false],
    ["ask_user", { questions: [{ question: "Where?", options: [{ label: "Here", unexpected: true }] }] }, false],
  ])("advertises input constraints for %s: %j", (name, input, accepted) => {
    const definition = OPENBOT_DYNAMIC_TOOLS.tools.find((tool) => tool.name === name);
    if (!definition) throw new Error(`Missing tool: ${name}`);
    expect(z.fromJSONSchema(definition.inputSchema).safeParse(input).success).toBe(accepted);
  });

  it("keeps profile avatar validation aligned with the shared identity contract", () => {
    for (const avatarSeed of ["agent:1", "", "INVALID", "../agent", "x".repeat(128), "x".repeat(129), "agent\n"]) {
      const input = { name: "Agent", description: "", initialMessage: "Start", avatarSeed };
      expect(createAgentToolSchema.safeParse(input).success).toBe(isAvatarSeed(avatarSeed));
      expect(updateProfileToolSchema.safeParse({ agentId: "agent-1", avatarSeed }).success).toBe(
        isAvatarSeed(avatarSeed),
      );
    }
    for (const avatarHue of [...AVATAR_HUES, null]) {
      expect(updateProfileToolSchema.safeParse({ agentId: "agent-1", avatarHue }).success).toBe(true);
    }
  });

  it.each([
    [{ kind: "hourly", minute: 59 }, true],
    [{ kind: "daily", time: "23:59" }, true],
    [{ kind: "weekdays", time: "09:00" }, true],
    [{ kind: "weekly", weekday: 6, time: "09:00" }, true],
    [{ kind: "monthly", day: 31, time: "09:00" }, true],
    [{ kind: "interval", amount: 2, unit: "days", anchorAt: "2026-09-07T09:00:00Z" }, true],
    [
      {
        kind: "advanced",
        months: [1, 12],
        days: { kind: "days-of-week", days: [0, 6] },
        time: { kind: "every", amount: 2, unit: "hours" },
      },
      true,
    ],
    [{ kind: "custom", expression: "0 9 * * *" }, true],
    [{ kind: "hourly", minute: 60 }, false],
    [{ kind: "daily", time: "24:00" }, false],
    [{ kind: "weekly", weekday: 7, time: "09:00" }, false],
    [{ kind: "advanced", months: [13], days: { kind: "every-day" }, time: { kind: "at-time", time: "09:00" } }, false],
    [{ kind: "custom", expression: "" }, false],
  ])("advertises routine schedule constraints: %j", (schedule, accepted) => {
    for (const name of ["create_routine", "update_routine"]) {
      const definition = OPENBOT_DYNAMIC_TOOLS.tools.find((tool) => tool.name === name);
      if (!definition) throw new Error(`Missing tool: ${name}`);
      const input =
        name === "create_routine"
          ? { name: "Routine", instruction: "Run this", schedule }
          : { routineId: "routine-1", schedule };
      expect(z.fromJSONSchema(definition.inputSchema).safeParse(input).success).toBe(accepted);
    }
  });
});
