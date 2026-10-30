import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, parse, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AvatarHue,
  isAgentTemplateRoutine,
  isAvatarHue,
  isSkillCategory,
  type MarketplaceAgentRoutine,
  type SkillCategory,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { unzipSync, zipSync } from "fflate";
import { parse as parseYaml } from "yaml";

const logger = createOpenBotLogger("build-production-catalog");

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptRoot, "..");
const sourceRoot = join(projectRoot, "marketplace", "production-catalog");
const defaultOutput = join(projectRoot, "out", "marketplace-production");
const zipTimestamp = new Date("1980-01-01T00:00:00.000Z");
const dependencyPattern =
  /(?:\bMCP\b|\bconnectors?\b|https?:\/\/|\b(?:npm|pnpm|yarn|bun|pipx?|uv|brew|apt(?:-get)?|cargo)\s+(?:add|install)\b)/iu;

interface UpstreamSource {
  repository: string;
  commit: string;
}

type UpstreamProvider = "openai" | "anthropic" | "cursor";

/**
 * A vendored plugin in `bundles/<slug>/`, published as one skill `<slug>`. Its archive holds an index
 * `SKILL.md` and each folder of the plugin's `skills/` as `skills/<slug>-<folder>/`, which the app
 * installs as a skill of its own, so `$<slug>-<folder>` calls it with any provider. References to
 * other skills of the pack are renamed. `aliasPrefixes` lets the text name a skill without that
 * prefix, as pstack names `principle-fix-root-causes` the **fix-root-causes** principle.
 */
interface PackSpec {
  slug: string;
  source: UpstreamProvider;
  upstreamPath: string;
  aliasPrefixes: string[];
  category: SkillCategory;
  description: string;
}

interface Pack {
  spec: PackSpec;
  folders: string[];
}

type SkillSpec = {
  slug: string;
  category: SkillCategory;
  featured: boolean;
} & ({ source: "openbot" } | { source: UpstreamProvider; upstreamSkill: string; pack?: Pack });

interface AgentSpec {
  category: SkillCategory;
  featured: boolean;
  slug: string;
  name: string;
  title: string;
  description: string;
  avatarHue: AvatarHue;
  skills: string[];
  routines: MarketplaceAgentRoutine[];
}

interface CatalogSpec {
  schemaVersion: number;
  catalogVersion: string;
  sources: Record<UpstreamProvider, UpstreamSource>;
  skills: SkillSpec[];
  agents: AgentSpec[];
}

interface BuiltSkill {
  id: string;
  versionId: string;
  icon: string;
  iconSha256: string;
  slug: string;
  name: string;
  description: string;
  category: SkillCategory;
  version: number;
  bundle: string;
  bundleSha256: string;
  files: string[];
  featured: boolean;
  license: "Apache-2.0" | "MIT" | "PolyForm-Noncommercial-1.0.0";
  source:
    | { provider: "openbot"; url: string }
    | {
        provider: UpstreamProvider;
        upstreamSkill: string;
        repository: string;
        commit: string;
        url: string;
      };
}

export async function buildProductionCatalog(outputArgument?: string): Promise<string> {
  const spec = await loadCatalogSpec();
  const output = resolve(outputArgument ?? join(defaultOutput, spec.catalogVersion));
  validateOutputTarget(output);
  const version = catalogVersionNumber(spec.catalogVersion);
  const license = await readFile(join(sourceRoot, "licenses", "APACHE-2.0.txt"), "utf8");
  const openbotLicense = await readFile(join(projectRoot, "LICENSE"), "utf8");
  const staging = await mkdtemp(join(tmpdir(), "openbot-production-catalog-"));

  try {
    const skillOutput = join(staging, "skills");
    await mkdir(skillOutput, { recursive: true });
    const builtSkills: BuiltSkill[] = [];

    for (const skill of spec.skills) {
      const pack = skill.source === "openbot" ? undefined : skill.pack;
      const archive =
        skill.source !== "openbot" && pack
          ? await packArchive(pack, spec.sources[skill.source])
          : await promptArchive(skill, skill.source === "openbot" ? openbotLicense : license, spec.sources);
      const preview = inspectGeneratedArchive(archive, pack !== undefined);
      if (preview.slug !== skill.slug) {
        throw new Error(`Skill folder ${skill.slug} does not match its SKILL.md name (${preview.slug}).`);
      }
      const bundle = `skills/${skill.slug}.zip`;
      await writeFile(join(staging, bundle), archive);
      const bundleSha256 = sha256(archive);
      const icon = `skills/${skill.slug}.icon.svg`;
      const artwork = utf8Bytes(createCategoryIcon(skill.category));
      await writeFile(join(staging, icon), artwork);
      builtSkills.push({
        id: skillId(skill.slug),
        versionId: skillVersionId(skill.slug, version, bundleSha256),
        icon,
        iconSha256: sha256(artwork),
        slug: skill.slug,
        name: preview.name,
        description: preview.description,
        category: skill.category,
        version,
        bundle,
        bundleSha256,
        files: preview.files,
        featured: skill.featured,
        license: skillLicense(skill.source),
        source:
          skill.source === "openbot"
            ? {
                provider: "openbot",
                url: `marketplace/production-catalog/skills/${skill.slug}/SKILL.md`,
              }
            : {
                provider: skill.source,
                upstreamSkill: skill.upstreamSkill,
                repository: spec.sources[skill.source].repository,
                commit: spec.sources[skill.source].commit,
                url: upstreamSkillUrl(skill, spec.sources[skill.source]),
              },
      });
    }

    const catalog = {
      schemaVersion: spec.schemaVersion,
      catalogVersion: spec.catalogVersion,
      sources: spec.sources,
      skills: builtSkills,
    };
    const agents = {
      schemaVersion: spec.schemaVersion,
      catalogVersion: spec.catalogVersion,
      agents: spec.agents.map((agent) => buildAgent(agent, builtSkills, version)),
    };
    const notices = createUpstreamNotices(spec, builtSkills);
    await writeFile(join(staging, "catalog.json"), stableJson(catalog));
    await writeFile(join(staging, "agents.json"), stableJson(agents));
    await writeFile(join(staging, "UPSTREAM_NOTICES.md"), notices);

    const checksumPaths = (await listRelativeFiles(staging)).filter((path) => path !== "SHA256SUMS");
    const checksums = await Promise.all(
      checksumPaths.map(async (path) => `${sha256(await readFile(join(staging, path)))}  ${path}`),
    );
    await writeFile(join(staging, "SHA256SUMS"), `${checksums.join("\n")}\n`);
    await publishStaging(staging, output);
    return output;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export function validateSkillMarkdown(slug: string, markdown: string): void {
  if (!markdown.startsWith("---\n")) throw new Error(`${slug}/SKILL.md must start with YAML frontmatter.`);
  if (dependencyPattern.test(markdown)) {
    throw new Error(`${slug}/SKILL.md requires a forbidden external dependency or network resource.`);
  }
}

async function promptArchive(skill: SkillSpec, license: string, sources: CatalogSpec["sources"]): Promise<Uint8Array> {
  const markdown = await readFile(join(sourceRoot, "skills", skill.slug, "SKILL.md"), "utf8");
  validateSkillMarkdown(skill.slug, markdown);
  const notice =
    skill.source === "openbot"
      ? "Original Skill instructions by the OpenBot team. Licensed under PolyForm Noncommercial 1.0.0 (LICENSE.txt).\n"
      : createSkillNotice(skill, sources[skill.source]);
  return zipSync(
    {
      "LICENSE.txt": [utf8Bytes(license), { mtime: zipTimestamp }],
      "NOTICE.txt": [utf8Bytes(notice), { mtime: zipTimestamp }],
      "SKILL.md": [utf8Bytes(markdown), { mtime: zipTimestamp }],
    },
    { level: 9 },
  );
}

/**
 * The index `SKILL.md`, the pack's `LICENSE` and `NOTICE.md`, and each skill of the pack in
 * `skills/<pack>-<folder>/`. The upstream text is not checked against `dependencyPattern`.
 */
async function packArchive(pack: Pack, upstream: UpstreamSource): Promise<Uint8Array> {
  const prefix = pack.spec.slug;
  const root = join(sourceRoot, "bundles", prefix);
  const entries: Record<string, [Uint8Array, { mtime: Date }]> = {
    LICENSE: [new Uint8Array(await readFile(join(root, "LICENSE"))), { mtime: zipTimestamp }],
    "NOTICE.md": [
      utf8Bytes(packNotice(await readFile(join(root, "NOTICE.md"), "utf8"), pack, upstream)),
      { mtime: zipTimestamp },
    ],
  };
  const index: string[] = [];
  for (const folder of pack.folders) {
    const { files, description } = await packSkillFiles(pack, folder, upstream);
    for (const [file, bytes] of files) entries[`skills/${prefix}-${folder}/${file}`] = [bytes, { mtime: zipTimestamp }];
    index.push(`- \`$${prefix}-${folder}\`: ${description.replace(/\s+/gu, " ")}`);
  }
  const markdown = `---\nname: ${prefix}\ndescription: ${JSON.stringify(pack.spec.description)}\n---\n\n# ${prefix}\n\nThis skill installs the ${pack.folders.length} ${prefix} skills below, each as a skill of its own. Call one with \`$<name>\`.\n\n${index.join("\n")}\n`;
  entries["SKILL.md"] = [utf8Bytes(markdown), { mtime: zipTimestamp }];
  return zipSync(entries, { level: 9 });
}

/**
 * One skill folder of a pack and, when it names one, the pack's subagent prompts in `agents/`.
 * Markdown is renamed by `renamePackReferences`; other files are copied unchanged.
 */
async function packSkillFiles(pack: Pack, folder: string, upstream: UpstreamSource) {
  const root = join(sourceRoot, "bundles", pack.spec.slug);
  const sources = new Map<string, string>();
  for (const file of await listRelativeFiles(join(root, "skills", folder)))
    sources.set(file, `skills/${folder}/${file}`);
  if ([...sources.keys()].some((file) => file.startsWith("agents/"))) {
    throw new Error(`Pack skill ${pack.spec.slug}/${folder} must not have its own agents/.`);
  }
  const texts = new Map<string, string>();
  for (const [file, source] of sources) {
    if (file.endsWith(".md")) texts.set(file, await readFile(join(root, source), "utf8"));
  }
  const agents = (await pathExists(join(root, "agents"))) ? await listRelativeFiles(join(root, "agents")) : [];
  const hasAgents = agents.some((agent) =>
    [...texts.values()].some((text) => text.includes(agent.replace(/\.md$/u, ""))),
  );
  for (const agent of hasAgents ? agents : []) {
    sources.set(`agents/${agent}`, `agents/${agent}`);
    texts.set(`agents/${agent}`, await readFile(join(root, "agents", agent), "utf8"));
  }
  if (!texts.get("SKILL.md")?.startsWith("---\n")) {
    throw new Error(`${pack.spec.slug}/${folder}/SKILL.md must start with YAML frontmatter.`);
  }
  const files = new Map<string, Uint8Array>();
  let description = "";
  for (const [file, source] of sources) {
    const text = texts.get(file);
    if (text === undefined) {
      files.set(file, new Uint8Array(await readFile(join(root, source))));
      continue;
    }
    let renamed = renamePackReferences(text, source, file, pack, folder, upstream);
    if (file === "SKILL.md") {
      renamed = packSkillMarkdown(renamed, pack, folder, hasAgents, [...sources.keys()]);
      description = skillDescription(renamed);
    }
    files.set(file, utf8Bytes(renamed));
  }
  return { files, description };
}

function skillDescription(markdown: string): string {
  const metadata = parseYaml(markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1] ?? "");
  if (!isDynamicRecord(metadata) || !isString(metadata.description))
    throw new Error("Pack SKILL.md has no description.");
  return metadata.description.trim();
}

/** Sets the prefixed name, lets the model load the skill, and adds how the pack is installed. */
function packSkillMarkdown(markdown: string, pack: Pack, folder: string, hasAgents: boolean, files: string[]): string {
  const prefix = pack.spec.slug;
  const end = markdown.indexOf("\n---", 3);
  const frontmatter = markdown
    .slice(0, end)
    .split("\n")
    .filter((line) => line.trim() !== "disable-model-invocation: true")
    .map((line) => (line.startsWith("name:") ? `name: ${prefix}-${folder}` : line))
    .join("\n");
  const aliases = pack.spec.aliasPrefixes.map(
    (alias) => ` A ${alias.replace(/-$/u, "")} \`<name>\` is \`${prefix}-${alias}<name>\`.`,
  );
  const notes = [
    `This skill is part of ${prefix}. OpenBot installs each ${prefix} skill as its own skill: the skill \`<name>\` is \`${prefix}-<name>\`.${aliases.join("")} Call a skill with \`$${prefix}-<name>\`.`,
    ...(hasAgents
      ? [
          'For `subagent_type: "<agent>"`, when your harness does not know that type, start a general subagent. Give it the body of `agents/<agent>.md` first, then the task.',
        ]
      : []),
    ...(files.some((file) => /(^|\/)scripts\//u.test(file))
      ? ["Run a script with its interpreter, such as `node`, `bun` or `bash`. Installed files are not executable."]
      : []),
    `The license and notice are in \`../${prefix}/LICENSE\` and \`../${prefix}/NOTICE.md\`.`,
  ];
  return `${frontmatter}${markdown.slice(end).trimEnd()}\n\n## ${prefix} in OpenBot\n\n${notes.map((note) => `- ${note}`).join("\n")}\n`;
}

/**
 * Renames what the upstream text calls another skill of the pack: relative links, slash commands,
 * `name` and **name** mentions, and `<upstreamPath>/skills/<name>/` paths. A link to a file that no
 * pack skill installs goes to the pinned upstream commit instead.
 */
function renamePackReferences(
  text: string,
  source: string,
  file: string,
  pack: Pack,
  folder: string,
  upstream: UpstreamSource,
): string {
  const prefix = pack.spec.slug;
  const names = [...pack.folders].sort((left, right) => right.length - left.length).map(escapeRegExp);
  const aliases = new Map(
    pack.folders.flatMap((candidate) =>
      pack.spec.aliasPrefixes
        .filter((alias) => candidate.startsWith(alias))
        .map((alias) => [candidate.slice(alias.length), candidate] as const),
    ),
  );
  const named = names.join("|");
  const installedFile = posix.join(`${prefix}-${folder}`, file);
  return text
    .replace(/\]\(([^)\s]+)\)/gu, (link, target: string) => {
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/iu.test(target)) return link;
      const [path = "", anchor] = target.split("#", 2);
      const resolved = posix.normalize(posix.join(posix.dirname(source), path));
      const installed = installedPackPath(resolved, pack);
      const next = installed
        ? posix.relative(posix.dirname(installedFile), installed)
        : `${upstream.repository}/blob/${upstream.commit}/${pack.spec.upstreamPath}/${resolved}`;
      return `](${next}${anchor === undefined ? "" : `#${anchor}`})`;
    })
    .replace(
      new RegExp(`(?<![\\w.-])${escapeRegExp(pack.spec.upstreamPath)}/skills/(${named})/`, "gu"),
      `.agents/skills/${prefix}-$1/`,
    )
    .replace(new RegExp(`(?<![\\w/.$-])/(${named})(?![\\w/-]|\\.\\w)`, "gu"), `$${prefix}-$1`)
    .replace(new RegExp(`\`(${named})\``, "gu"), `\`${prefix}-$1\``)
    .replace(new RegExp(`\\*\\*(${named})\\*\\*`, "gu"), `**${prefix}-$1**`)
    .replace(
      new RegExp(`\\*\\*(${[...aliases.keys()].map(escapeRegExp).join("|") || "(?!)"})\\*\\*`, "gu"),
      (_match, alias: string) => `**${prefix}-${aliases.get(alias)}**`,
    );
}

/** Where a bundle path is installed, relative to the skills folder, or null when no skill has it. */
function installedPackPath(path: string, pack: Pack): string | null {
  const [root, folder, ...rest] = path.split("/");
  if (root === "skills" && folder && pack.folders.includes(folder))
    return posix.join(`${pack.spec.slug}-${folder}`, ...rest);
  return null;
}

function packNotice(notice: string, pack: Pack, upstream: UpstreamSource): string {
  const prefix = pack.spec.slug;
  return `${notice.trimEnd()}\n\nOpenBot publishes that plugin at commit \`${upstream.commit}\` as the skill \`${prefix}\`, which installs\neach folder of its \`skills/\` as the skill \`${prefix}-<folder>\`. The changes are: names of other ${prefix}\nskills in links, commands and mentions start with \`${prefix}-\`, \`disable-model-invocation\` is removed, the\n\`${prefix} in OpenBot\` section is added to each \`SKILL.md\`, a skill that names a subagent gets \`agents/\`, links\nto files outside the skills go to the upstream commit, and the index \`SKILL.md\` is added.\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function skillLicense(source: SkillSpec["source"]): BuiltSkill["license"] {
  if (source === "openbot") return "PolyForm-Noncommercial-1.0.0";
  return source === "cursor" ? "MIT" : "Apache-2.0";
}

function inspectGeneratedArchive(archive: Uint8Array, vendored: boolean) {
  if (archive.byteLength === 0 || archive.byteLength > 10 * 1024 * 1024) {
    throw new Error("Generated skill archive exceeds the marketplace size limit.");
  }
  const entries = unzipSync(archive);
  const files = Object.keys(entries).sort();
  if (vendored ? files.length > 200 : files.join("\n") !== "LICENSE.txt\nNOTICE.txt\nSKILL.md") {
    throw new Error(
      `Generated skill archive contains ${files.length} unexpected files: ${files.slice(0, 10).join(", ")}.`,
    );
  }
  const skillFile = entries["SKILL.md"];
  if (!skillFile) throw new Error("Generated skill archive is missing SKILL.md.");
  const markdown = new TextDecoder("utf-8", { fatal: true }).decode(skillFile);
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) throw new Error("Generated SKILL.md has invalid frontmatter.");
  const metadata = parseYaml(match[1] ?? "");
  if (!isDynamicRecord(metadata)) throw new Error("Generated SKILL.md metadata is invalid.");
  const name = isString(metadata.name) ? metadata.name.trim() : "";
  const description = isString(metadata.description) ? metadata.description.trim() : "";
  if (!name || name.length > 80 || !description || description.length > 500) {
    throw new Error("Generated SKILL.md exceeds marketplace metadata limits.");
  }
  return { name, description, slug: slugify(name), files };
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 64);
  if (!slug) throw new Error("Generated skill name cannot form a valid slug.");
  return slug;
}

function buildAgent(agent: AgentSpec, skills: BuiltSkill[], version: number) {
  const selected = agent.skills.map((slug) => {
    const skill = skills.find((candidate) => candidate.slug === slug);
    if (!skill) throw new Error(`Agent ${agent.slug} references unknown skill ${slug}.`);
    return {
      skillId: skill.id,
      versionId: skill.versionId,
      slug: skill.slug,
      name: skill.name,
      version: skill.version,
    };
  });
  const snapshot = {
    id: `openbot-curated-agent-${agent.slug}`,
    slug: agent.slug,
    name: agent.name,
    title: agent.title,
    category: agent.category,
    featured: agent.featured,
    description: agent.description,
    avatarSeed: `openbot-curated-agent-${agent.slug}`,
    avatarHue: agent.avatarHue,
    version,
    skills: selected,
    routines: agent.routines,
  };
  const snapshotHash = sha256(JSON.stringify(snapshot));
  return {
    ...snapshot,
    versionId: `openbot-curated-agent-version-${agent.slug}-v${version}-${snapshotHash.slice(0, 16)}`,
  };
}

async function loadCatalogSpec(): Promise<CatalogSpec> {
  const raw = JSON.parse(await readFile(join(sourceRoot, "catalog.json"), "utf8"));
  if (!isDynamicRecord(raw) || raw.schemaVersion !== 1 || !isString(raw.catalogVersion)) {
    throw new Error("Production catalog metadata is invalid.");
  }
  const sources = parseSources(raw.sources);
  if (!Array.isArray(raw.skills) || !Array.isArray(raw.agents) || !Array.isArray(raw.packs)) {
    throw new Error("Production catalog skills, packs and agents must be arrays.");
  }
  const packs = await Promise.all(raw.packs.map(parsePackSpec).map(packSkillSpec));
  const skills = [...raw.skills.map(parseSkillSpec), ...packs];
  const duplicateSkill = skills.find((skill, index) => skills.findIndex((item) => item.slug === skill.slug) !== index);
  if (duplicateSkill) throw new Error(`Duplicate production skill slug: ${duplicateSkill.slug}.`);
  return {
    schemaVersion: raw.schemaVersion,
    catalogVersion: raw.catalogVersion,
    sources,
    skills,
    agents: raw.agents.map(parseAgentSpec),
  };
}

function parsePackSpec(value: unknown): PackSpec {
  if (
    !isDynamicRecord(value) ||
    !isString(value.slug) ||
    !/^[a-z0-9][a-z0-9-]{0,31}$/u.test(value.slug) ||
    (value.source !== "openai" && value.source !== "anthropic" && value.source !== "cursor") ||
    !isString(value.upstreamPath) ||
    !Array.isArray(value.aliasPrefixes) ||
    !value.aliasPrefixes.every(isString) ||
    !isSkillCategory(value.category) ||
    !isString(value.description)
  ) {
    throw new Error("Production catalog contains an invalid pack.");
  }
  return {
    slug: value.slug,
    source: value.source,
    upstreamPath: value.upstreamPath,
    aliasPrefixes: value.aliasPrefixes,
    category: value.category,
    description: value.description,
  };
}

async function packSkillSpec(spec: PackSpec): Promise<SkillSpec> {
  const entries = await readdir(join(sourceRoot, "bundles", spec.slug, "skills"), { withFileTypes: true });
  const folders = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  // The app installs only a child whose folder name is a valid skill slug.
  const invalid = folders.find((folder) => !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(`${spec.slug}-${folder}`));
  if (invalid) throw new Error(`Pack ${spec.slug} has a skill folder that is not a valid slug: ${invalid}.`);
  return {
    slug: spec.slug,
    category: spec.category,
    featured: false,
    source: spec.source,
    upstreamSkill: spec.upstreamPath,
    pack: { spec, folders },
  };
}

function parseSources(value: unknown): CatalogSpec["sources"] {
  if (!isDynamicRecord(value)) throw new Error("Production catalog sources are invalid.");
  return {
    openai: parseSource(value.openai, "openai"),
    anthropic: parseSource(value.anthropic, "anthropic"),
    cursor: parseSource(value.cursor, "cursor"),
  };
}

function parseSource(value: unknown, name: string): UpstreamSource {
  if (
    !isDynamicRecord(value) ||
    !isString(value.repository) ||
    !isString(value.commit) ||
    !/^[a-f0-9]{40}$/u.test(value.commit)
  ) {
    throw new Error(`Production catalog source ${name} is invalid.`);
  }
  return { repository: value.repository, commit: value.commit };
}

function parseSkillSpec(value: unknown): SkillSpec {
  if (
    !isDynamicRecord(value) ||
    !isString(value.slug) ||
    !isSkillCategory(value.category) ||
    (value.source !== "openai" && value.source !== "anthropic" && value.source !== "openbot") ||
    (value.source !== "openbot" && !isString(value.upstreamSkill)) ||
    (value.featured !== undefined && typeof value.featured !== "boolean")
  ) {
    throw new Error("Production catalog contains an invalid skill.");
  }
  const base = {
    slug: value.slug,
    category: value.category,
    featured: value.featured === true,
  };
  if (value.source === "openbot") return { ...base, source: "openbot" };
  if (!isString(value.upstreamSkill)) throw new Error("Upstream skill is required.");
  return { ...base, source: value.source, upstreamSkill: value.upstreamSkill };
}

function parseAgentSpec(value: unknown): AgentSpec {
  if (
    !isDynamicRecord(value) ||
    !isString(value.slug) ||
    !isString(value.name) ||
    !isString(value.title) ||
    !isSkillCategory(value.category) ||
    (value.featured !== undefined && typeof value.featured !== "boolean") ||
    !isString(value.description) ||
    !isNumber(value.avatarHue) ||
    !isAvatarHue(value.avatarHue) ||
    !Array.isArray(value.skills) ||
    !value.skills.every(isString)
  ) {
    throw new Error("Production catalog contains an invalid agent.");
  }
  // The publisher writes routines straight to D1, so they get the checks that a submission gets.
  const routines = value.routines ?? [];
  if (
    !Array.isArray(routines) ||
    routines.length > INPUT_LIMITS.agentRoutines ||
    !routines.every(isAgentTemplateRoutine)
  ) {
    throw new Error(`Production catalog agent ${value.slug} has an invalid routine.`);
  }
  return {
    slug: value.slug,
    name: value.name,
    title: value.title,
    category: value.category,
    featured: value.featured === true,
    description: value.description,
    avatarHue: value.avatarHue,
    skills: value.skills,
    routines,
  };
}

function createSkillNotice(skill: Extract<SkillSpec, { upstreamSkill: string }>, upstream: UpstreamSource): string {
  return `OpenBot production catalog\n\nThis skill is an OpenBot-authored derivative of ${skill.upstreamSkill}\nfrom ${upstream.repository} at commit ${upstream.commit}.\n\nThe instructions were modified for brand-neutral use, reduced to prompt-only content,\nand stripped of external service, connector, executable, and package requirements.\n\nUpstream source: ${upstreamSkillUrl(skill, upstream)}\nLicense: Apache License 2.0 (included as LICENSE.txt)\n`;
}

function createUpstreamNotices(spec: CatalogSpec, skills: BuiltSkill[]): string {
  const entries = skills.map((skill) =>
    skill.source.provider === "openbot"
      ? `- **${skill.slug}** — original OpenBot team instructions; PolyForm Noncommercial 1.0.0.`
      : skill.source.provider === "cursor"
        ? `- **${skill.slug}** — copy of [${skill.source.upstreamSkill}](${skill.source.url}) from cursor commit \`${skill.source.commit}\`, with pstack skill names prefixed; MIT.`
        : `- **${skill.slug}** — derivative of [${skill.source.upstreamSkill}](${skill.source.url}) from ${skill.source.provider} commit \`${skill.source.commit}\`.`,
  );
  return `# Upstream Notices\n\nThis catalog contains original OpenBot team skills under PolyForm Noncommercial 1.0.0, derivatives from the pinned OpenAI and Anthropic repositories under Apache License 2.0, and the skills of the pinned Cursor pstack plugin, with their names prefixed, under the MIT License. Each bundle includes its applicable license and notice.\n\n${entries.join("\n")}\n\nCatalog version: \`${spec.catalogVersion}\`\n`;
}

function upstreamSkillUrl(skill: Extract<SkillSpec, { upstreamSkill: string }>, upstream: UpstreamSource): string {
  if (skill.source === "cursor") return `${upstream.repository}/tree/${upstream.commit}/${skill.upstreamSkill}`;
  const segment = skill.source === "openai" ? "skills/.curated" : "skills";
  return `${upstream.repository}/tree/${upstream.commit}/${segment}/${skill.upstreamSkill}`;
}

function skillId(slug: string): string {
  return `openbot-curated-skill-${slug}`;
}

function skillVersionId(slug: string, version: number, bundleSha256: string): string {
  return `openbot-curated-version-${slug}-v${version}-${bundleSha256.slice(0, 16)}`;
}

function catalogVersionNumber(value: string): number {
  const match = /^v([1-9]\d*)$/u.exec(value);
  if (!match?.[1]) throw new Error("Production catalog version must use the form v1, v2, and so on.");
  return Number.parseInt(match[1], 10);
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function utf8Bytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "utf8"));
}

/*
 * Every category carries its own colour and mark, so a listing reads as a set and a Skill without
 * artwork of its own still shows more than the generic fallback glyph. The mark is drawn as paths
 * rather than as text: an emoji would depend on a font the reader's computer may not carry.
 */
const categoryArtwork: Record<SkillCategory, { background: string; mark: string }> = {
  coding: { background: "#2463a6", mark: '<path d="M9 18 3 12 9 6"/><path d="m15 6 6 6-6 6"/>' },
  design: {
    background: "#be4d86",
    mark: '<circle cx="9" cy="9" r="5.5"/><rect x="10.5" y="10.5" width="9" height="9" rx="1.5"/>',
  },
  "data-analytics": { background: "#268477", mark: '<path d="M5 20V11"/><path d="M12 20V4"/><path d="M19 20v-6"/>' },
  documents: {
    background: "#7255ce",
    mark: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h4"/><path d="M10 13h6"/><path d="M10 17h6"/>',
  },
  productivity: { background: "#e88124", mark: '<circle cx="12" cy="12" r="8.5"/><path d="m8 12 3 3 5-6"/>' },
  research: { background: "#3b7dd8", mark: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>' },
  automation: {
    background: "#c0563f",
    mark: '<path d="M13 3 5 14h5l-1 7 8-11h-5z" stroke-linejoin="round"/>',
  },
  other: { background: "#526178", mark: '<path d="m12 4 2 5.5L19.5 12 14 14.5 12 20l-2-5.5L4.5 12 10 9.5z"/>' },
};

function createCategoryIcon(category: SkillCategory): string {
  const artwork = categoryArtwork[category];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect width="80" height="80" rx="18" fill="${artwork.background}"/><g transform="translate(16 16) scale(2)" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${artwork.mark}</g></svg>\n`;
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validateOutputTarget(output: string): void {
  const filesystemRoot = parse(output).root;
  const forbidden = new Set([filesystemRoot, resolve(homedir()), projectRoot, sourceRoot]);
  if (forbidden.has(output)) throw new Error(`Refusing to use unsafe output directory: ${output}`);
}

async function publishStaging(staging: string, output: string): Promise<void> {
  await mkdir(dirname(output), { recursive: true });
  if (!(await pathExists(output))) {
    await rename(staging, output);
    return;
  }
  const [stagedFiles, outputFiles] = await Promise.all([listRelativeFiles(staging), listRelativeFiles(output)]);
  if (stagedFiles.length !== outputFiles.length || stagedFiles.some((file, index) => file !== outputFiles[index])) {
    throw new Error(`Output directory already exists with different contents: ${output}`);
  }
  for (const file of stagedFiles) {
    const [staged, existing] = await Promise.all([readFile(join(staging, file)), readFile(join(output, file))]);
    if (!staged.equals(existing)) throw new Error(`Output directory already exists with different contents: ${output}`);
  }
}

async function listRelativeFiles(root: string, relative = ""): Promise<string[]> {
  const directory = join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listRelativeFiles(root, child)));
    else if (entry.isFile()) files.push(child);
    else throw new Error(`Catalog output contains an unsupported filesystem entry: ${child}`);
  }
  return files.sort();
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isDynamicRecord(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function parseArguments(args: string[]): string | undefined {
  if (args.includes("--help")) {
    process.stdout.write("Usage: bun run marketplace:build -- [--output <directory>]\n");
    process.exit(0);
  }
  if (args.length === 0) return undefined;
  if (args.length === 2 && args[0] === "--output" && args[1]) return args[1];
  throw new Error("Usage: bun run marketplace:build -- [--output <directory>]");
}

if (import.meta.main) {
  buildProductionCatalog(parseArguments(process.argv.slice(2)))
    .then((output) => process.stdout.write(`Built production marketplace artifacts at ${output}.\n`))
    .catch((error) => {
      logger.error("Production catalog generation failed.", toLogValue(error));
      process.exitCode = 1;
    });
}
