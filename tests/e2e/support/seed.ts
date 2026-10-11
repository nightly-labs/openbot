import { mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/agent-providers";
import { AgentStore } from "../../../src/backend/agent-store";
import { runCauseEffect } from "../../../src/backend/effect-boundary";
import { writeSetupState } from "../../../src/main/setup-store";
import { modelFor, output, providers, scriptedModel } from "./settings";

const profile = resolve(process.argv[2] ?? "");
const childPath = relative(output, profile);
if (!childPath || childPath.startsWith("..")) throw new Error("Seed requires a private E2E profile.");
const live = process.argv[3] === "live";
await mkdir(profile, { recursive: true, mode: 0o700 });
const store = new AgentStore(profile, join(profile, "workspace-home"));
try {
  await runCauseEffect(store.initialize());
  for (const provider of live ? providers : (["codex"] as const)) {
    const agent = await runCauseEffect(store.getOrCreate(`release-${provider}`));
    await runCauseEffect(
      store.updateAgent({
        agentId: agent.id,
        name: `Release ${provider}`,
        provider,
        model: live ? modelFor(provider) : scriptedModel,
        computerUse: false,
        access: "workspace",
      }),
    );
  }
  await runCauseEffect(
    writeSetupState(join(profile, "openbot-setup-v2.json"), {
      preferredProvider: "codex",
      preferredModel: live ? modelFor("codex") : scriptedModel,
    }),
  );
  const enabled: readonly string[] = live ? providers : ["codex"];
  await writeFile(
    join(profile, "openbot-provider-use-v1.json"),
    JSON.stringify({
      version: 1,
      off: AGENT_PROVIDERS.filter((provider) => provider !== "acp" && !enabled.includes(provider)),
    }),
  );
  await writeFile(join(profile, "openbot-language-preference-v1.json"), JSON.stringify({ version: 1, language: "en" }));
} finally {
  store.database.close();
}
