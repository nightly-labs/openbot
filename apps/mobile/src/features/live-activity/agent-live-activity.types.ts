import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import type { AvatarHue } from "@openbot/contracts/ipc";
import type { AgentLiveActivityProps } from "@openbot/team-client/live-activity-props";
import type { LiveActivityStarter } from "./model/live-activity-sync";

export interface AgentLiveActivityNative {
  starter: LiveActivityStarter<AgentLiveActivityProps>;
  /**
   * Gives the widget the keys that open a host update, as base64url text, and the props it shows
   * when it cannot open one. It has them before the host sends an update.
   */
  setSealKeys(keys: { seal: string; tag: string } | null, fallback: AgentLiveActivityProps): void;
  /**
   * Writes an agent picture where the widget extension can read it and returns its file name, or
   * `null` when the App Group is not available. `name` must be unique for the picture version.
   */
  saveAvatar(name: string, dataUrl: string): string | null;
  /** Whether the App Group has the picture file already. */
  hasAvatar(file: string): boolean;
  /** Draws the agent bloub with the face of `mood` as a PNG data URL, for `saveAvatar`. */
  renderBloub(seed: string, hue: AvatarHue | null, mood: AvatarMood): string | null;
  /** Deletes the picture files that `keep` does not name. */
  removeAvatars(keep: ReadonlySet<string>): void;
}

/** Returns the Live Activity type, or `null` on a platform without Live Activities. */
export type AgentLiveActivityLoader = () => AgentLiveActivityNative | null;
