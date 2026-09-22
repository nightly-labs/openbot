import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// The step that picks the reviewer is shell embedded in YAML, so neither TypeScript nor
// Biome sees it and a wrong regex would only surface as a review that quietly ran on the
// wrong model. It also reads two pieces of untrusted text - a pull request description and
// a comment - and turns them into a model name on a command line, which is the part worth
// holding still. So the test runs the real step, lifted from the workflow file rather than
// copied, with the workflow's own defaults and allowlists: a list edited in one place and
// not the other should fail here rather than in a review.

const WORKFLOW = join(import.meta.dirname, "../.github/workflows/norbiai-review.yml");

type Job = {
  env: Record<string, string>;
  steps: { name: string; run?: string }[];
};

const job: Job = parse(readFileSync(WORKFLOW, "utf8")).jobs.review;
const step = job.steps.find((candidate) => candidate.name === "Resolve reviewer model");

const scriptDirectory = mkdtempSync(join(tmpdir(), "norbiai-reviewer-"));
const scriptPath = join(scriptDirectory, "resolve.sh");
writeFileSync(scriptPath, step?.run ?? "");

type Request = { description?: string; comment?: string; fork?: boolean };

/** Runs the workflow step as the runner would, and reads back what it chose. */
function resolve({ description = "", comment = "", fork = false }: Request) {
  const bodyPath = join(scriptDirectory, "description.txt");
  const outputPath = join(scriptDirectory, "output.txt");
  writeFileSync(bodyPath, description);
  writeFileSync(outputPath, "");

  const log = execFileSync("bash", [scriptPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      DEFAULT_MODEL: job.env.DEFAULT_MODEL,
      DEFAULT_EFFORT: job.env.DEFAULT_EFFORT,
      ALLOWED_MODELS: job.env.ALLOWED_MODELS,
      ALLOWED_EFFORTS: job.env.ALLOWED_EFFORTS,
      PR_BODY_FILE: bodyPath,
      SAME_REPO: fork ? "false" : "true",
      COMMENT_BODY: comment,
      GITHUB_OUTPUT: outputPath,
    },
  });

  const chosen = new Map<string, string>();
  for (const line of readFileSync(outputPath, "utf8").split("\n").filter(Boolean)) {
    const separator = line.indexOf("=");
    chosen.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return { model: chosen.get("model"), effort: chosen.get("effort"), log };
}

const defaults = { model: job.env.DEFAULT_MODEL, effort: job.env.DEFAULT_EFFORT };

describe("NorbiAI reviewer selection", () => {
  it("reviews on the defaults when the pull request asks for nothing", () => {
    const { model, effort } = resolve({ description: "Fixes a bug." });

    expect({ model, effort }).toEqual(defaults);
  });

  it("takes both directives from the description, written plainly or hidden in a comment", () => {
    const plain = resolve({ description: "Fixes a bug.\nNorbiAI-Model: gpt-6-astra\nNorbiAI-Effort: high" });
    const hidden = resolve({ description: "<!-- NorbiAI-Model: gpt-6-astra -->\n<!-- NorbiAI-Effort: high -->" });

    expect(plain).toMatchObject({ model: "gpt-6-astra", effort: "high" });
    expect(hidden).toMatchObject({ model: "gpt-6-astra", effort: "high" });
  });

  it("keeps the default for the half the pull request did not ask about", () => {
    const { model, effort } = resolve({ description: "NorbiAI-Effort: high" });

    expect({ model, effort }).toEqual({ model: defaults.model, effort: "high" });
  });

  it("lets the review request comment override the description for that run", () => {
    const { model } = resolve({
      description: "NorbiAI-Model: gpt-6-astra",
      comment: "/norbiai review\nNorbiAI-Model: chatgpt-web/medium",
    });

    expect(model).toBe("chatgpt-web/medium");
  });

  // The description belongs to whoever opened the pull request. On a fork that is someone
  // who cannot merge here, and who has an interest in being read by the weakest model on
  // the list, so only the maintainer's request comment is honoured there.
  it("ignores a fork's description but still reads the maintainer's comment", () => {
    const { model, effort, log } = resolve({
      description: "NorbiAI-Model: chatgpt-web/medium",
      comment: "NorbiAI-Effort: xhigh",
      fork: true,
    });

    expect({ model, effort }).toEqual({ model: defaults.model, effort: "xhigh" });
    expect(log).toContain("::warning title=NorbiAI ignored a fork's reviewer override");
  });

  // Refusing has to mean the default, never an empty model or an unreviewed pull request:
  // a typo should be read at full strength rather than silently at none.
  it.each([
    ["model", "NorbiAI-Model: evil; rm -rf /"],
    ["model", "NorbiAI-Model: gpt-9-nonexistent"],
    ["reasoning effort", "NorbiAI-Effort: minimal"],
  ])("refuses an unlisted %s and reviews on the default", (label, description) => {
    const { model, effort, log } = resolve({ description });

    expect({ model, effort }).toEqual(defaults);
    expect(log).toContain(`::warning title=NorbiAI ignored an unknown ${label}`);
  });

  it("reads the last directive, so an edit appended to the description replaces an earlier one", () => {
    const { model } = resolve({
      description: "NorbiAI-Model: gpt-6-astra\n\nOn reflection:\nNorbiAI-Model: chatgpt-web/medium",
    });

    expect(model).toBe("chatgpt-web/medium");
  });

  it("does not read a directive named in prose", () => {
    const { model } = resolve({ description: "Maybe we should use NorbiAI-Model: gpt-6-astra here?" });

    expect(model).toBe(defaults.model);
  });

  // The effort only reaches gpt-6-astra: a chatgpt-web slug carries its own level, and the
  // list has to stay the one that model accepts or an allowed value buys a refused run.
  it("offers exactly the reasoning levels gpt-6-astra supports", () => {
    expect(job.env.ALLOWED_EFFORTS.split(" ")).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
    expect(job.env.ALLOWED_MODELS.split(" ")).toContain("gpt-6-astra");
    expect(job.env.ALLOWED_MODELS.split(" ")).toContain(job.env.DEFAULT_MODEL);
    expect(job.env.ALLOWED_EFFORTS.split(" ")).toContain(job.env.DEFAULT_EFFORT);
  });
});
