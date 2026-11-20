import { join, posix } from "node:path";
import { registerPublicValues } from "@openbot/logging";
import { Effect } from "effect";
import type { LocalSkillTools } from "../backend/agent/skill-tools";
import { ToolOperationFailed, toToolOperationFailed } from "../backend/agent/tool-operation";
import { MANAGED_SKILL_FOLDERS } from "./managed-skill-service";
import type { SkillMarketplaceService } from "./skill-marketplace-service";

export function localSkillTools(skills: SkillMarketplaceService): LocalSkillTools {
  const library = skills.requireLocalLibrary();
  return {
    list: () => library.listWithUnreadable().pipe(toToolOperationFailed),
    get: (input) =>
      Effect.gen(function* () {
        const detail = yield* library.get(input.skillId, input.revision).pipe(toToolOperationFailed);
        return { ...detail, archivePath: join(library.root, detail.id, String(detail.version), "bundle.zip") };
      }),
    revise: (input) =>
      Effect.gen(function* () {
        const installed = yield* skills.installedRevision(input.agentId, input.skillId).pipe(toToolOperationFailed);
        const skill = yield* library
          .revise(input.agentId, input.skillId, input.expectedRevision, input.sourcePath)
          .pipe(toToolOperationFailed);
        if (installed === null) return skill;
        yield* skills.installLocal({ agentId: input.agentId, skillId: skill.id, revision: skill.version }).pipe(
          Effect.mapError(
            (failure) =>
              new ToolOperationFailed({
                cause: new Error(
                  `Skill ${skill.id} was saved as revision ${skill.version}, but your installed copy was not replaced${failure.cause instanceof Error ? `: ${failure.cause.message}` : "."} Install revision ${skill.version} with install_local_skill. Do not revise it again.`,
                ),
              }),
          ),
        );
        return skill;
      }),
    install: (input) => skills.installLocal(input).pipe(toToolOperationFailed),
    listInstalled: (agentId) =>
      skills.listInstalled(agentId).pipe(
        Effect.tap((installed) => Effect.sync(() => registerPublicValues(installed.map((skill) => skill.skillId)))),
        toToolOperationFailed,
      ),
    setEnabled: (input) => skills.setEnabled(input).pipe(toToolOperationFailed),
    uninstall: (input) => skills.uninstall(input).pipe(toToolOperationFailed),
    create: (input) =>
      Effect.gen(function* () {
        const skill = yield* library.create(input.agentId, input.sourcePath).pipe(toToolOperationFailed);
        const source = posix.normalize(input.sourcePath);
        if (MANAGED_SKILL_FOLDERS.some((folder) => source === `${folder}/${skill.slug}`)) return skill;
        yield* skills.installLocal({ agentId: input.agentId, skillId: skill.id, revision: skill.version }).pipe(
          Effect.mapError(
            (failure) =>
              new ToolOperationFailed({
                cause: new Error(
                  `Skill ${skill.id} was saved as revision ${skill.version}, but installation failed${failure.cause instanceof Error ? `: ${failure.cause.message}` : "."} Read it and retry install_local_skill; do not create it again.`,
                ),
              }),
          ),
        );
        return skill;
      }),
  };
}
