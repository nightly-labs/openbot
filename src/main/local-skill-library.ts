import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AgentSummary, MarketplaceSkillDetail } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { parse as parseYaml } from "yaml";
import { archiveDirectory, inspectArchive, normalizedFiles } from "./skill-package";

/** Owns immutable local revisions. A revision exists only after its directory is published. */
export class LocalSkillLibrary {
  #writes: Promise<void> = Promise.resolve();
  constructor(
    readonly root: string,
    private readonly agents: () => AgentSummary[],
  ) {}

  async list(): Promise<MarketplaceSkillDetail[]> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const entries = await readdir(this.root, { withFileTypes: true });
    const published = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^local-skill-[\da-f-]{36}$/u.test(entry.name)) continue;
      const revisions = await readdir(join(this.root, entry.name));
      if (revisions.some((name) => /^[1-9]\d*$/u.test(name))) published.push(entry.name);
    }
    const results = await Promise.all(published.map((id) => this.get(id)));
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  private directory(id: string): string {
    if (!/^local-skill-[\da-f-]{36}$/u.test(id)) throw new Error("Invalid local skill ID.");
    return join(this.root, id);
  }

  private async revision(id: string, requested?: number): Promise<number> {
    if (requested !== undefined) {
      if (!Number.isSafeInteger(requested) || requested < 1) throw new Error("Invalid skill revision.");
      return requested;
    }
    const entries = await readdir(this.directory(id), { withFileTypes: true });
    const revisions = entries
      .filter((entry) => entry.isDirectory() && /^[1-9]\d*$/u.test(entry.name))
      .map((entry) => Number(entry.name));
    if (!revisions.length) throw new Error("Local skill has no published revisions.");
    return Math.max(...revisions);
  }

  async bundle(id: string, revision: number): Promise<Uint8Array> {
    const path = join(this.directory(id), String(await this.revision(id, revision)), "bundle.zip");
    await rejectLinks(this.root, path);
    return new Uint8Array(await readFile(path));
  }

  async get(id: string, requested?: number): Promise<MarketplaceSkillDetail> {
    const revision = await this.revision(id, requested);
    const bytes = await this.bundle(id, revision);
    const info = inspectArchive(bytes);
    const files = normalizedFiles(bytes);
    const text = new TextDecoder().decode(files["SKILL.md"]);
    const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
    const metadata = parseYaml(match?.[1] ?? "");
    const example =
      isDynamicRecord(metadata) && isString(metadata["example-prompt"]) ? metadata["example-prompt"].trim() : "";
    const icon = files["assets/icon.png"];
    const iconUrl =
      icon && icon.byteLength <= 512 * 1024 && Buffer.from(icon.subarray(0, 8)).toString("hex") === "89504e470d0a1a0a"
        ? `data:image/png;base64,${Buffer.from(icon).toString("base64")}`
        : null;
    return {
      ...info,
      id,
      version: revision,
      versionId: String(revision),
      category: "other",
      creatorName: "Local",
      installs: 0,
      featured: false,
      iconUrl,
      updatedAt: (await stat(join(this.directory(id), String(revision)))).mtime.toISOString(),
      bundleSha256: createHash("sha256").update(bytes).digest("hex"),
      instructions: text.slice(match?.[0].length ?? 0).trim(),
      ...(example && example.length <= 1000 ? { examplePrompt: example } : {}),
    };
  }

  create(agentId: string, sourcePath: string): Promise<MarketplaceSkillDetail> {
    return this.serialize(async () => {
      const bytes = await this.source(agentId, sourcePath);
      const info = inspectArchive(bytes);
      if ((await this.list()).some((skill) => skill.slug === info.slug))
        throw new Error("A local skill with this name already exists. Revise it instead.");
      const id = `local-skill-${randomUUID()}`;
      await this.publish(id, 1, bytes);
      return this.get(id, 1);
    });
  }

  revise(agentId: string, id: string, expectedRevision: number, sourcePath: string): Promise<MarketplaceSkillDetail> {
    return this.serialize(async () => {
      const current = await this.get(id);
      if (current.version !== expectedRevision)
        throw new Error("The skill changed. Read its latest revision before revising it.");
      const bytes = await this.source(agentId, sourcePath);
      if (inspectArchive(bytes).slug !== current.slug)
        throw new Error("Keep the skill name unchanged when revising it.");
      await this.publish(id, expectedRevision + 1, bytes);
      return this.get(id, expectedRevision + 1);
    });
  }

  private async source(agentId: string, sourcePath: string): Promise<Uint8Array> {
    const agent = this.agents().find((item) => item.id === agentId);
    if (!agent) throw new Error("Choose a local agent first.");
    if (
      !sourcePath ||
      isAbsolute(sourcePath) ||
      sourcePath.includes("\\") ||
      sourcePath.split("/").some((part) => part === ".." || !part)
    )
      throw new Error("Use a relative skill folder inside the current agent workspace.");
    const root = await realpath(agent.workspacePath);
    const path = resolve(root, sourcePath);
    if (!path.startsWith(`${root}${sep}`)) throw new Error("Skill source must be inside the agent workspace.");
    await rejectLinks(root, path);
    if (!(await lstat(path)).isDirectory()) throw new Error("Skill source must be a folder.");
    if (!(await lstat(join(path, "SKILL.md"))).isFile())
      throw new Error("The skill folder needs SKILL.md at its root.");
    const bytes = await archiveDirectory(path);
    inspectArchive(bytes);
    return bytes;
  }

  private async publish(id: string, revision: number, bytes: Uint8Array): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const directory = this.directory(id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await rejectLinks(this.root, directory);
    const stage = join(directory, `.stage-${randomUUID()}`);
    await mkdir(stage, { mode: 0o700 });
    try {
      await writeFile(join(stage, "bundle.zip"), bytes, { mode: 0o600, flag: "wx" });
      await rename(stage, join(directory, String(revision)));
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }

  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const result = this.#writes.then(run);
    this.#writes = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

async function rejectLinks(root: string, path: string): Promise<void> {
  let current = root;
  if ((await lstat(root)).isSymbolicLink()) throw new Error("Skill paths cannot contain symbolic links.");
  for (const part of relative(root, path).split(sep).filter(Boolean)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error("Skill paths cannot contain symbolic links.");
  }
}
