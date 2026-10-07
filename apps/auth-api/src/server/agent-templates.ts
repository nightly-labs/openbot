import { isAgentTemplateId } from "@openbot/contracts/agent-template-links";
import { isValidAvatarImage } from "@openbot/contracts/avatar-images";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentTemplateSnapshot,
  isAgentTemplateCardPng,
  isAgentTemplateSnapshot,
  toAgentTemplateSnapshot,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result, Schema } from "effect";
import { AgentMarketplaceError } from "./agent-marketplace";
import { encodeBase64Url } from "./crypto";
import { MarketplaceStorage } from "./marketplace-storage";
import type { AuthUser, WorkerBindings } from "./types";

/**
 * Published templates for one account. Unpublished rows do not count. The Worker enforces it in the
 * statement that writes the row, so no client, and no two requests at once, can pass it.
 */
const MAX_TEMPLATES_PER_USER = 5;
const TEMPLATE_LIMIT_MESSAGE = `You can publish up to ${MAX_TEMPLATES_PER_USER} agents. Unpublish one to publish another.`;

interface TemplateRow {
  id: string;
  source_agent_id: string;
  snapshot_json: string;
  avatar_key: string | null;
  card_key: string | null;
  updated_at: number;
  creator_name: string | null;
}

/**
 * Link-only agent templates. Unlike the marketplace there is no review and no listing: a template is
 * public to whoever has its id, and its owner can replace or delete it at any time. The creator is
 * shown by account name only; the account email is never public here.
 */
export class AgentTemplates {
  constructor(private readonly bindings: Pick<WorkerBindings, "DB" | "SKILLS">) {}

  publish(input: {
    user: AuthUser;
    sourceAgentId: unknown;
    snapshot: unknown;
    avatar: { bytes: Uint8Array; mimeType: string } | null;
    /** The share card for link previews: a PNG of `AGENT_TEMPLATE_CARD` size. */
    card?: Uint8Array | null;
  }) {
    return Effect.fn("AgentTemplates.publish")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        const sourceAgentId = input.sourceAgentId;
        if (
          typeof sourceAgentId !== "string" ||
          !sourceAgentId.trim() ||
          sourceAgentId.length > INPUT_LIMITS.identifier
        )
          return yield* Effect.fail(
            marketplaceError(new AgentMarketplaceError(400, "invalid_template", "Invalid source agent.")),
          );
        if (!isAgentTemplateSnapshot(input.snapshot))
          return yield* Effect.fail(
            marketplaceError(new AgentMarketplaceError(400, "invalid_template", "Invalid agent template.")),
          );
        const snapshot = toAgentTemplateSnapshot(input.snapshot);
        yield* this.validateSkillsEffect(snapshot);
        const avatar = input.avatar;
        if (avatar && !isValidAvatarImage(avatar.mimeType, avatar.bytes))
          return yield* Effect.fail(
            marketplaceError(
              new AgentMarketplaceError(400, "invalid_avatar", "Choose a valid PNG, JPEG, or WebP avatar."),
            ),
          );
        const card = input.card ?? null;
        if (card && !isAgentTemplateCardPng(card))
          return yield* Effect.fail(
            marketplaceError(new AgentMarketplaceError(400, "invalid_card", "The share card must be a 1200×630 PNG.")),
          );

        // The row of an unpublished agent is found too: publishing it again gives it back the same id.
        const existing = yield* marketplaceCall(() =>
          bindings.DB.prepare(
            "SELECT id, unpublished_at FROM agent_templates WHERE owner_user_id = ? AND source_agent_id = ?",
          )
            .bind(input.user.id, sourceAgentId)
            .first<{ id: string; unpublished_at: number | null }>(),
        );
        if (!existing || existing.unpublished_at !== null) {
          const count = yield* marketplaceCall(() =>
            bindings.DB.prepare(
              "SELECT count(*) AS count FROM agent_templates WHERE owner_user_id = ? AND unpublished_at IS NULL",
            )
              .bind(input.user.id)
              .first<{ count: number }>(),
          );
          if ((count?.count ?? 0) >= MAX_TEMPLATES_PER_USER)
            return yield* Effect.fail(
              marketplaceError(new AgentMarketplaceError(409, "template_limit", TEMPLATE_LIMIT_MESSAGE)),
            );
        }

        const id = existing?.id ?? newTemplateId();
        const now = Date.now();
        let avatarKey: string | null = null;
        if (avatar) {
          avatarKey = `agent-templates/${id}/${crypto.randomUUID()}.avatar`;
          const key = avatarKey;
          yield* marketplaceCall(() =>
            bindings.SKILLS.put(key, avatar.bytes, {
              httpMetadata: { contentType: avatar.mimeType },
            }),
          );
        }
        let cardKey: string | null = null;
        if (card) {
          cardKey = `agent-templates/${id}/${crypto.randomUUID()}.card.png`;
          const key = cardKey;
          yield* marketplaceCall(() => bindings.SKILLS.put(key, card, { httpMetadata: { contentType: "image/png" } }));
        }
        // If this batch fails after it committed, the row names the new images, so a failure here does
        // not delete them: an unused image is better than a live template with a broken one.
        // One transaction reads the image keys the row has and writes the new row, so the keys this
        // publish replaces are the ones it deletes, even when two publishes of one agent run at once.
        // The upsert means two first publishes meet here, not in a constraint error. The limit is
        // checked in the same statement: the row is written only while the owner has fewer than the limit of
        // published agents, or when this agent is already one of them.
        const written = yield* marketplaceCall(() =>
          bindings.DB.batch([
            bindings.DB.prepare(
              "SELECT avatar_key, card_key FROM agent_templates WHERE owner_user_id = ? AND source_agent_id = ?",
            ).bind(input.user.id, sourceAgentId),
            bindings.DB.prepare(
              `INSERT INTO agent_templates(
           id, owner_user_id, source_agent_id, snapshot_json, avatar_key, card_key, unpublished_at, created_at, updated_at
         )
         SELECT ?, ?, ?, ?, ?, ?, NULL, ?, ?
         WHERE (SELECT count(*) FROM agent_templates WHERE owner_user_id = ? AND unpublished_at IS NULL) < ?
            OR EXISTS (
              SELECT 1 FROM agent_templates
              WHERE owner_user_id = ? AND source_agent_id = ? AND unpublished_at IS NULL
            )
         ON CONFLICT(owner_user_id, source_agent_id) DO UPDATE SET
           snapshot_json = excluded.snapshot_json,
           avatar_key = excluded.avatar_key,
           card_key = excluded.card_key,
           unpublished_at = NULL,
           updated_at = excluded.updated_at
         RETURNING id`,
            ).bind(
              id,
              input.user.id,
              sourceAgentId,
              JSON.stringify(snapshot),
              avatarKey,
              cardKey,
              now,
              now,
              input.user.id,
              MAX_TEMPLATES_PER_USER,
              input.user.id,
              sourceAgentId,
            ),
          ]),
        );
        const previous = yield* marketplaceDecode(() => storedImages(written[0]?.results?.[0]));
        const returned = written[1]?.results?.[0];
        if (!isDynamicRecord(returned) || typeof returned.id !== "string") {
          // Nothing was written: the limit stopped it, so the new images are not named by any row.
          yield* this.deleteImagesEffect([avatarKey, cardKey]);
          return yield* Effect.fail(
            marketplaceError(new AgentMarketplaceError(409, "template_limit", TEMPLATE_LIMIT_MESSAGE)),
          );
        }
        // The publish has succeeded; the old images are removed on a best-effort basis.
        yield* this.deleteImagesEffect([previous.avatarKey, previous.cardKey]);
        return { id: returned.id, sourceAgentId, updatedAt: new Date(now).toISOString() };
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  listMine(userId: string) {
    return Effect.fn("AgentTemplates.listMine")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        const result = yield* marketplaceCall(() =>
          bindings.DB.prepare(
            `SELECT id, source_agent_id, updated_at FROM agent_templates
       WHERE owner_user_id = ? AND unpublished_at IS NULL ORDER BY updated_at DESC`,
          )
            .bind(userId)
            .all<Pick<TemplateRow, "id" | "source_agent_id" | "updated_at">>(),
        );
        return yield* marketplaceDecode(() =>
          (result.results ?? []).map((row) => ({
            id: row.id,
            sourceAgentId: row.source_agent_id,
            updatedAt: new Date(row.updated_at).toISOString(),
          })),
        );
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  get(id: string) {
    return Effect.fn("AgentTemplates.get")(() =>
      Effect.gen({ self: this }, function* () {
        const row = yield* this.rowEffect(id);
        if (!row) return yield* Effect.fail(marketplaceError(notFound()));
        const snapshot = yield* marketplaceDecode(() => JSON.parse(row.snapshot_json));
        if (!isAgentTemplateSnapshot(snapshot))
          return yield* Effect.fail(
            marketplaceError(
              new AgentMarketplaceError(500, "invalid_template", "The stored agent template is invalid."),
            ),
          );
        return {
          ...toAgentTemplateSnapshot(snapshot),
          id: row.id,
          avatarUrl: row.avatar_key ? `/v1/agent-templates/${row.id}/avatar?v=${row.updated_at}` : null,
          cardUrl: row.card_key ? `/v1/agent-templates/${row.id}/card?v=${row.updated_at}` : null,
          creatorName: row.creator_name?.trim() || "OpenBot user",
          updatedAt: new Date(row.updated_at).toISOString(),
        };
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  /** With the request headers, an unchanged image comes back without a body, for a 304. */

  avatar(id: string, conditions?: Headers) {
    return Effect.fn("AgentTemplates.avatar")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        const row = yield* this.rowEffect(id);
        if (!row?.avatar_key)
          return yield* Effect.fail(
            marketplaceError(new AgentMarketplaceError(404, "avatar_not_found", "The avatar was not found.")),
          );
        const key = row.avatar_key;
        const object = yield* marketplaceCall(() =>
          bindings.SKILLS.get(key, conditions ? { onlyIf: conditions } : undefined),
        );
        if (!object)
          return yield* Effect.fail(
            marketplaceError(new AgentMarketplaceError(404, "avatar_not_found", "The avatar was not found.")),
          );
        return object;
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  card(id: string, conditions?: Headers) {
    return Effect.fn("AgentTemplates.card")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        const row = yield* this.rowEffect(id);
        if (!row?.card_key)
          return yield* Effect.fail(
            marketplaceError(new AgentMarketplaceError(404, "card_not_found", "The share card was not found.")),
          );
        const key = row.card_key;
        const object = yield* marketplaceCall(() =>
          bindings.SKILLS.get(key, conditions ? { onlyIf: conditions } : undefined),
        );
        if (!object)
          return yield* Effect.fail(
            marketplaceError(new AgentMarketplaceError(404, "card_not_found", "The share card was not found.")),
          );
        return object;
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  /**
   * Removes everything the link shows: the snapshot, the avatar and the card. The row keeps only its
   * id, the owner and the local agent, so publishing the same agent again gives back the same link.
   */

  unpublish(userId: string, id: string) {
    return Effect.fn("AgentTemplates.unpublish")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        const now = Date.now();
        // One transaction reads the image keys and clears them, so a republish racing this unpublish
        // cannot leave an image that no row names.
        const [before] = yield* marketplaceCall(() =>
          bindings.DB.batch([
            bindings.DB.prepare(
              "SELECT avatar_key, card_key FROM agent_templates WHERE id = ? AND owner_user_id = ? AND unpublished_at IS NULL",
            ).bind(id, userId),
            bindings.DB.prepare(
              `UPDATE agent_templates SET snapshot_json = '{}', avatar_key = NULL, card_key = NULL, unpublished_at = ?, updated_at = ?
         WHERE id = ? AND owner_user_id = ? AND unpublished_at IS NULL`,
            ).bind(now, now, id, userId),
          ]),
        );
        const row = before?.results?.[0];
        if (!row) return yield* Effect.fail(marketplaceError(notFound()));
        const images = yield* marketplaceDecode(() => storedImages(row));
        // The unpublish has happened; a failed delete must not turn it into an error that a retry
        // can no longer fix, because the row no longer names these images.
        yield* this.deleteImagesEffect([images.avatarKey, images.cardKey]);
      }),
    )().pipe(Effect.provide(MarketplaceStorage.layer(this.bindings)));
  }

  private deleteImagesEffect(
    keys: Array<string | null>,
  ): Effect.Effect<void, AgentMarketplaceError | AgentTemplatesStorageError, MarketplaceStorage> {
    return Effect.fn("AgentTemplates.deleteImages")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        const present = keys.filter((key): key is string => key !== null);
        if (present.length === 0) return;
        const operationResult = yield* Effect.gen({ self: this }, function* () {
          yield* marketplaceCall(() => bindings.SKILLS.delete(present));
        }).pipe(Effect.result);
        if (Result.isFailure(operationResult)) {
          const error = operationResult.failure;
          console.warn("agent-templates: could not delete images", { keys: present, error: String(error) });
        }
      }),
    )();
  }

  private rowEffect(id: string) {
    return Effect.fn("AgentTemplates.row")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        if (!isAgentTemplateId(id)) return null;
        return yield* marketplaceCall(() =>
          bindings.DB.prepare(
            `SELECT templates.id, templates.source_agent_id, templates.snapshot_json, templates.avatar_key,
              templates.card_key, templates.updated_at, users.name AS creator_name
       FROM agent_templates templates JOIN users ON users.id = templates.owner_user_id
       WHERE templates.id = ? AND templates.unpublished_at IS NULL`,
          )
            .bind(id)
            .first<TemplateRow>(),
        );
      }),
    )();
  }

  /** A marketplace skill travels by reference, so it must name an approved version that exists. */
  private validateSkillsEffect(
    snapshot: AgentTemplateSnapshot,
  ): Effect.Effect<void, AgentMarketplaceError | AgentTemplatesStorageError, MarketplaceStorage> {
    return Effect.fn("AgentTemplates.validateSkills")(() =>
      Effect.gen({ self: this }, function* () {
        const bindings = yield* MarketplaceStorage;

        for (const skill of snapshot.skills) {
          if (skill.kind !== "marketplace") continue;
          const row = yield* marketplaceCall(() =>
            bindings.DB.prepare(
              `SELECT versions.version, skills.slug
         FROM marketplace_skill_versions versions JOIN marketplace_skills skills ON skills.id = versions.skill_id
         WHERE versions.id = ? AND versions.skill_id = ? AND versions.status = 'approved'`,
            )
              .bind(skill.versionId, skill.skillId)
              .first<{ version: number; slug: string }>(),
          );
          if (!row || row.version !== skill.version || row.slug !== skill.slug)
            return yield* Effect.fail(
              marketplaceError(
                new AgentMarketplaceError(400, "invalid_skill", `The skill ${skill.name} is not an approved version.`),
              ),
            );
        }
      }),
    )();
  }
}

interface StoredImages {
  avatarKey: string | null;
  cardKey: string | null;
}

function storedImages(row: unknown): StoredImages {
  if (!isDynamicRecord(row)) return { avatarKey: null, cardKey: null };
  return {
    avatarKey: typeof row.avatar_key === "string" ? row.avatar_key : null,
    cardKey: typeof row.card_key === "string" ? row.card_key : null,
  };
}

function notFound(): AgentMarketplaceError {
  return new AgentMarketplaceError(404, "template_not_found", "The agent was not found.");
}

/** 16 random bytes as base64url: 22 characters, the shape `isAgentTemplateId` accepts. */
function newTemplateId(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

class AgentTemplatesStorageError extends Schema.TaggedError<AgentTemplatesStorageError>()(
  "AgentTemplatesStorageError",
  { message: Schema.String },
) {}
const marketplaceError = (error: unknown): AgentMarketplaceError | AgentTemplatesStorageError =>
  error instanceof AgentMarketplaceError
    ? error
    : new AgentTemplatesStorageError({
        message: error instanceof Error ? error.message : "Marketplace operation failed.",
      });
const marketplaceCall = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({ try: operation, catch: marketplaceError });
const marketplaceDecode = <A>(operation: () => A) => Effect.try({ try: operation, catch: marketplaceError });
