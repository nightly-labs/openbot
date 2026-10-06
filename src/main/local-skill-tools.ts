import { join } from "node:path";
import { Effect } from "effect";
import type { LocalSkillTools } from "../backend/agent/skill-tools";
import { ToolOperationFailed } from "../backend/agent/tool-operation";
import type { SkillMarketplaceService } from "./skill-marketplace-service";

export function localSkillTools(skills: SkillMarketplaceService): LocalSkillTools {
  const library = skills.requireLocalLibrary();
  return {
    list: () => library.list().pipe(Effect.mapError((error) => new ToolOperationFailed({ cause: error.cause }))),
    get: (input) =>
      Effect.gen(function* () {
        const detail = yield* library
          .get(input.skillId, input.revision)
          .pipe(Effect.mapError((error) => new ToolOperationFailed({ cause: error.cause })));
        return { ...detail, archivePath: join(library.root, detail.id, String(detail.version), "bundle.zip") };
      }),
    revise: (input) =>
      library
        .revise(input.agentId, input.skillId, input.expectedRevision, input.sourcePath)
        .pipe(Effect.mapError((error) => new ToolOperationFailed({ cause: error.cause }))),
    install: (input) =>
      skills.installLocal(input).pipe(Effect.mapError((error) => new ToolOperationFailed({ cause: error.cause }))),
    listInstalled: (agentId) =>
      skills.listInstalled(agentId).pipe(Effect.mapError((error) => new ToolOperationFailed({ cause: error.cause }))),
    setEnabled: (input) =>
      skills.setEnabled(input).pipe(Effect.mapError((error) => new ToolOperationFailed({ cause: error.cause }))),
    uninstall: (input) =>
      skills.uninstall(input).pipe(Effect.mapError((error) => new ToolOperationFailed({ cause: error.cause }))),
    create: (input) =>
      Effect.gen(function* () {
        const skill = yield* library
          .create(input.agentId, input.sourcePath)
          .pipe(Effect.mapError((error) => new ToolOperationFailed({ cause: error.cause })));
        yield* skills.installLocal({ agentId: input.agentId, skillId: skill.id, revision: skill.version }).pipe(
          Effect.mapError(
            () =>
              new ToolOperationFailed({
                cause: new Error(
                  `Skill ${skill.id} was saved as revision ${skill.version}, but installation failed. Read it and retry install_local_skill; do not create it again.`,
                ),
              }),
          ),
        );
        return skill;
      }),
  };
}
