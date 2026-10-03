import { createHash } from "node:crypto";
import { isSkillCategory, SKILL_DESCRIPTION_MAX_LENGTH, type SkillCategory } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect, Result, Schema } from "effect";
import { unzipSync } from "fflate";
import { parse as parseYaml } from "yaml";
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

const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 200;
const MAX_ICON_BYTES = 1024 * 1024;
const MAX_SKILLS_PER_USER = 5;
const MAX_VERSIONS_PER_SKILL = 5;
const FORBIDDEN_NAMES = new Set([".env", ".env.local", "id_rsa", "id_ed25519"]);
const NESTED_ARCHIVE = /\.(?:zip|tar|tgz|gz|7z|rar)$/iu;

interface ApprovedRow {
  creator_avatar_url: string | null;
  show_creator_avatar: number;
  id: string;
  slug: string;
  installs: number;
  featured: number;
  name: string;
  description: string;
  category: string;
  version: number;
  version_id: string;
  bundle_key: string;
  bundle_sha256: string;
  files_json: string;
  icon_key: string | null;
  updated_at: number;
  creator_name: string | null;
  creator_email: string;
}

interface SubmissionRow {
  show_creator_avatar?: number;
  id: string;
  skill_id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  version: number;
  status: "pending" | "approved" | "rejected";
  rejection_note: string | null;
  icon_key: string | null;
  created_at: number;
}

export interface SkillArchivePreview {
  name: string;
  description: string;
  slug: string;
  files: string[];
  instructions: string;
  examplePrompt?: string;
}

export class SkillMarketplace {
  constructor(private readonly bindings: Pick<WorkerBindings, "DB" | "SKILLS">) {}

  list(input: {
    query?: string;
    category?: string;
    featured?: boolean;
    sort?: "installs";
    cursor?: string;
    limit?: number;
  }) {
    return Effect.fn("SkillMarketplace.list")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        const clauses = ["skills.approved_version_id = versions.id"];
        const values: unknown[] = [];
        const queryInput = normalizeMarketplaceQuery(input.query);
        if (queryInput) {
          clauses.push(
            "(lower(versions.name) LIKE ? ESCAPE '\\' OR lower(versions.description) LIKE ? ESCAPE '\\' OR lower(coalesce(nullif(trim(users.name), ''), users.email)) LIKE ? ESCAPE '\\')",
          );
          const query = marketplaceLikePattern(queryInput);
          values.push(query, query, query);
        }
        if (input.category) {
          if (!isSkillCategory(input.category))
            return yield* Effect.fail(
              marketplaceError(new SkillMarketplaceError(400, "invalid_category", "Unknown skill category.")),
            );
          clauses.push("versions.category = ?");
          values.push(input.category);
        }
        if (input.featured) clauses.push("skills.featured = 1");
        const limit = normalizeMarketplaceLimit(input.limit);
        const sort: MarketplaceSort = input.sort === "installs" ? "installs" : "updated";
        const cursor = decodeMarketplaceCursor(input.cursor, sort);
        // A v0 cursor holds only a timestamp. The order also leads with featured and ends with id, so a
        // timestamp cannot say where that page stopped. It adds no clause. The first page comes again
        // and its v1 cursor then pages the rest, which costs one request and loses no skill.
        if (cursor && !("legacyUpdatedAt" in cursor)) {
          const primary = sort === "installs" ? "skills.installs" : "skills.featured";
          clauses.push(
            `(${primary} < ? OR (${primary} = ? AND (skills.updated_at < ? OR (skills.updated_at = ? AND skills.id < ?))))`,
          );
          values.push(cursor.primary, cursor.primary, cursor.updatedAt, cursor.updatedAt, cursor.id);
        }
        const orderBy =
          sort === "installs"
            ? "skills.installs DESC, skills.updated_at DESC, skills.id DESC"
            : "skills.featured DESC, skills.updated_at DESC, skills.id DESC";
        values.push(limit + 1);
        const result = yield* marketplaceCall(() =>
          bindings.DB.prepare(
            `SELECT skills.id, skills.slug, skills.installs, skills.featured, skills.updated_at,
              versions.id AS version_id, versions.name, versions.description, versions.category,
              versions.version, versions.bundle_sha256, versions.files_json, versions.icon_key,
              skills.show_creator_avatar, users.avatar_url AS creator_avatar_url, users.name AS creator_name, users.email AS creator_email
       FROM marketplace_skills skills
       JOIN marketplace_skill_versions versions ON ${clauses.join(" AND ")}
       JOIN users ON users.id = skills.owner_user_id
       ORDER BY ${orderBy}
       LIMIT ?`,
          )
            .bind(...values)
            .all<ApprovedRow>(),
        );
        const rows = result.results;
        const page = rows.slice(0, limit);
        const last = page.at(-1);
        return {
          skills: yield* marketplaceDecode(() => page.map(publicSummary)),
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

  get(skillId: string) {
    return Effect.fn("SkillMarketplace.get")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        const row = yield* this.approvedRowEffect(skillId);
        if (!row)
          return yield* Effect.fail(
            marketplaceError(new SkillMarketplaceError(404, "skill_not_found", "The skill was not found.")),
          );
        const object = yield* marketplaceCall(() => bindings.SKILLS.get(row.bundle_key));
        if (!object)
          return yield* Effect.fail(
            marketplaceError(new SkillMarketplaceError(404, "bundle_not_found", "The skill bundle is unavailable.")),
          );
        const archiveBytes = yield* marketplaceCall(() => object.arrayBuffer());
        const preview = yield* marketplaceDecode(() => inspectSkillArchive(new Uint8Array(archiveBytes)));
        return {
          ...(yield* marketplaceDecode(() => publicSummary(row))),
          versionId: row.version_id,
          bundleSha256: row.bundle_sha256,
          files: yield* marketplaceDecode(() => parseFiles(row.files_json)),
          instructions: preview.instructions,
          ...(preview.examplePrompt ? { examplePrompt: preview.examplePrompt } : {}),
        };
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  getVersion(skillId: string, versionId: string) {
    return Effect.fn("SkillMarketplace.getVersion")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        const row = yield* this.approvedVersionRowEffect(skillId, versionId);
        if (!row)
          return yield* Effect.fail(
            marketplaceError(
              new SkillMarketplaceError(404, "skill_version_not_found", "The approved skill version was not found."),
            ),
          );
        const object = yield* marketplaceCall(() => bindings.SKILLS.get(row.bundle_key));
        if (!object)
          return yield* Effect.fail(
            marketplaceError(new SkillMarketplaceError(404, "bundle_not_found", "The skill bundle is unavailable.")),
          );
        const archiveBytes = yield* marketplaceCall(() => object.arrayBuffer());
        const preview = yield* marketplaceDecode(() => inspectSkillArchive(new Uint8Array(archiveBytes)));
        return {
          ...(yield* marketplaceDecode(() => publicSummary(row))),
          versionId: row.version_id,
          bundleSha256: row.bundle_sha256,
          files: yield* marketplaceDecode(() => parseFiles(row.files_json)),
          instructions: preview.instructions,
          ...(preview.examplePrompt ? { examplePrompt: preview.examplePrompt } : {}),
        };
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  setCreatorAvatar(userId: string, listingId: string, show: boolean) {
    return Effect.fn("SkillMarketplace.setCreatorAvatar")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        const result = yield* marketplaceCall(() =>
          bindings.DB.prepare(
            "UPDATE marketplace_skills SET show_creator_avatar = ? WHERE id = ? AND owner_user_id = ?",
          )
            .bind(show ? 1 : 0, listingId, userId)
            .run(),
        );
        if (!result.meta.changes)
          return yield* Effect.fail(
            marketplaceError(new SkillMarketplaceError(404, "skill_not_found", "The owned skill was not found.")),
          );
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  mine(userId: string) {
    return Effect.fn("SkillMarketplace.mine")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        const result = yield* marketplaceCall(() =>
          bindings.DB.prepare(
            `SELECT versions.id, versions.skill_id, skills.slug, versions.name, versions.description,
              versions.category, versions.version, versions.status, versions.rejection_note,
              versions.icon_key, versions.created_at, skills.show_creator_avatar
       FROM marketplace_skill_versions versions
       JOIN marketplace_skills skills ON skills.id = versions.skill_id
       WHERE skills.owner_user_id = ?
       ORDER BY versions.created_at DESC`,
          )
            .bind(userId)
            .all<SubmissionRow>(),
        );
        return yield* marketplaceDecode(() => result.results.map(submission));
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  submit(input: {
    user: AuthUser;
    archive: Uint8Array;
    category: SkillCategory;
    icon: { bytes: Uint8Array; mimeType: string } | null;
    skillId?: string;
    showCreatorAvatar?: boolean;
  }) {
    return Effect.fn("SkillMarketplace.submit")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        if (!isSkillCategory(input.category))
          return yield* Effect.fail(
            marketplaceError(new SkillMarketplaceError(400, "invalid_category", "Unknown skill category.")),
          );
        const recent = yield* marketplaceCall(() =>
          bindings.DB.prepare(
            `SELECT count(*) AS count
       FROM marketplace_skill_versions versions
       JOIN marketplace_skills skills ON skills.id = versions.skill_id
       WHERE skills.owner_user_id = ? AND versions.created_at >= ?`,
          )
            .bind(input.user.id, Date.now() - 24 * 60 * 60 * 1000)
            .first<{ count: number }>(),
        );
        if ((recent?.count ?? 0) >= 10) {
          return yield* Effect.fail(
            marketplaceError(
              new SkillMarketplaceError(429, "submission_limit", "You can submit up to 10 skill versions per day."),
            ),
          );
        }
        const preview = yield* marketplaceDecode(() => inspectSkillArchive(input.archive));
        const now = Date.now();
        const skillId = input.skillId ?? crypto.randomUUID();
        let version = 1;
        if (input.skillId) {
          const owned = yield* marketplaceCall(() =>
            bindings.DB.prepare("SELECT id FROM marketplace_skills WHERE id = ? AND owner_user_id = ?")
              .bind(input.skillId, input.user.id)
              .first<{ id: string }>(),
          );
          if (!owned)
            return yield* Effect.fail(
              marketplaceError(new SkillMarketplaceError(404, "skill_not_found", "The owned skill was not found.")),
            );
          const latest = yield* marketplaceCall(() =>
            bindings.DB.prepare("SELECT max(version) AS version FROM marketplace_skill_versions WHERE skill_id = ?")
              .bind(skillId)
              .first<{ version: number | null }>(),
          );
          yield* marketplaceDecode(() => enforceSubmissionLimits({ versionCount: latest?.version ?? 0 }));
          version = (latest?.version ?? 0) + 1;
        } else {
          const owned = yield* marketplaceCall(() =>
            bindings.DB.prepare("SELECT count(*) AS count FROM marketplace_skills WHERE owner_user_id = ?")
              .bind(input.user.id)
              .first<{ count: number }>(),
          );
          yield* marketplaceDecode(() => enforceSubmissionLimits({ skillCount: owned?.count ?? 0 }));
          const duplicate = yield* marketplaceCall(() =>
            bindings.DB.prepare("SELECT id FROM marketplace_skills WHERE slug = ?").bind(preview.slug).first(),
          );
          if (duplicate)
            return yield* Effect.fail(
              marketplaceError(new SkillMarketplaceError(409, "slug_taken", "A skill with this name already exists.")),
            );
        }
        const versionId = crypto.randomUUID();
        const bundleKey = `skills/${skillId}/versions/${versionId}.zip`;
        const iconKey = input.icon ? `skills/${skillId}/versions/${versionId}.icon` : null;
        if (
          input.icon &&
          (input.icon.bytes.byteLength > MAX_ICON_BYTES ||
            !["image/png", "image/jpeg", "image/webp"].includes(input.icon.mimeType))
        ) {
          return yield* Effect.fail(
            marketplaceError(
              new SkillMarketplaceError(400, "invalid_icon", "The icon must be a PNG, JPEG, or WebP image under 1 MB."),
            ),
          );
        }
        yield* marketplaceCall(() =>
          bindings.SKILLS.put(bundleKey, input.archive, { httpMetadata: { contentType: "application/zip" } }),
        );
        const icon = input.icon;
        if (icon && iconKey) {
          yield* marketplaceCall(() =>
            bindings.SKILLS.put(iconKey, icon.bytes, { httpMetadata: { contentType: icon.mimeType } }),
          );
        }
        const operationResult = yield* Effect.gen({ self: this }, function* () {
          if (!input.skillId) {
            yield* marketplaceCall(() =>
              bindings.DB.prepare(
                `INSERT INTO marketplace_skills(id, slug, owner_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
              )
                .bind(skillId, preview.slug, input.user.id, now, now)
                .run(),
            );
          }
          yield* marketplaceCall(() =>
            bindings.DB.prepare(
              `INSERT INTO marketplace_skill_versions(
          id, skill_id, version, name, description, category, status, bundle_key,
          bundle_sha256, files_json, icon_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
            )
              .bind(
                versionId,
                skillId,
                version,
                preview.name,
                preview.description,
                input.category,
                bundleKey,
                sha256(input.archive),
                JSON.stringify(preview.files),
                iconKey,
                now,
              )
              .run(),
          );
          if (input.showCreatorAvatar !== undefined)
            yield* this.setCreatorAvatar(input.user.id, skillId, input.showCreatorAvatar);
          yield* marketplaceCall(() =>
            bindings.DB.prepare("UPDATE marketplace_skills SET updated_at = ? WHERE id = ?").bind(now, skillId).run(),
          );
        }).pipe(Effect.result);
        if (Result.isFailure(operationResult)) {
          const error = operationResult.failure;
          yield* marketplaceCall(() =>
            Promise.allSettled([
              bindings.SKILLS.delete(bundleKey),
              ...(iconKey ? [bindings.SKILLS.delete(iconKey)] : []),
            ]),
          );
          if (!input.skillId) {
            yield* marketplaceCall(() =>
              bindings.DB.prepare("DELETE FROM marketplace_skills WHERE id = ? AND approved_version_id IS NULL")
                .bind(skillId)
                .run(),
            );
          }
          return yield* Effect.fail(marketplaceError(error));
        }
        const submitted: SubmissionRow = {
          id: versionId,
          skill_id: skillId,
          slug: preview.slug,
          name: preview.name,
          description: preview.description,
          category: input.category,
          version,
          status: "pending",
          rejection_note: null,
          icon_key: iconKey,
          created_at: now,
          show_creator_avatar:
            input.showCreatorAvatar === undefined
              ? ((yield* marketplaceCall(() =>
                  bindings.DB.prepare("SELECT show_creator_avatar FROM marketplace_skills WHERE id = ?")
                    .bind(skillId)
                    .first<{ show_creator_avatar: number }>(),
                ))?.show_creator_avatar ?? 0)
              : Number(input.showCreatorAvatar),
        };
        return yield* marketplaceDecode(() => submission(submitted));
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  content(skillId: string) {
    return Effect.fn("SkillMarketplace.content")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        const row = yield* this.approvedRowEffect(skillId);
        if (!row)
          return yield* Effect.fail(
            marketplaceError(new SkillMarketplaceError(404, "skill_not_found", "The skill was not found.")),
          );
        const version = yield* marketplaceCall(() =>
          bindings.DB.prepare("SELECT bundle_key FROM marketplace_skill_versions WHERE id = ?")
            .bind(row.version_id)
            .first<{ bundle_key: string }>(),
        );
        const object = version ? yield* marketplaceCall(() => bindings.SKILLS.get(version.bundle_key)) : null;
        if (!object)
          return yield* Effect.fail(
            marketplaceError(new SkillMarketplaceError(404, "bundle_not_found", "The skill bundle is unavailable.")),
          );
        return object;
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  versionContent(skillId: string, versionId: string) {
    return Effect.fn("SkillMarketplace.versionContent")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        const row = yield* this.approvedVersionRowEffect(skillId, versionId);
        if (!row)
          return yield* Effect.fail(
            marketplaceError(
              new SkillMarketplaceError(404, "skill_version_not_found", "The approved skill version was not found."),
            ),
          );
        const object = yield* marketplaceCall(() => bindings.SKILLS.get(row.bundle_key));
        if (!object)
          return yield* Effect.fail(
            marketplaceError(new SkillMarketplaceError(404, "bundle_not_found", "The skill bundle is unavailable.")),
          );
        return object;
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  icon(skillId: string) {
    return Effect.fn("SkillMarketplace.icon")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        const row = yield* this.approvedRowEffect(skillId);
        if (!row?.icon_key) return null;
        return bindings.SKILLS.get(row.icon_key);
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  recordInstall(skillId: string, userId: string, receiptId: string) {
    return Effect.fn("SkillMarketplace.recordInstall")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        const row = yield* this.approvedRowEffect(skillId);
        if (!row)
          return yield* Effect.fail(
            marketplaceError(new SkillMarketplaceError(404, "skill_not_found", "The skill was not found.")),
          );
        const inserted = yield* marketplaceCall(() =>
          bindings.DB.prepare(
            "INSERT OR IGNORE INTO marketplace_skill_install_receipts(receipt_id, skill_id, user_id, created_at) VALUES (?, ?, ?, ?)",
          )
            .bind(receiptId, skillId, userId, Date.now())
            .run(),
        );
        if (inserted.meta.changes === 1) {
          yield* marketplaceCall(() =>
            bindings.DB.prepare("UPDATE marketplace_skills SET installs = installs + 1 WHERE id = ?")
              .bind(skillId)
              .run(),
          );
        }
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  review(versionId: string, action: "approve" | "reject", rejectionNote?: string) {
    return Effect.fn("SkillMarketplace.review")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        const now = Date.now();
        const row = yield* marketplaceCall(() =>
          bindings.DB.prepare("SELECT skill_id, status FROM marketplace_skill_versions WHERE id = ?")
            .bind(versionId)
            .first<{ skill_id: string; status: string }>(),
        );
        if (!row)
          return yield* Effect.fail(
            marketplaceError(new SkillMarketplaceError(404, "submission_not_found", "The submission was not found.")),
          );
        if (row.status !== "pending")
          return yield* Effect.fail(
            marketplaceError(
              new SkillMarketplaceError(409, "already_reviewed", "The submission was already reviewed."),
            ),
          );
        if (action === "reject" && !rejectionNote?.trim()) {
          return yield* Effect.fail(
            marketplaceError(
              new SkillMarketplaceError(400, "rejection_note_required", "A rejection note is required."),
            ),
          );
        }
        // The status guard and RETURNING make a second, concurrent review lose instead of overwriting.
        const reviewed = yield* marketplaceCall(() =>
          bindings.DB.prepare(
            "UPDATE marketplace_skill_versions SET status = ?, rejection_note = ?, reviewed_at = ? WHERE id = ? AND status = 'pending' RETURNING id",
          )
            .bind(
              action === "approve" ? "approved" : "rejected",
              action === "reject" ? rejectionNote?.trim() : null,
              now,
              versionId,
            )
            .first<{ id: string }>(),
        );
        if (!reviewed)
          return yield* Effect.fail(
            marketplaceError(
              new SkillMarketplaceError(409, "already_reviewed", "The submission was already reviewed."),
            ),
          );
        if (action === "approve") {
          yield* marketplaceCall(() =>
            bindings.DB.prepare("UPDATE marketplace_skills SET approved_version_id = ?, updated_at = ? WHERE id = ?")
              .bind(versionId, now, row.skill_id)
              .run(),
          );
        }
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  pending() {
    return Effect.fn("SkillMarketplace.pending")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        const result = yield* marketplaceCall(() =>
          bindings.DB.prepare(
            `SELECT versions.id, versions.skill_id, skills.slug, versions.name, versions.description,
              versions.category, versions.version, versions.status, versions.rejection_note,
              versions.icon_key, versions.created_at, skills.show_creator_avatar
       FROM marketplace_skill_versions versions JOIN marketplace_skills skills ON skills.id = versions.skill_id
       WHERE versions.status = 'pending' ORDER BY versions.created_at`,
          ).all<SubmissionRow>(),
        );
        return yield* marketplaceDecode(() => result.results.map(submission));
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  setFeatured(skillId: string, featured: boolean) {
    return Effect.fn("SkillMarketplace.setFeatured")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        const result = yield* marketplaceCall(() =>
          bindings.DB.prepare(
            "UPDATE marketplace_skills SET featured = ?, updated_at = ? WHERE id = ? AND approved_version_id IS NOT NULL",
          )
            .bind(featured ? 1 : 0, Date.now(), skillId)
            .run(),
        );
        if (result.meta.changes !== 1)
          return yield* Effect.fail(
            marketplaceError(new SkillMarketplaceError(404, "skill_not_found", "The skill was not found.")),
          );
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  private approvedRowEffect(
    skillId: string,
  ): Effect.Effect<ApprovedRow | null, SkillMarketplaceError | SkillMarketplaceStorageError, MarketplaceStorage> {
    return Effect.fn("SkillMarketplace.approvedRow")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        return yield* marketplaceCall(() =>
          bindings.DB.prepare(
            `SELECT skills.id, skills.slug, skills.installs, skills.featured, skills.updated_at,
              versions.id AS version_id, versions.name, versions.description, versions.category,
              versions.version, versions.bundle_key, versions.bundle_sha256, versions.files_json, versions.icon_key,
              skills.show_creator_avatar, users.avatar_url AS creator_avatar_url, users.name AS creator_name, users.email AS creator_email
       FROM marketplace_skills skills
       JOIN marketplace_skill_versions versions ON versions.id = skills.approved_version_id
       JOIN users ON users.id = skills.owner_user_id
       WHERE skills.id = ?`,
          )
            .bind(skillId)
            .first<ApprovedRow>(),
        );
      }),
    )();
  }

  private approvedVersionRowEffect(
    skillId: string,
    versionId: string,
  ): Effect.Effect<ApprovedRow | null, SkillMarketplaceError | SkillMarketplaceStorageError, MarketplaceStorage> {
    return Effect.fn("SkillMarketplace.approvedVersionRow")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        return yield* marketplaceCall(() =>
          bindings.DB.prepare(
            `SELECT skills.id, skills.slug, skills.installs, skills.featured, skills.updated_at,
              versions.name, versions.description, versions.category, versions.version,
              versions.id AS version_id, versions.bundle_key, versions.bundle_sha256,
              versions.files_json, versions.icon_key, skills.show_creator_avatar, users.avatar_url AS creator_avatar_url, users.name AS creator_name, users.email AS creator_email
       FROM marketplace_skills skills
       JOIN marketplace_skill_versions versions ON versions.skill_id = skills.id
       JOIN users ON users.id = skills.owner_user_id
       WHERE skills.id = ? AND versions.id = ? AND versions.status = 'approved'`,
          )
            .bind(skillId, versionId)
            .first<ApprovedRow>(),
        );
      }),
    )();
  }
}

export class SkillMarketplaceError extends Schema.TaggedError<SkillMarketplaceError>()("SkillMarketplaceError", {
  status: Schema.Number,
  code: Schema.String,
  message: Schema.String,
}) {
  constructor(status: number, code: string, message: string) {
    super({ status, code, message });
  }
}

export function enforceSubmissionLimits(input: { skillCount?: number; versionCount?: number }): void {
  if ((input.skillCount ?? 0) >= MAX_SKILLS_PER_USER) {
    throw new SkillMarketplaceError(409, "skill_limit", `You can submit up to ${MAX_SKILLS_PER_USER} skills.`);
  }
  if ((input.versionCount ?? 0) >= MAX_VERSIONS_PER_SKILL) {
    throw new SkillMarketplaceError(
      409,
      "skill_version_limit",
      `Each skill can have up to ${MAX_VERSIONS_PER_SKILL} submitted versions.`,
    );
  }
}

export function inspectSkillArchive(bytes: Uint8Array): SkillArchivePreview {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new SkillMarketplaceError(413, "bundle_too_large", "The skill bundle must be under 10 MB.");
  }
  let entries: Record<string, Uint8Array>;
  let expandedSize = 0;
  let fileCount = 0;
  let limitsExceeded = false;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        fileCount += 1;
        expandedSize += file.originalSize;
        limitsExceeded = fileCount > MAX_FILES || expandedSize > MAX_ARCHIVE_BYTES;
        if (limitsExceeded) throw new Error("Archive limits exceeded.");
        return true;
      },
    });
  } catch {
    if (limitsExceeded)
      throw new SkillMarketplaceError(413, "bundle_too_large", "The expanded skill exceeds marketplace limits.");
    throw new SkillMarketplaceError(400, "invalid_archive", "The skill ZIP is invalid.");
  }
  const rawFiles = Object.entries(entries).filter(([name]) => !name.endsWith("/"));
  if (rawFiles.length === 0 || rawFiles.length > MAX_FILES) {
    throw new SkillMarketplaceError(400, "invalid_archive", `A skill must contain between 1 and ${MAX_FILES} files.`);
  }
  const root = commonWrapper(rawFiles.map(([name]) => name));
  const normalized = rawFiles.map(([name, data]) => [root ? name.slice(root.length + 1) : name, data] as const);
  let total = 0;
  for (const [name, data] of normalized) {
    total += data.byteLength;
    validateArchivePath(name);
    if (total > MAX_ARCHIVE_BYTES)
      throw new SkillMarketplaceError(413, "bundle_too_large", "The expanded skill must be under 10 MB.");
  }
  const skillFile = normalized.find(([name]) => name === "SKILL.md")?.[1];
  if (!skillFile)
    throw new SkillMarketplaceError(400, "skill_file_missing", "The bundle must contain SKILL.md at its root.");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(skillFile);
  const metadata = parseSkillMetadata(text);
  return { ...metadata, slug: slugify(metadata.name), files: normalized.map(([name]) => name).sort() };
}

function parseSkillMetadata(
  text: string,
): Pick<SkillArchivePreview, "name" | "description" | "instructions" | "examplePrompt"> {
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) throw new SkillMarketplaceError(400, "invalid_skill", "SKILL.md must begin with YAML frontmatter.");
  let value: unknown;
  try {
    value = parseYaml(match[1] ?? "");
  } catch {
    throw new SkillMarketplaceError(400, "invalid_skill", "SKILL.md frontmatter is invalid.");
  }
  if (!isDynamicRecord(value)) throw new SkillMarketplaceError(400, "invalid_skill", "SKILL.md metadata is invalid.");
  const name = isString(value.name) ? value.name.trim() : "";
  const description = isString(value.description) ? value.description.trim() : "";
  if (!name || name.length > 80 || !description || description.length > SKILL_DESCRIPTION_MAX_LENGTH) {
    throw new SkillMarketplaceError(
      400,
      "invalid_skill",
      "SKILL.md needs a name and description within marketplace limits.",
    );
  }
  const example = value["example-prompt"];
  const examplePrompt = isString(example) ? example.trim() : "";
  return {
    name,
    description,
    instructions: text.slice(match[0].length).trim(),
    ...(examplePrompt && examplePrompt.length <= 1_000 ? { examplePrompt } : {}),
  };
}

function validateArchivePath(name: string): void {
  const normalized = name.replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (!name || normalized.startsWith("/") || parts.some((part) => !part || part === "." || part === "..")) {
    throw new SkillMarketplaceError(400, "unsafe_archive", "The skill contains an unsafe path.");
  }
  const basename = parts.at(-1)?.toLowerCase() ?? "";
  if (
    parts.includes(".git") ||
    parts.includes("node_modules") ||
    FORBIDDEN_NAMES.has(basename) ||
    NESTED_ARCHIVE.test(basename) ||
    /private.*key/iu.test(basename)
  ) {
    throw new SkillMarketplaceError(400, "unsafe_archive", `The skill contains a forbidden file: ${name}`);
  }
}

function commonWrapper(names: string[]): string | null {
  const roots = new Set(names.map((name) => name.replaceAll("\\", "/").split("/")[0]));
  return roots.size === 1 && names.every((name) => name.includes("/")) ? ([...roots][0] ?? null) : null;
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 64);
  if (!slug) throw new SkillMarketplaceError(400, "invalid_skill", "The skill name cannot form a valid slug.");
  return slug;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function parseFiles(value: string): string[] {
  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [];
}
function iconUrl(row: {
  id?: string;
  skill_id?: string;
  version_id?: string;
  status?: string;
  icon_key: string | null;
}): string | null {
  if (!row.icon_key) return null;
  const skillId = row.skill_id ?? row.id;
  const versionId = row.version_id ?? (row.skill_id ? row.id : undefined);
  const cacheKey = row.status ? `${versionId}-${row.status}` : versionId;
  return `/v1/skills/${skillId}/icon${cacheKey ? `?v=${encodeURIComponent(cacheKey)}` : ""}`;
}
function publicSummary(row: ApprovedRow) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    creatorName: row.creator_name?.trim() || row.creator_email,
    creatorAvatarUrl: row.show_creator_avatar === 1 ? row.creator_avatar_url : null,
    version: row.version,
    installs: row.installs,
    featured: row.featured === 1,
    iconUrl: iconUrl(row),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
function submission(row: SubmissionRow) {
  return {
    id: row.id,
    skillId: row.skill_id,
    showCreatorAvatar: row.show_creator_avatar === 1,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    version: row.version,
    status: row.status,
    rejectionNote: row.rejection_note,
    iconUrl: iconUrl(row),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

class SkillMarketplaceStorageError extends Schema.TaggedError<SkillMarketplaceStorageError>()(
  "SkillMarketplaceStorageError",
  { message: Schema.String },
) {}
const marketplaceError = (error: unknown): SkillMarketplaceError | SkillMarketplaceStorageError =>
  error instanceof SkillMarketplaceError
    ? error
    : new SkillMarketplaceStorageError({
        message: error instanceof Error ? error.message : "Marketplace operation failed.",
      });
const marketplaceCall = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({ try: operation, catch: marketplaceError });
const marketplaceDecode = <A>(operation: () => A) => Effect.try({ try: operation, catch: marketplaceError });
