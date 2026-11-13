import type { SkillConversationEvent } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { type Zippable, zipSync } from "fflate";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { LearnedSkillDraft, SkillLearner } from "../backend/agent/skill-learning";
import { LocalSkillFailure, type LocalSkillLibrary } from "./local-skill-library";
import type { SkillMarketplaceService } from "./skill-marketplace-service";
import { readSkillArchive, SKILL_FRONTMATTER, skillZippable } from "./skill-package";

/**
 * Saves the skills that a memory review learns in the local library, as `create_skill` and
 * `revise_skill` do, and installs the new revision for the agent. Other agents keep their copies.
 * When the install fails, the revision is withdrawn, so the review asks the user instead and the
 * library does not keep a skill that no agent has.
 */
export function localSkillLearner(skills: SkillMarketplaceService): SkillLearner {
  const library = skills.requireLocalLibrary();
  return {
    read: (skillId) =>
      library.get(skillId).pipe(
        Effect.map((detail) => ({
          description: detail.description,
          instructions: detail.instructions,
          revision: detail.version,
        })),
      ),
    save: (agentId, draft) =>
      Effect.gen(function* () {
        const saved =
          draft.action === "create"
            ? yield* library.createFromBundle(yield* newBundle(draft))
            : yield* library.reviseFromBundle(
                draft.skillId,
                draft.expectedRevision,
                yield* revisedBundle(library, draft),
              );
        yield* skills
          .installLocal({ agentId, skillId: saved.id, revision: saved.version })
          .pipe(Effect.tapError(() => library.withdraw(saved.id, saved.version).pipe(Effect.ignore)));
        const event: SkillConversationEvent = {
          action: draft.action === "create" ? "created" : "revised",
          skillId: saved.id,
          revision: saved.version,
          skillName: saved.name,
        };
        return event;
      }),
  };
}

function newBundle(draft: Extract<LearnedSkillDraft, { action: "create" }>) {
  return bundleSync(() => ({
    "SKILL.md": skillMarkdown({ name: draft.name, description: draft.description }, draft.instructions),
  }));
}

/** The current bundle with the new description and instructions. Its other files and keys stay. */
function revisedBundle(library: LocalSkillLibrary, draft: Extract<LearnedSkillDraft, { action: "update" }>) {
  return Effect.gen(function* () {
    const bytes = yield* library.bundle(draft.skillId, draft.expectedRevision);
    return yield* bundleSync(() => {
      const { files, executable } = readSkillArchive(bytes);
      const text = new TextDecoder("utf-8", { fatal: true }).decode(files["SKILL.md"]);
      const metadata = parseYaml(text.match(SKILL_FRONTMATTER)?.[1] ?? "");
      if (!isDynamicRecord(metadata)) throw new Error("The skill has no frontmatter to keep.");
      return skillZippable(
        { ...files, "SKILL.md": skillMarkdown({ ...metadata, description: draft.description }, draft.instructions) },
        executable,
      );
    });
  });
}

function skillMarkdown(metadata: DynamicRecord, instructions: string): Uint8Array {
  // `stringify` quotes a value that YAML would read in another way, such as a colon in the description.
  return new TextEncoder().encode(`---\n${stringifyYaml(metadata)}---\n\n${instructions.trim()}\n`);
}

function bundleSync(files: () => Zippable) {
  return Effect.try({
    try: () => zipSync(files(), { level: 6 }),
    catch: (cause) => new LocalSkillFailure({ cause }),
  });
}
