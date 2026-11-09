import { createHash } from "node:crypto";
import { lstatSync, opendirSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { isHermesProfileId, MAX_HERMES_PROFILE_IDS } from "@openbot/contracts/agent-providers";
import { sourceText } from "@openbot/i18n/source";
import { hermesHome, hermesRoot } from "./process-confinement";

const IDENTITY_FILES = ["config.yaml", ".env", "SOUL.md", "profile.yaml", "auth.json", "state.db"];
const DISCOVERY_ENTRY_LIMIT = 4096;
const RESERVED_PROFILE_IDS = new Set(["hermes", "test", "tmp", "root", "sudo"]);

function isSelectableHermesProfileId(id: string): boolean {
  return isHermesProfileId(id) && !RESERVED_PROFILE_IDS.has(id);
}

export interface HermesRuntimeContext {
  readonly profileId: string | undefined;
  readonly home: string;
  readonly identity: string;
}

function metadata(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function liveProfile(root: string, id: string): boolean {
  const path = join(root, "profiles", id);
  if (metadata(join(root, "profiles", ".deleted", id))) return false;
  if (!metadata(path) || !statSync(path, { throwIfNoEntry: false })?.isDirectory()) return false;
  return IDENTITY_FILES.some((file) => {
    const entry = metadata(join(path, file));
    return entry?.isFile() || entry?.isSymbolicLink();
  });
}

/** Name-only discovery. No config, identity, or credential file contents are read. */
export function listHermesProfiles(env: NodeJS.ProcessEnv = process.env): string[] {
  try {
    const root = hermesRoot(env);
    if (!statSync(root).isDirectory()) throw new Error("Invalid Hermes root.");
    const ids = ["default"];
    const path = join(root, "profiles");
    if (!metadata(path)) return ids;
    const directory = opendirSync(path);
    try {
      let count = 0;
      for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
        if (++count > DISCOVERY_ENTRY_LIMIT) throw new Error("Too many Hermes profile entries.");
        if (entry.name !== "default" && isSelectableHermesProfileId(entry.name) && liveProfile(root, entry.name)) {
          if (ids.length >= MAX_HERMES_PROFILE_IDS) throw new Error("Too many Hermes profile IDs.");
          ids.push(entry.name);
        }
      }
    } finally {
      directory.closeSync();
    }
    return ["default", ...ids.slice(1).sort()];
  } catch {
    throw new Error(sourceText("error.provider.hermesProfilesUnavailable"));
  }
}

/** Resolve an explicit selection before any launch or directory creation. */
export function resolveHermesRuntime(
  profileId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): HermesRuntimeContext {
  if (profileId === undefined) {
    const home = hermesHome(env);
    return { profileId, home, identity: `inherit:${resolve(home)}` };
  }
  if (!isHermesProfileId(profileId)) throw new Error(sourceText("error.provider.hermesProfileInvalid"));
  const root = hermesRoot(env);
  const home = profileId === "default" ? root : join(root, "profiles", profileId);
  try {
    if (!isSelectableHermesProfileId(profileId)) throw new Error("Unavailable Hermes profile.");
    if (profileId === "default" ? !statSync(home).isDirectory() : !liveProfile(root, profileId))
      throw new Error("Missing Hermes profile.");
    const identity = createHash("sha256")
      .update(JSON.stringify([profileId, realpathSync(home)]))
      .digest("hex");
    return { profileId, home, identity };
  } catch {
    throw new Error(sourceText("error.provider.hermesProfileMissing", { profile: profileId }));
  }
}
