import { z } from "zod";

const tool = z.object({
  kind: z.literal("tool"),
  namespace: z.enum(["openbot", "openbot_browser"]).default("openbot"),
  name: z.string(),
  args: z.record(z.string(), z.json()),
  save: z.string().optional(),
});
export const scenarioSchema = z.object({
  steps: z
    .array(
      z.discriminatedUnion("kind", [
        tool,
        z.object({ kind: z.literal("mcp"), server: z.string(), value: z.string(), save: z.string() }),
        z.object({ kind: z.literal("write"), name: z.string(), base64: z.string(), append: z.boolean().optional() }),
        z.object({ kind: z.literal("read-upload"), name: z.string(), save: z.string() }),
        z.object({ kind: z.literal("hold"), key: z.string() }),
        z.object({ kind: z.literal("approval"), receipt: z.string().optional() }),
        z.object({ kind: z.literal("question") }),
        z.object({ kind: z.literal("fail"), message: z.string() }),
        z.object({ kind: z.literal("crash") }),
      ]),
    )
    .default([]),
  reply: z.string(),
});
export type Scenario = z.input<typeof scenarioSchema>;

export function prompt(scenario: Scenario): string {
  return `E2E_SCENARIO:${Buffer.from(JSON.stringify(scenario)).toString("base64")}`;
}
