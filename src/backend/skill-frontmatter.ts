import { SKILL_DESCRIPTION_MAX_LENGTH } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { parse as parseYaml } from "yaml";

/** Why a `SKILL.md` does not follow the Agent Skills specification. Each one is an `error.skill.*` key. */
export type SkillFrontmatterProblem =
  | "frontmatterMissing"
  | "frontmatterInvalid"
  | "descriptionLength"
  | "nameMismatch";

/**
 * Checks the frontmatter of a `SKILL.md` in the folder `slug`: `name` is the folder name and
 * `description` has 1 to 1024 characters. A provider can skip a skill that fails.
 */
export function readSkillFrontmatter(
  text: string,
  slug: string,
): { description: string; problem?: undefined } | { description?: string; problem: SkillFrontmatterProblem } {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text)?.[1];
  if (frontmatter === undefined) return { problem: "frontmatterMissing" };
  let metadata: unknown;
  try {
    metadata = parseYaml(frontmatter);
  } catch {
    return { problem: "frontmatterInvalid" };
  }
  if (!isDynamicRecord(metadata)) return { problem: "frontmatterInvalid" };
  const description = isString(metadata.description) ? metadata.description.trim() : "";
  if (!description || description.length > SKILL_DESCRIPTION_MAX_LENGTH) return { problem: "descriptionLength" };
  if (metadata.name !== slug) return { description, problem: "nameMismatch" };
  return { description };
}
