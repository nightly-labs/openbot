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

type Request = { description?: string; comment?: string; fork?: boolean; changedFiles?: string[] };

/** Runs the workflow step as the runner would, and reads back what it chose. */
function resolve({ description = "", comment = "", fork = false, changedFiles = ["src/main/index.ts"] }: Request) {
  const bodyPath = join(scriptDirectory, "description.txt");
  const changedFilesPath = join(scriptDirectory, "changed-files.txt");
  writeFileSync(changedFilesPath, changedFiles.map((file) => `${file}\n`).join(""));
  const outputPath = join(scriptDirectory, "output.txt");
  writeFileSync(bodyPath, description);
  writeFileSync(outputPath, "");

  const log = execFileSync("bash", [scriptPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      DEFAULT_MODEL: job.env.DEFAULT_MODEL,
      LOW_RISK_MODEL: job.env.LOW_RISK_MODEL,
      DEFAULT_EFFORT: job.env.DEFAULT_EFFORT,
      ALLOWED_MODELS: job.env.ALLOWED_MODELS,
      ALLOWED_EFFORTS: job.env.ALLOWED_EFFORTS,
      CAPPED_MODEL: job.env.CAPPED_MODEL,
      CAPPED_MODEL_EFFORT: job.env.CAPPED_MODEL_EFFORT,
      EFFORT_MODELS: job.env.EFFORT_MODELS,
      CLAUDE_MODELS: job.env.CLAUDE_MODELS,
      CLAUDE_DEFAULT_EFFORT: job.env.CLAUDE_DEFAULT_EFFORT,
      PR_BODY_FILE: bodyPath,
      CHANGED_FILES_FILE: changedFilesPath,
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
  return {
    model: chosen.get("model"),
    cli: chosen.get("cli"),
    effort: chosen.get("effort"),
    reviewer: chosen.get("reviewer"),
    log,
  };
}

const defaults = { model: job.env.DEFAULT_MODEL, effort: job.env.DEFAULT_EFFORT };

describe("NorbiAI reviewer selection", () => {
  it("reviews on the defaults when the pull request asks for nothing", () => {
    const { model, effort } = resolve({ description: "Fixes a bug." });

    expect({ model, effort }).toEqual(defaults);
  });

  it("takes both directives from the description, written plainly or hidden in a comment", () => {
    const plain = resolve({ description: "Fixes a bug.\nNorbiAI-Model: chatgpt-web/pro\nNorbiAI-Effort: high" });
    const hidden = resolve({ description: "<!-- NorbiAI-Model: chatgpt-web/pro -->\n<!-- NorbiAI-Effort: high -->" });

    expect(plain).toMatchObject({ model: "chatgpt-web/pro", effort: "high" });
    expect(hidden).toMatchObject({ model: "chatgpt-web/pro", effort: "high" });
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

  it("defaults to the low-risk model only when every changed file is prose, a story, a test or a message table", () => {
    const lowRisk = resolve({
      changedFiles: ["docs/ARCHITECTURE.md", "src/renderer/src/App.test.tsx", "packages/i18n/src/messages/fr.ts"],
    });
    const mixed = resolve({ changedFiles: ["docs/ARCHITECTURE.md", "src/renderer/src/App.tsx"] });
    const instructions = resolve({ changedFiles: ["README.md", "src/renderer/AGENTS.md"] });

    expect(lowRisk.model).toBe(job.env.LOW_RISK_MODEL);
    expect(mixed.model).toBe(defaults.model);
    expect(instructions.model).toBe(defaults.model);
  });

  it("lets a directive override the low-risk default", () => {
    const { model } = resolve({ description: "NorbiAI-Model: chatgpt-web/pro", changedFiles: ["README.md"] });

    expect(model).toBe("chatgpt-web/pro");
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
    ["reasoning effort", "NorbiAI-Effort: ultra"],
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

  // Found on the pull request that added this feature: its description documented the
  // directive in a fenced example, the example sat below the real one, and `tail -1` handed
  // the review to the documentation. A quoted line is not a request.
  it("does not read a directive quoted in a fenced example", () => {
    const { model } = resolve({
      description: ["<!-- NorbiAI-Model: chatgpt-web/medium -->", "", "```", "NorbiAI-Model: gpt-6-astra", "```"].join(
        "\n",
      ),
    });

    expect(model).toBe("chatgpt-web/medium");
  });

  it("reads a directive that follows a fenced example, so the fence does not swallow the rest", () => {
    const { model } = resolve({
      description: ["```", "NorbiAI-Model: gpt-6-astra", "```", "", "NorbiAI-Model: chatgpt-web/medium"].join("\n"),
    });

    expect(model).toBe("chatgpt-web/medium");
  });

  // A ceiling, not a default: gpt-6-astra never runs above `low`, so neither channel may
  // raise it and the test says so for both. `it.each` over the two sources rather than one
  // case, because a cap applied to the description alone would leave the comment - the more
  // convenient channel - able to lift it.
  it.each([
    ["the description", { description: "NorbiAI-Model: gpt-6-astra\nNorbiAI-Effort: xhigh" }],
    ["the request comment", { comment: "/norbiai review\nNorbiAI-Model: gpt-6-astra\nNorbiAI-Effort: xhigh" }],
  ])("caps gpt-6-astra at low however %s asks", (_source, request) => {
    const { model, effort, log } = resolve(request);

    expect({ model, effort }).toEqual({ model: "gpt-6-astra", effort: "low" });
    expect(log).toContain("::warning title=NorbiAI capped the reasoning effort");
  });

  it("leaves a model that is not capped free to use the whole range", () => {
    const { model, effort, log } = resolve({ description: "NorbiAI-Model: chatgpt-web/medium\nNorbiAI-Effort: xhigh" });

    expect({ model, effort }).toEqual({ model: "chatgpt-web/medium", effort: "xhigh" });
    expect(log).not.toContain("capped the reasoning effort");
  });

  // Membership is the only validation, so it has to see the whole value. Both of these
  // answered a request nobody made: the first read a prefix as a clean slug, the second
  // refused a directive that is valid but written without a space after `<!--`.
  it("refuses a value the author did not finish cleanly, rather than reading its prefix", () => {
    const { model, log } = resolve({ description: "NorbiAI-Model: chatgpt-web/medium; typo" });

    expect(model).toBe(defaults.model);
    expect(log).toContain("::warning title=NorbiAI ignored an unknown model");
  });

  it("reads a directive in an HTML comment written without spaces", () => {
    const { model } = resolve({ description: "<!--NorbiAI-Model: chatgpt-web/medium-->" });

    expect(model).toBe("chatgpt-web/medium");
  });

  // Two allowed words joined by a space are a substring of the allowlist, so a membership
  // test written as a substring test accepted them and put both on one command line.
  it.each([
    ["model", "NorbiAI-Model: chatgpt-web/high chatgpt-web/medium"],
    ["reasoning effort", "NorbiAI-Effort: low medium"],
  ])("refuses two allowed %s values given as one", (label, description) => {
    const { model, effort, log } = resolve({ description });

    expect({ model, effort }).toEqual(defaults);
    expect(log).toContain(`::warning title=NorbiAI ignored an unknown ${label}`);
  });

  // A longer fence quotes a shorter one, which is how a Markdown example of a fenced block is
  // written. Toggling on every fence let the inner one end the exclusion and handed the review
  // back to the example.
  it("keeps a directive quoted by a longer fence out of the choice", () => {
    const { model } = resolve({
      description: [
        "<!-- NorbiAI-Model: chatgpt-web/medium -->",
        "",
        "````",
        "```",
        "NorbiAI-Model: gpt-6-astra",
        "```",
        "````",
      ].join("\n"),
    });

    expect(model).toBe("chatgpt-web/medium");
  });

  it("does not let a fence of the other character close an open block", () => {
    const { model } = resolve({
      description: [
        "<!-- NorbiAI-Model: chatgpt-web/medium -->",
        "",
        "```",
        "~~~",
        "NorbiAI-Model: gpt-6-astra",
        "```",
      ].join("\n"),
    });

    expect(model).toBe("chatgpt-web/medium");
  });

  // Only an opening fence carries an info string. Closing on any suffix let the ```bash line
  // of a ```markdown example end the block, and the lines under it went back to being read.
  it("does not treat a fence with an info string as a closing fence", () => {
    const { model } = resolve({
      description: [
        "<!-- NorbiAI-Model: chatgpt-web/medium -->",
        "",
        "```markdown",
        "```bash",
        "NorbiAI-Model: gpt-6-astra",
        "```",
      ].join("\n"),
    });

    expect(model).toBe("chatgpt-web/medium");
  });

  it("still closes a block on a fence padded with spaces", () => {
    const { model } = resolve({
      description: ["```", "NorbiAI-Model: gpt-6-astra", "```   ", "NorbiAI-Model: chatgpt-web/medium"].join("\n"),
    });

    expect(model).toBe("chatgpt-web/medium");
  });

  // The shared default effort is the cheapest level, because the Codex model that reads it
  // may go no higher. A Claude review that asked for no effort would run at that level.
  it("runs a Claude model on Claude Code, at the Claude default effort unless asked", () => {
    expect(resolve({ description: "NorbiAI-Model: claude-opus-5-5" })).toMatchObject({
      cli: "claude",
      effort: job.env.CLAUDE_DEFAULT_EFFORT,
      reviewer: `claude-opus-5-5, reasoning effort ${job.env.CLAUDE_DEFAULT_EFFORT}`,
    });
    expect(resolve({ description: "NorbiAI-Model: claude-sonnet-5\nNorbiAI-Effort: low" })).toMatchObject({
      cli: "claude",
      effort: "low",
    });
    expect(resolve({ description: "Fixes a bug." }).cli).toBe("codex");
  });

  // The published review says what ran. Naming an effort beside a chatgpt-web slug described
  // a setting that model never read, and a reader asking why a review was shallow would have
  // blamed the wrong knob.
  it("reports the effort only for a model that reads it", () => {
    expect(resolve({ description: "NorbiAI-Model: gpt-6-astra" }).reviewer).toBe("gpt-6-astra, reasoning effort low");
    expect(resolve({ description: "NorbiAI-Model: chatgpt-web/pro\nNorbiAI-Effort: xhigh" }).reviewer).toBe(
      "chatgpt-web/pro",
    );
  });

  // The effort only reaches gpt-6-astra: a chatgpt-web slug carries its own level. The list
  // is what that model accepts, less `max` and `ultra`, which are withheld on purpose — so
  // the assertion is exact rather than a subset check, and putting one back has to be a
  // decision made here too.
  it("offers exactly the reasoning levels gpt-6-astra supports", () => {
    expect(job.env.ALLOWED_EFFORTS?.split(" ")).toEqual(["low", "medium", "high", "xhigh"]);
    expect(job.env.ALLOWED_MODELS?.split(" ")).toContain("gpt-6-astra");
    expect(job.env.ALLOWED_MODELS?.split(" ")).toContain(job.env.DEFAULT_MODEL);
    expect(job.env.ALLOWED_EFFORTS?.split(" ")).toContain(job.env.DEFAULT_EFFORT);
  });
});
