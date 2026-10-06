import { isValidAvatarImage } from "@openbot/contracts/avatar-images";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentPublicationPreview,
  type AgentSubmission,
  isAvatarHue,
  isAvatarSeed,
  isRoutineSchedule,
  isSkillCategory,
  type MarketplaceAgentDetail,
  type MarketplaceAgentQuery,
  type MarketplaceAgentRoutine,
  type MarketplaceAgentSkill,
  type MarketplaceAgentSummary,
  type SkillCategory,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { Effect, Result, Schema } from "effect";
import {
  decodeMarketplaceCursor,
  encodeMarketplaceCursor,
  type MarketplaceSort,
  marketplaceLikePattern,
  normalizeMarketplaceLimit,
  normalizeMarketplaceQuery,
} from "./marketplace-pagination";
import { MarketplaceStorage } from "./marketplace-storage";
import type { AuthUser, WorkerBindings } from "./types";

const MAX_AGENTS_PER_USER = 5;
const MAX_VERSIONS_PER_AGENT = 5;
const MAX_SUBMISSIONS_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

interface AgentRow {
  category: string;
  show_creator_avatar: number;
  creator_avatar_url: string | null;
  id: string;
  agent_id?: string;
  version_id?: string;
  version: number;
  name: string;
  title: string;
  description: string;
  avatar_seed: string;
  avatar_hue: number | null;
  avatar_key: string | null;
  skills_json: string;
  routines_json: string;
  creator_name: string | null;
  creator_email: string;
  installs: number;
  featured: number;
  updated_at: number;
  created_at: number;
  status?: string;
  rejection_note?: string | null;
}

export class AgentMarketplaceError extends Schema.TaggedError<AgentMarketplaceError>()("AgentMarketplaceError", {
  status: Schema.Number,
  code: Schema.String,
  message: Schema.String,
}) {
  constructor(status: number, code: string, message: string) {
    super({ status, code, message });
  }
}

export class AgentMarketplace {
  constructor(private readonly bindings: Pick<WorkerBindings, "DB" | "SKILLS">) {}

  list(input: MarketplaceAgentQuery = {}) {
    return Effect.fn("AgentMarketplace.list")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        const limit = normalizeMarketplaceLimit(input.limit);
        const clauses = ["agents.approved_version_id = versions.id"];
        const values: Array<string | number> = [];
        const queryInput = normalizeMarketplaceQuery(input.query);
        if (queryInput) {
          clauses.push(
            "(lower(versions.name) LIKE ? ESCAPE '\\' OR lower(versions.title) LIKE ? ESCAPE '\\' OR lower(versions.description) LIKE ? ESCAPE '\\' OR lower(coalesce(nullif(trim(users.name), ''), users.email)) LIKE ? ESCAPE '\\')",
          );
          const query = marketplaceLikePattern(queryInput);
          values.push(query, query, query, query);
        }
        if (input.category !== undefined) {
          if (!isSkillCategory(input.category))
            return yield* Effect.fail(
              marketplaceError(new AgentMarketplaceError(400, "invalid_category", "Unknown agent category.")),
            );
          clauses.push("versions.category = ?");
          values.push(input.category);
        }
        if (input.featured) clauses.push("agents.featured = 1");
        const sort: MarketplaceSort = input.sort === "installs" ? "installs" : "updated";
        const cursor = decodeMarketplaceCursor(input.cursor, sort);
        // A v0 cursor holds only a timestamp. The order also leads with featured and ends with id, so a
        // timestamp cannot say where that page stopped. It adds no clause. The first page comes again
        // and its v1 cursor then pages the rest, which costs one request and loses no agent.
        if (cursor && !("legacyUpdatedAt" in cursor)) {
          const primary = sort === "installs" ? "agents.installs" : "agents.featured";
          clauses.push(
            `(${primary} < ? OR (${primary} = ? AND (agents.updated_at < ? OR (agents.updated_at = ? AND agents.id < ?))))`,
          );
          values.push(cursor.primary, cursor.primary, cursor.updatedAt, cursor.updatedAt, cursor.id);
        }
        const order =
          sort === "installs"
            ? "agents.installs DESC, agents.updated_at DESC, agents.id DESC"
            : "agents.featured DESC, agents.updated_at DESC, agents.id DESC";
        const result = yield* marketplaceCall(() =>
          bindings.DB.prepare(
            `SELECT agents.id, agents.installs, agents.featured, agents.updated_at,
              versions.id AS version_id, versions.version, versions.name, versions.title, versions.description,
              versions.avatar_seed, versions.avatar_hue, versions.avatar_key,
              versions.skills_json, versions.routines_json, versions.category, agents.show_creator_avatar, users.avatar_url AS creator_avatar_url, users.name AS creator_name, users.email AS creator_email
       FROM marketplace_agents agents
       JOIN marketplace_agent_versions versions ON ${clauses.join(" AND ")}
       JOIN users ON users.id = agents.owner_user_id
       ORDER BY ${order} LIMIT ?`,
          )
            .bind(...values, limit + 1)
            .all<AgentRow>(),
        );
        const rows = result.results ?? [];
        const page = rows.slice(0, limit);
        const last = page.at(-1);
        return {
          agents: yield* marketplaceDecode(() => page.map((row) => publicSummary(row))),
          nextCursor:
            rows.length > limit && last
              ? encodeMarketplaceCursor(sort, {
                  primary: sort === "installs" ? last.installs : last.featured,
                  updatedAt: last.updated_at,
                  id: last.id,
                })
              : null,
        };
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  get(agentId: string) {
    return Effect.fn("AgentMarketplace.get")(() =>
      Effect.gen({ self: this }, function* () {
        const row = yield* this.approvedRowEffect(agentId);
        if (!row)
          return yield* Effect.fail(
            marketplaceError(new AgentMarketplaceError(404, "agent_not_found", "The agent was not found.")),
          );
        return yield* marketplaceDecode(() => publicDetail(row));
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  setCreatorAvatar(userId: string, listingId: string, show: boolean) {
    return Effect.fn("AgentMarketplace.setCreatorAvatar")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        const result = yield* marketplaceCall(() =>
          bindings.DB.prepare(
            "UPDATE marketplace_agents SET show_creator_avatar = ? WHERE id = ? AND owner_user_id = ?",
          )
            .bind(show ? 1 : 0, listingId, userId)
            .run(),
        );
        if (!result.meta.changes)
          return yield* Effect.fail(
            marketplaceError(new AgentMarketplaceError(404, "agent_not_found", "The owned agent was not found.")),
          );
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  listMine(userId: string) {
    return Effect.fn("AgentMarketplace.listMine")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        const result = yield* marketplaceCall(() =>
          bindings.DB.prepare(
            `SELECT versions.id, versions.agent_id, versions.version, versions.name, versions.title, versions.description,
              versions.avatar_seed, versions.avatar_hue, versions.avatar_key, versions.skills_json,
              versions.routines_json, versions.status, versions.rejection_note, versions.created_at,
              agents.installs, agents.featured, agents.updated_at, versions.category, agents.show_creator_avatar, users.avatar_url AS creator_avatar_url, users.name AS creator_name, users.email AS creator_email
       FROM marketplace_agent_versions versions
       JOIN marketplace_agents agents ON agents.id = versions.agent_id
       JOIN users ON users.id = agents.owner_user_id
       WHERE agents.owner_user_id = ? ORDER BY versions.created_at DESC`,
          )
            .bind(userId)
            .all<AgentRow>(),
        );
        return yield* marketplaceDecode(() => (result.results ?? []).map(submission));
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  submit(input: {
    user: AuthUser;
    snapshot: unknown;
    avatar: { bytes: Uint8Array; mimeType: string } | null;
    agentId?: string;
    category?: SkillCategory;
    showCreatorAvatar?: boolean;
  }) {
    return Effect.fn("AgentMarketplace.submit")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        const snapshot = yield* marketplaceDecode(() => validateSnapshot(input.snapshot));
        if (input.category !== undefined && !isSkillCategory(input.category))
          return yield* Effect.fail(
            marketplaceError(new AgentMarketplaceError(400, "invalid_category", "Unknown agent category.")),
          );
        const recent = yield* marketplaceCall(() =>
          bindings.DB.prepare(
            `SELECT count(*) AS count FROM marketplace_agent_versions versions
       JOIN marketplace_agents agents ON agents.id = versions.agent_id
       WHERE agents.owner_user_id = ? AND versions.created_at >= ?`,
          )
            .bind(input.user.id, Date.now() - DAY_MS)
            .first<{ count: number }>(),
        );
        if ((recent?.count ?? 0) >= MAX_SUBMISSIONS_PER_DAY)
          return yield* Effect.fail(
            marketplaceError(
              new AgentMarketplaceError(429, "submission_limit", "You can submit up to 10 agent versions per day."),
            ),
          );

        const agentId = input.agentId ?? crypto.randomUUID();
        let version = 1;
        if (input.agentId) {
          const owned = yield* marketplaceCall(() =>
            bindings.DB.prepare("SELECT id FROM marketplace_agents WHERE id = ? AND owner_user_id = ?")
              .bind(input.agentId, input.user.id)
              .first(),
          );
          if (!owned)
            return yield* Effect.fail(
              marketplaceError(new AgentMarketplaceError(404, "agent_not_found", "The owned agent was not found.")),
            );
          const latest = yield* marketplaceCall(() =>
            bindings.DB.prepare("SELECT max(version) AS version FROM marketplace_agent_versions WHERE agent_id = ?")
              .bind(agentId)
              .first<{ version: number | null }>(),
          );
          version = (latest?.version ?? 0) + 1;
          if (version > MAX_VERSIONS_PER_AGENT)
            return yield* Effect.fail(
              marketplaceError(
                new AgentMarketplaceError(
                  409,
                  "agent_version_limit",
                  "Each agent can have up to 5 submitted versions.",
                ),
              ),
            );
        } else {
          const count = yield* marketplaceCall(() =>
            bindings.DB.prepare("SELECT count(*) AS count FROM marketplace_agents WHERE owner_user_id = ?")
              .bind(input.user.id)
              .first<{ count: number }>(),
          );
          if ((count?.count ?? 0) >= MAX_AGENTS_PER_USER)
            return yield* Effect.fail(
              marketplaceError(new AgentMarketplaceError(409, "agent_limit", "You can submit up to 5 agents.")),
            );
        }

        yield* this.validateSkillsEffect(snapshot.skills);
        const versionId = crypto.randomUUID();
        const now = Date.now();
        let avatarKey: string | null = null;
        const avatar = input.avatar;
        if (avatar) {
          if (!isValidAvatarImage(avatar.mimeType, avatar.bytes))
            return yield* Effect.fail(
              marketplaceError(
                new AgentMarketplaceError(400, "invalid_avatar", "Choose a valid PNG, JPEG, or WebP avatar."),
              ),
            );
          avatarKey = `agents/${agentId}/versions/${versionId}.avatar`;
          const key = avatarKey;
          yield* marketplaceCall(() =>
            bindings.SKILLS.put(key, avatar.bytes, {
              httpMetadata: { contentType: avatar.mimeType },
            }),
          );
        }
        const operationResult = yield* Effect.gen({ self: this }, function* () {
          if (!input.agentId) {
            yield* marketplaceCall(() =>
              bindings.DB.prepare(
                "INSERT INTO marketplace_agents(id, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?)",
              )
                .bind(agentId, input.user.id, now, now)
                .run(),
            );
          }
          yield* marketplaceCall(() =>
            bindings.DB.prepare(
              `INSERT INTO marketplace_agent_versions(
           id, agent_id, version, name, title, description, avatar_seed, avatar_hue, avatar_key,
           skills_json, routines_json, status, created_at, category
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
            )
              .bind(
                versionId,
                agentId,
                version,
                snapshot.name,
                snapshot.title,
                snapshot.description,
                snapshot.avatarSeed,
                snapshot.avatarHue,
                avatarKey,
                JSON.stringify(snapshot.skills),
                JSON.stringify(snapshot.routines),
                now,
                input.category ?? "other",
              )
              .run(),
          );
          if (input.showCreatorAvatar !== undefined)
            yield* this.setCreatorAvatar(input.user.id, agentId, input.showCreatorAvatar);
          yield* marketplaceCall(() =>
            bindings.DB.prepare("UPDATE marketplace_agents SET updated_at = ? WHERE id = ?").bind(now, agentId).run(),
          );
        }).pipe(Effect.result);
        if (Result.isFailure(operationResult)) {
          const error = operationResult.failure;
          if (avatarKey) yield* marketplaceCall(() => bindings.SKILLS.delete(avatarKey));
          if (!input.agentId)
            yield* marketplaceCall(() =>
              bindings.DB.prepare("DELETE FROM marketplace_agents WHERE id = ? AND approved_version_id IS NULL")
                .bind(agentId)
                .run(),
            );
          return yield* Effect.fail(marketplaceError(error));
        }
        const row = yield* this.versionRowEffect(versionId);
        if (!row)
          return yield* Effect.fail(
            marketplaceError(
              new AgentMarketplaceError(500, "submission_failed", "The agent submission could not be read."),
            ),
          );
        return yield* marketplaceDecode(() => submission(row));
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  avatar(agentId: string) {
    return Effect.fn("AgentMarketplace.avatar")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        const row = yield* this.approvedRowEffect(agentId);
        if (!row?.avatar_key)
          return yield* Effect.fail(
            marketplaceError(new AgentMarketplaceError(404, "avatar_not_found", "The avatar was not found.")),
          );
        const key = row.avatar_key;
        const object = yield* marketplaceCall(() => bindings.SKILLS.get(key));
        if (!object)
          return yield* Effect.fail(
            marketplaceError(new AgentMarketplaceError(404, "avatar_not_found", "The avatar was not found.")),
          );
        return object;
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  recordInstall(agentId: string, userId: string, receiptId: string) {
    return Effect.fn("AgentMarketplace.recordInstall")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        if (!(yield* this.approvedRowEffect(agentId)))
          return yield* Effect.fail(
            marketplaceError(new AgentMarketplaceError(404, "agent_not_found", "The agent was not found.")),
          );
        const result = yield* marketplaceCall(() =>
          bindings.DB.prepare(
            "INSERT OR IGNORE INTO marketplace_agent_install_receipts(receipt_id, agent_id, user_id, created_at) VALUES (?, ?, ?, ?)",
          )
            .bind(receiptId, agentId, userId, Date.now())
            .run(),
        );
        if (result.meta.changes === 1)
          yield* marketplaceCall(() =>
            bindings.DB.prepare("UPDATE marketplace_agents SET installs = installs + 1 WHERE id = ?")
              .bind(agentId)
              .run(),
          );
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  listPending() {
    return Effect.fn("AgentMarketplace.listPending")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        const result = yield* marketplaceCall(() =>
          bindings.DB.prepare(
            `SELECT versions.id, versions.agent_id, versions.version, versions.name, versions.title, versions.description,
              versions.avatar_seed, versions.avatar_hue, versions.avatar_key, versions.skills_json,
              versions.routines_json, versions.status, versions.rejection_note, versions.created_at,
              agents.installs, agents.featured, agents.updated_at, versions.category, agents.show_creator_avatar, users.avatar_url AS creator_avatar_url, users.name AS creator_name, users.email AS creator_email
       FROM marketplace_agent_versions versions JOIN marketplace_agents agents ON agents.id = versions.agent_id
       JOIN users ON users.id = agents.owner_user_id WHERE versions.status = 'pending' ORDER BY versions.created_at`,
          ).all<AgentRow>(),
        );
        return yield* marketplaceDecode(() => (result.results ?? []).map(submission));
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  review(versionId: string, status: "approved" | "rejected", note: string | null) {
    return Effect.fn("AgentMarketplace.review")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        const row = yield* marketplaceCall(() =>
          bindings.DB.prepare("SELECT agent_id, status FROM marketplace_agent_versions WHERE id = ?")
            .bind(versionId)
            .first<{ agent_id: string; status: string }>(),
        );
        if (!row)
          return yield* Effect.fail(
            marketplaceError(new AgentMarketplaceError(404, "submission_not_found", "The submission was not found.")),
          );
        if (row.status !== "pending")
          return yield* Effect.fail(
            marketplaceError(
              new AgentMarketplaceError(409, "already_reviewed", "The submission was already reviewed."),
            ),
          );
        const now = Date.now();
        // The status guard and RETURNING make a second, concurrent review lose instead of overwriting.
        const reviewed = yield* marketplaceCall(() =>
          bindings.DB.prepare(
            "UPDATE marketplace_agent_versions SET status = ?, rejection_note = ?, reviewed_at = ? WHERE id = ? AND status = 'pending' RETURNING id",
          )
            .bind(status, status === "rejected" ? note : null, now, versionId)
            .first<{ id: string }>(),
        );
        if (!reviewed)
          return yield* Effect.fail(
            marketplaceError(
              new AgentMarketplaceError(409, "already_reviewed", "The submission was already reviewed."),
            ),
          );
        if (status === "approved")
          yield* marketplaceCall(() =>
            bindings.DB.prepare("UPDATE marketplace_agents SET approved_version_id = ?, updated_at = ? WHERE id = ?")
              .bind(versionId, now, row.agent_id)
              .run(),
          );
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  setFeatured(agentId: string, featured: boolean) {
    return Effect.fn("AgentMarketplace.setFeatured")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        const result = yield* marketplaceCall(() =>
          bindings.DB.prepare(
            "UPDATE marketplace_agents SET featured = ?, updated_at = ? WHERE id = ? AND approved_version_id IS NOT NULL",
          )
            .bind(featured ? 1 : 0, Date.now(), agentId)
            .run(),
        );
        if (result.meta.changes !== 1)
          return yield* Effect.fail(
            marketplaceError(new AgentMarketplaceError(404, "agent_not_found", "The agent was not found.")),
          );
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  private validateSkillsEffect(
    skills: MarketplaceAgentSkill[],
  ): Effect.Effect<void, AgentMarketplaceError | AgentMarketplaceStorageError, MarketplaceStorage> {
    return Effect.fn("AgentMarketplace.validateSkills")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        for (const skill of skills) {
          const row = yield* marketplaceCall(() =>
            bindings.DB.prepare(
              `SELECT versions.id, versions.skill_id, versions.version, skills.slug, versions.name
         FROM marketplace_skill_versions versions JOIN marketplace_skills skills ON skills.id = versions.skill_id
         WHERE versions.id = ? AND versions.skill_id = ? AND versions.status = 'approved'`,
            )
              .bind(skill.versionId, skill.skillId)
              .first<{ id: string; skill_id: string; version: number; slug: string; name: string }>(),
          );
          if (!row || row.version !== skill.version || row.slug !== skill.slug || row.name !== skill.name)
            return yield* Effect.fail(
              marketplaceError(
                new AgentMarketplaceError(400, "invalid_skill", `The skill ${skill.name} is not an approved version.`),
              ),
            );
        }
      }),
    )();
  }

  private approvedRowEffect(agentId: string) {
    return Effect.fn("AgentMarketplace.approvedRow")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        return yield* marketplaceCall(() =>
          bindings.DB.prepare(
            `SELECT agents.id, agents.installs, agents.featured, agents.updated_at,
              versions.id AS version_id, versions.version, versions.name, versions.title, versions.description,
              versions.avatar_seed, versions.avatar_hue, versions.avatar_key, versions.skills_json,
              versions.routines_json, versions.category, agents.show_creator_avatar, users.avatar_url AS creator_avatar_url, users.name AS creator_name, users.email AS creator_email
       FROM marketplace_agents agents JOIN marketplace_agent_versions versions ON versions.id = agents.approved_version_id
       JOIN users ON users.id = agents.owner_user_id WHERE agents.id = ?`,
          )
            .bind(agentId)
            .first<AgentRow>(),
        );
      }),
    )();
  }

  private versionRowEffect(versionId: string) {
    return Effect.fn("AgentMarketplace.versionRow")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        return yield* marketplaceCall(() =>
          bindings.DB.prepare(
            `SELECT versions.id, versions.agent_id, versions.version, versions.name, versions.title, versions.description,
              versions.avatar_seed, versions.avatar_hue, versions.avatar_key, versions.skills_json,
              versions.routines_json, versions.status, versions.rejection_note, versions.created_at,
              agents.installs, agents.featured, agents.updated_at, versions.category, agents.show_creator_avatar, users.avatar_url AS creator_avatar_url, users.name AS creator_name, users.email AS creator_email
       FROM marketplace_agent_versions versions JOIN marketplace_agents agents ON agents.id = versions.agent_id
       JOIN users ON users.id = agents.owner_user_id WHERE versions.id = ?`,
          )
            .bind(versionId)
            .first<AgentRow>(),
        );
      }),
    )();
  }
}

function validateSnapshot(value: unknown): AgentPublicationPreview {
  if (!isDynamicRecord(value)) throw new AgentMarketplaceError(400, "invalid_agent", "Invalid agent snapshot.");
  // Desktop builds before the bot-to-agent rename send `botId`; newer ones send `agentId`. A Worker
  // deploy can land either side of a desktop release, so both spellings stay readable.
  const publishedAgentId = value.agentId ?? value.botId;
  const name = text(value.name, "name", INPUT_LIMITS.agentName, true);
  const title = text(value.title, "title", INPUT_LIMITS.agentTitle, false);
  const description = text(value.description, "description", INPUT_LIMITS.agentDescription, true);
  if (
    !isString(publishedAgentId) ||
    !isAvatarSeed(value.avatarSeed) ||
    (value.avatarHue !== null && !isAvatarHue(value.avatarHue))
  )
    throw new AgentMarketplaceError(400, "invalid_agent", "Invalid agent profile.");
  if (!Array.isArray(value.skills) || value.skills.length > INPUT_LIMITS.agents || !value.skills.every(isSkill))
    throw new AgentMarketplaceError(400, "invalid_agent", "Invalid agent skills.");
  if (
    !Array.isArray(value.routines) ||
    value.routines.length > INPUT_LIMITS.agentRoutines ||
    !value.routines.every(isRoutine)
  )
    throw new AgentMarketplaceError(400, "invalid_agent", "Invalid agent routines.");
  return {
    agentId: publishedAgentId,
    name,
    title,
    description,
    avatarSeed: value.avatarSeed,
    avatarHue: value.avatarHue,
    avatarUrl: null,
    skills: value.skills,
    routines: value.routines,
  };
}

function text(value: unknown, field: string, limit: number, required: boolean): string {
  if (!isString(value)) throw new AgentMarketplaceError(400, "invalid_agent", `Invalid agent ${field}.`);
  const result = value.trim();
  if ((required && !result) || result.length > limit)
    throw new AgentMarketplaceError(400, "invalid_agent", `Invalid agent ${field}.`);
  return result;
}

function isSkill(value: unknown): value is MarketplaceAgentSkill {
  return (
    isDynamicRecord(value) &&
    isString(value.skillId) &&
    isString(value.versionId) &&
    isString(value.slug) &&
    isString(value.name) &&
    isNumber(value.version)
  );
}

function isRoutine(value: unknown): value is MarketplaceAgentRoutine {
  return (
    isDynamicRecord(value) &&
    isString(value.name) &&
    value.name.trim().length > 0 &&
    value.name.length <= INPUT_LIMITS.routineName &&
    isString(value.instruction) &&
    value.instruction.trim().length > 0 &&
    value.instruction.length <= INPUT_LIMITS.routineInstruction &&
    isBoolean(value.active) &&
    isRoutineSchedule(value.schedule)
  );
}

function dependencies(row: AgentRow) {
  const skills = JSON.parse(row.skills_json);
  const routines = JSON.parse(row.routines_json);
  if (!Array.isArray(skills) || !skills.every(isSkill) || !Array.isArray(routines) || !routines.every(isRoutine))
    throw new AgentMarketplaceError(500, "invalid_snapshot", "The stored agent snapshot is invalid.");
  return { skills, routines };
}

function avatarUrl(row: AgentRow): string | null {
  const agentId = row.agent_id ?? row.id;
  const versionId = row.version_id ?? (row.agent_id ? row.id : undefined);
  return row.avatar_key ? `/v1/marketplace/agents/${agentId}/avatar${versionId ? `?v=${versionId}` : ""}` : null;
}

function publicSummary(row: AgentRow): MarketplaceAgentSummary {
  const { skills, routines } = dependencies(row);
  return {
    id: row.agent_id ?? row.id,
    name: row.name,
    title: row.title,
    description: row.description,
    creatorName: row.creator_name?.trim() || row.creator_email,
    category: isSkillCategory(row.category) ? row.category : "other",
    creatorAvatarUrl: row.show_creator_avatar === 1 ? row.creator_avatar_url : null,
    version: row.version,
    installs: row.installs,
    featured: row.featured === 1,
    avatarSeed: row.avatar_seed,
    avatarHue: row.avatar_hue !== null && isAvatarHue(row.avatar_hue) ? row.avatar_hue : null,
    avatarUrl: avatarUrl(row),
    skillCount: skills.length,
    routineCount: routines.length,
    activeRoutineCount: routines.filter((routine) => routine.active).length,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function publicDetail(row: AgentRow): MarketplaceAgentDetail {
  return { ...publicSummary(row), versionId: row.version_id ?? row.id, ...dependencies(row) };
}

/**
 * The submission body a deployed desktop reads spells the marketplace listing `agentId`; in-app that
 * name now means the local agent, so the contract calls it `listingId`. The wire keeps its spelling:
 * a Worker deploy can land either side of a desktop release.
 */
type AgentSubmissionWire = Omit<AgentSubmission, "listingId"> & { agentId: string };

function submission(row: AgentRow): AgentSubmissionWire {
  const { skills, routines } = dependencies(row);
  if (!isOneOf(["pending", "approved", "rejected"], row.status))
    throw new AgentMarketplaceError(500, "invalid_submission", "The stored agent submission is invalid.");
  return {
    id: row.id,
    agentId: row.agent_id ?? row.id,
    category: isSkillCategory(row.category) ? row.category : "other",
    showCreatorAvatar: row.show_creator_avatar === 1,
    name: row.name,
    title: row.title,
    description: row.description,
    version: row.version,
    status: row.status,
    rejectionNote: row.rejection_note ?? null,
    avatarSeed: row.avatar_seed,
    avatarHue: row.avatar_hue !== null && isAvatarHue(row.avatar_hue) ? row.avatar_hue : null,
    avatarUrl: avatarUrl(row),
    skillCount: skills.length,
    routineCount: routines.length,
    activeRoutineCount: routines.filter((routine) => routine.active).length,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

class AgentMarketplaceStorageError extends Schema.TaggedError<AgentMarketplaceStorageError>()(
  "AgentMarketplaceStorageError",
  { message: Schema.String },
) {}
const marketplaceError = (error: unknown): AgentMarketplaceError | AgentMarketplaceStorageError =>
  error instanceof AgentMarketplaceError
    ? error
    : new AgentMarketplaceStorageError({
        message: error instanceof Error ? error.message : "Marketplace operation failed.",
      });
const marketplaceCall = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({ try: operation, catch: marketplaceError });
const marketplaceDecode = <A>(operation: () => A) => Effect.try({ try: operation, catch: marketplaceError });
