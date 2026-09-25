import { isAgentTemplateId } from "@openbot/contracts/agent-template-links";
import { isValidAvatarImage } from "@openbot/contracts/avatar-images";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentTemplateDetail,
  type AgentTemplateSnapshot,
  isAgentTemplateSnapshot,
  toAgentTemplateSnapshot,
} from "@openbot/contracts/ipc";
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

    const existing = await this.bindings.DB.prepare(
      "SELECT id, avatar_key FROM agent_templates WHERE owner_user_id = ? AND source_agent_id = ?",
    )
      .bind(input.user.id, sourceAgentId)
      .first<{ id: string; avatar_key: string | null }>();
    if (!existing) {
      const count = await this.bindings.DB.prepare(
        "SELECT count(*) AS count FROM agent_templates WHERE owner_user_id = ?",
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
    try {
      if (existing) {
        await this.bindings.DB.prepare(
          "UPDATE agent_templates SET snapshot_json = ?, avatar_key = ?, updated_at = ? WHERE id = ? AND owner_user_id = ?",
        )
          .bind(JSON.stringify(snapshot), avatarKey, now, id, input.user.id)
          .run();
      } else {
        await this.bindings.DB.prepare(
          `INSERT INTO agent_templates(id, owner_user_id, source_agent_id, snapshot_json, avatar_key, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(id, input.user.id, sourceAgentId, JSON.stringify(snapshot), avatarKey, now, now)
          .run();
      }
    } catch (error) {
      if (avatarKey) await this.bindings.SKILLS.delete(avatarKey);
      throw error;
    }
    if (existing?.avatar_key) await this.bindings.SKILLS.delete(existing.avatar_key);
    return { id, sourceAgentId, updatedAt: new Date(now).toISOString() };
  }

  async listMine(userId: string): Promise<OwnedAgentTemplate[]> {
    const result = await this.bindings.DB.prepare(
      "SELECT id, source_agent_id, updated_at FROM agent_templates WHERE owner_user_id = ? ORDER BY updated_at DESC",
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

  async unpublish(userId: string, id: string): Promise<void> {
    const row = await this.bindings.DB.prepare(
      "SELECT avatar_key FROM agent_templates WHERE id = ? AND owner_user_id = ?",
    )
      .bind(id, userId)
      .first<{ avatar_key: string | null }>();
    if (!row) throw notFound();
    await this.bindings.DB.prepare("DELETE FROM agent_templates WHERE id = ? AND owner_user_id = ?")
      .bind(id, userId)
      .run();
    if (row.avatar_key) await this.bindings.SKILLS.delete(row.avatar_key);
  }

  private row(id: string) {
    if (!isAgentTemplateId(id)) return Promise.resolve(null);
    return this.bindings.DB.prepare(
      `SELECT templates.id, templates.source_agent_id, templates.snapshot_json, templates.avatar_key,
              templates.updated_at, users.name AS creator_name
       FROM agent_templates templates JOIN users ON users.id = templates.owner_user_id
       WHERE templates.id = ?`,
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
