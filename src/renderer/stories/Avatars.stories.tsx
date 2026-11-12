import { BloubBot, POSES } from "@norbert_bodziony/bloub";
import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import { Button } from "@openbot/ui";
import { bloubAvatarProfile } from "@openbot/ui/bloub-avatar";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { TeamPersonAvatar } from "@openbot/ui/features/team/TeamPersonAvatar";
import { createStore, For, Show } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENTS, STORY_PRESENCE } from "./fixtures";

const agentMeta = {
  title: "Identity/AgentAvatar",
  component: AgentAvatar,
  parameters: { layout: "centered" },
} satisfies Meta<typeof AgentAvatar>;

export default agentMeta;
type AgentStory = StoryObj<typeof agentMeta>;

export const Generated: AgentStory = {
  args: { agent: STORY_AGENTS[0], motion: "hover" },
};

export const Thinking: AgentStory = {
  args: { agent: STORY_AGENTS[1], motion: "always", class: "size-12" },
};

export const IndependentMotion: AgentStory = {
  render: () => {
    const [state, setState] = createStore({
      seeds: ["agent-alpha", "agent-beta", "agent-gamma", "agent-delta"],
      updates: 0,
      visible: true,
    });
    return (
      <div class="grid gap-6 p-8">
        <div class="flex gap-3">
          <Button
            onClick={() =>
              setState((draft) => {
                draft.seeds.reverse();
              })
            }
          >
            Reverse agents
          </Button>
          <Button
            onClick={() =>
              setState((draft) => {
                draft.updates += 1;
              })
            }
          >
            Update conversation
          </Button>
          <Button
            onClick={() =>
              setState((draft) => {
                draft.visible = !draft.visible;
              })
            }
          >
            {state.visible ? "Hide avatars" : "Show avatars"}
          </Button>
        </div>
        <p>Conversation updates: {state.updates}</p>
        <Show when={state.visible}>
          <For each={["idle", "always", "hover"] as const}>
            {(motion) => (
              <section class="grid gap-3" aria-label={`${motion} avatars`}>
                <strong>{motion}</strong>
                <div class="flex gap-5">
                  <For each={state.seeds}>
                    {(seed) => (
                      <Button variant="ghost" aria-label={`${motion} ${seed}`}>
                        <AgentAvatar seed={seed} motion={motion} class="size-12" hue={215} />
                        {seed}
                      </Button>
                    )}
                  </For>
                </div>
              </section>
            )}
          </For>
        </Show>
      </div>
    );
  },
};

export const CustomImageFallback: AgentStory = {
  args: { agent: { ...STORY_AGENTS[2], avatarUrl: "mock-avatar://missing" } },
};

const AVATAR_SIZES = [16, 18, 24, 32, 36, 42, 62] as const;
const AVATAR_MOODS = [
  "idle",
  "working",
  "waiting",
  "failed",
  "responded",
  "connecting",
  "asleep",
] as const satisfies readonly AvatarMood[];
const PLUSH_AND_FLAT_SEEDS = ["agent-alpha", "agent-beta", "agent-gamma", "agent-delta", "agent-epsilon"] as const;

/**
 * One seed across every mood and every size, as the app draws a resting avatar.
 *
 * This is the story that proves the point of the mood table: reading down a column, the silhouette
 * is the same in all seven rows and only the face and the plush's felt pieces change. A row that
 * draws a different body is a mood that should map to another plush state.
 */
export const SizesAndMoods: AgentStory = {
  render: () => (
    <div
      class="grid gap-6 p-8"
      style={{ background: "var(--openbot-bg-canvas)", color: "var(--openbot-text-primary)" }}
    >
      {AVATAR_MOODS.map((mood) => (
        <section class="grid gap-3" aria-label={`${mood} avatar sizes`}>
          <strong class="text-sm capitalize">{mood}</strong>
          <div class="flex items-end gap-5">
            {AVATAR_SIZES.map((size) => (
              <div class="grid justify-items-center gap-2">
                <AgentAvatar
                  seed="story-avatar"
                  hue={215}
                  mood={mood}
                  motion="hover"
                  style={{ width: `${size}px`, height: `${size}px` }}
                />
                <small style={{ color: "var(--openbot-text-muted)" }}>{size}</small>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  ),
};

/**
 * The felt plush that the app draws, above the flat Bloub that it replaced, for the same seeds and
 * sizes. It shows where the small sizes stop reading.
 */
export const PlushAndFlat: AgentStory = {
  render: () => (
    <div
      class="grid gap-6 p-8"
      style={{ background: "var(--openbot-bg-canvas)", color: "var(--openbot-text-primary)" }}
    >
      {PLUSH_AND_FLAT_SEEDS.map((seed) => {
        const profile = bloubAvatarProfile(seed, null);
        return (
          <section class="grid gap-3" aria-label={`${seed} plush and flat`}>
            <div class="flex items-end gap-5">
              {AVATAR_SIZES.map((size) => (
                <AgentAvatar
                  seed={seed}
                  hue={null}
                  motion="hover"
                  style={{ width: `${size}px`, height: `${size}px` }}
                />
              ))}
            </div>
            <div class="flex items-end gap-5">
              {AVATAR_SIZES.map((size) => (
                <span class="agent-avatar agent-avatar-bloub" style={{ width: `${size}px`, height: `${size}px` }}>
                  <BloubBot
                    size={100}
                    shape={profile.shape}
                    color={profile.color}
                    expression={profile.expression}
                    frozenAt={POSES.idle}
                    ariaLabel={`Flat ${seed} at ${size} pixels`}
                    class="bloub-avatar-svg"
                  />
                </span>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  ),
};

/** The live moods as the app renders them: each one plays on the plush face, with no ring or glow. */
export const Moods: AgentStory = {
  render: () => (
    <div class="flex items-center gap-8 p-8">
      {AVATAR_MOODS.map((mood) => (
        <div class="grid justify-items-center gap-3">
          <AgentAvatar seed="story-avatar" hue={215} mood={mood} motion="always" class="size-12" />
          <small style={{ color: "var(--openbot-text-muted)" }}>{mood}</small>
        </div>
      ))}
    </div>
  ),
};

export const PersonAvatars: AgentStory = {
  render: () => (
    <div class="flex items-center gap-4">
      {STORY_PRESENCE.members.slice(0, 3).map((member) => (
        <TeamPersonAvatar member={member} large />
      ))}
    </div>
  ),
};
