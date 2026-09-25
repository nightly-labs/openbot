import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import type { AvatarHue } from "@openbot/contracts/ipc";
import type { AgentLiveActivityProps } from "./model/live-activity-props";
import type { LiveActivityStarter } from "./model/live-activity-sync";

export interface AgentLiveActivityNative {
  starter: LiveActivityStarter<AgentLiveActivityProps>;
  /**
   * Writes an agent photo where the widget extension can read it and returns its `file://` URL, or
   * `null` when the App Group is not available. `name` must be unique for the photo version.
   */
  saveAvatar(name: string, dataUrl: string): string | null;
  /** Draws the agent bloub with the face of `mood` as a PNG data URL, for `saveAvatar`. */
  renderBloub(seed: string, hue: AvatarHue | null, mood: AvatarMood): string | null;
  /** Deletes the photos that `keep` does not name. */
  removeAvatars(keep: ReadonlySet<string>): void;
}

/** Returns the Live Activity type, or `null` on a platform without Live Activities. */
export type AgentLiveActivityLoader = () => AgentLiveActivityNative | null;
