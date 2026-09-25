import { isAgentTemplateId } from "@openbot/contracts/agent-template-links";
import { isValidAvatarImage } from "@openbot/contracts/avatar-images";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentTemplateDetail,
  type AgentTemplateSnapshot,
  isAgentTemplateCardPng,
  isAgentTemplateSnapshot,
  toAgentTemplateSnapshot,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { AgentMarketplaceError } from "./agent-marketplace";
import type { AuthUser, WorkerBindings } from "./types";

const MAX_TEMPLATES_PER_USER = 20;

/** What the owner's app reads to show whether one of its agents is published. */
export interface OwnedAgentTemplate {
  id: string;
  sourceAgentId: string;
  updatedAt: string;
}

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

  async publish(input: {
    user: AuthUser;
    sourceAgentId: unknown;
    snapshot: unknown;
    avatar: { bytes: Uint8Array; mimeType: string } | null;
    /** The share card for link previews: a PNG of `AGENT_TEMPLATE_CARD` size. */
    card?: Uint8Array | null;
  }): Promise<OwnedAgentTemplate> {
    const sourceAgentId = input.sourceAgentId;
    if (typeof sourceAgentId !== "string" || !sourceAgentId.trim() || sourceAgentId.length > INPUT_LIMITS.identifier)
      throw new AgentMarketplaceError(400, "invalid_template", "Invalid source agent.");
    if (!isAgentTemplateSnapshot(input.snapshot))
      throw new AgentMarketplaceError(400, "invalid_template", "Invalid agent template.");
    const snapshot = toAgentTemplateSnapshot(input.snapshot);
    await this.validateSkills(snapshot);
    if (input.avatar && !isValidAvatarImage(input.avatar.mimeType, input.avatar.bytes))
      throw new AgentMarketplaceError(400, "invalid_avatar", "Choose a valid PNG, JPEG, or WebP avatar.");
    const card = input.card ?? null;
    if (card && !isAgentTemplateCardPng(card))
      throw new AgentMarketplaceError(400, "invalid_card", "The share card must be a 1200×630 PNG.");

    // The row of an unpublished agent is found too: publishing it again gives it back the same id.
    const existing = await this.bindings.DB.prepare(
      "SELECT id, unpublished_at FROM agent_templates WHERE owner_user_id = ? AND source_agent_id = ?",
    )
      .bind(input.user.id, sourceAgentId)
      .first<{ id: string; unpublished_at: number | null }>();
    if (!existing || existing.unpublished_at !== null) {
      const count = await this.bindings.DB.prepare(
        "SELECT count(*) AS count FROM agent_templates WHERE owner_user_id = ? AND unpublished_at IS NULL",
      )
        .bind(input.user.id)
        .first<{ count: number }>();
      if ((count?.count ?? 0) >= MAX_TEMPLATES_PER_USER)
        throw new AgentMarketplaceError(409, "template_limit", "You can publish up to 20 agents.");
    }

    const id = existing?.id ?? newTemplateId();
    const now = Date.now();
    let avatarKey: string | null = null;
    if (input.avatar) {
      avatarKey = `agent-templates/${id}/${crypto.randomUUID()}.avatar`;
      await this.bindings.SKILLS.put(avatarKey, input.avatar.bytes, {
        httpMetadata: { contentType: input.avatar.mimeType },
      });
    }
    let cardKey: string | null = null;
    if (card) {
      cardKey = `agent-templates/${id}/${crypto.randomUUID()}.card.png`;
      await this.bindings.SKILLS.put(cardKey, card, { httpMetadata: { contentType: "image/png" } });
    }
    let publishedId = id;
    let previous: StoredImages = { avatarKey: null, cardKey: null };
    try {
      // One transaction reads the image keys the row has and writes the new row, so the keys this
      // publish replaces are the ones it deletes, even when two publishes of one agent run at once.
      // The upsert means two first publishes meet here, not in a constraint error.
      const [before, written] = await this.bindings.DB.batch([
        this.bindings.DB.prepare(
          "SELECT avatar_key, card_key FROM agent_templates WHERE owner_user_id = ? AND source_agent_id = ?",
        ).bind(input.user.id, sourceAgentId),
        this.bindings.DB.prepare(
          `INSERT INTO agent_templates(
             id, owner_user_id, source_agent_id, snapshot_json, avatar_key, card_key, unpublished_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
           ON CONFLICT(owner_user_id, source_agent_id) DO UPDATE SET
             snapshot_json = excluded.snapshot_json,
             avatar_key = excluded.avatar_key,
             card_key = excluded.card_key,
             unpublished_at = NULL,
             updated_at = excluded.updated_at
           RETURNING id`,
        ).bind(id, input.user.id, sourceAgentId, JSON.stringify(snapshot), avatarKey, cardKey, now, now),
      ]);
      previous = storedImages(before?.results?.[0]);
      const returned = written?.results?.[0];
      if (isDynamicRecord(returned) && typeof returned.id === "string") publishedId = returned.id;
    } catch (error) {
      if (avatarKey) await this.bindings.SKILLS.delete(avatarKey);
      if (cardKey) await this.bindings.SKILLS.delete(cardKey);
      throw error;
    }
    if (previous.avatarKey && previous.avatarKey !== avatarKey) await this.bindings.SKILLS.delete(previous.avatarKey);
    if (previous.cardKey && previous.cardKey !== cardKey) await this.bindings.SKILLS.delete(previous.cardKey);
    return { id: publishedId, sourceAgentId, updatedAt: new Date(now).toISOString() };
  }

  async listMine(userId: string): Promise<OwnedAgentTemplate[]> {
    const result = await this.bindings.DB.prepare(
      `SELECT id, source_agent_id, updated_at FROM agent_templates
       WHERE owner_user_id = ? AND unpublished_at IS NULL ORDER BY updated_at DESC`,
    )
      .bind(userId)
      .all<Pick<TemplateRow, "id" | "source_agent_id" | "updated_at">>();
    return (result.results ?? []).map((row) => ({
      id: row.id,
      sourceAgentId: row.source_agent_id,
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  async get(id: string): Promise<AgentTemplateDetail> {
    const row = await this.row(id);
    if (!row) throw notFound();
    const snapshot = JSON.parse(row.snapshot_json);
    if (!isAgentTemplateSnapshot(snapshot))
      throw new AgentMarketplaceError(500, "invalid_template", "The stored agent template is invalid.");
    return {
      ...toAgentTemplateSnapshot(snapshot),
      id: row.id,
      avatarUrl: row.avatar_key ? `/v1/agent-templates/${row.id}/avatar?v=${row.updated_at}` : null,
      cardUrl: row.card_key ? `/v1/agent-templates/${row.id}/card?v=${row.updated_at}` : null,
      creatorName: row.creator_name?.trim() || "OpenBot user",
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async avatar(id: string) {
    const row = await this.row(id);
    if (!row?.avatar_key) throw new AgentMarketplaceError(404, "avatar_not_found", "The avatar was not found.");
    const object = await this.bindings.SKILLS.get(row.avatar_key);
    if (!object) throw new AgentMarketplaceError(404, "avatar_not_found", "The avatar was not found.");
    return object;
  }

  async card(id: string) {
    const row = await this.row(id);
    if (!row?.card_key) throw new AgentMarketplaceError(404, "card_not_found", "The share card was not found.");
    const object = await this.bindings.SKILLS.get(row.card_key);
    if (!object) throw new AgentMarketplaceError(404, "card_not_found", "The share card was not found.");
    return object;
  }

  /**
   * Removes everything the link shows: the snapshot, the avatar and the card. The row keeps only its
   * id, the owner and the local agent, so publishing the same agent again gives back the same link.
   */
  async unpublish(userId: string, id: string): Promise<void> {
    const now = Date.now();
    // One transaction reads the image keys and clears them, so a republish racing this unpublish
    // cannot leave an image that no row names.
    const [before] = await this.bindings.DB.batch([
      this.bindings.DB.prepare(
        "SELECT avatar_key, card_key FROM agent_templates WHERE id = ? AND owner_user_id = ? AND unpublished_at IS NULL",
      ).bind(id, userId),
      this.bindings.DB.prepare(
        `UPDATE agent_templates SET snapshot_json = '{}', avatar_key = NULL, card_key = NULL, unpublished_at = ?, updated_at = ?
         WHERE id = ? AND owner_user_id = ? AND unpublished_at IS NULL`,
      ).bind(now, now, id, userId),
    ]);
    const row = before?.results?.[0];
    if (!row) throw notFound();
    const images = storedImages(row);
    if (images.avatarKey) await this.bindings.SKILLS.delete(images.avatarKey);
    if (images.cardKey) await this.bindings.SKILLS.delete(images.cardKey);
  }

  private row(id: string) {
    if (!isAgentTemplateId(id)) return Promise.resolve(null);
    return this.bindings.DB.prepare(
      `SELECT templates.id, templates.source_agent_id, templates.snapshot_json, templates.avatar_key,
              templates.card_key, templates.updated_at, users.name AS creator_name
       FROM agent_templates templates JOIN users ON users.id = templates.owner_user_id
       WHERE templates.id = ? AND templates.unpublished_at IS NULL`,
    )
      .bind(id)
      .first<TemplateRow>();
  }

  /** A marketplace skill travels by reference, so it must name an approved version that exists. */
  private async validateSkills(snapshot: AgentTemplateSnapshot): Promise<void> {
    for (const skill of snapshot.skills) {
      if (skill.kind !== "marketplace") continue;
      const row = await this.bindings.DB.prepare(
        `SELECT versions.version, skills.slug
         FROM marketplace_skill_versions versions JOIN marketplace_skills skills ON skills.id = versions.skill_id
         WHERE versions.id = ? AND versions.skill_id = ? AND versions.status = 'approved'`,
      )
        .bind(skill.versionId, skill.skillId)
        .first<{ version: number; slug: string }>();
      if (!row || row.version !== skill.version || row.slug !== skill.slug)
        throw new AgentMarketplaceError(400, "invalid_skill", `The skill ${skill.name} is not an approved version.`);
    }
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
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}
