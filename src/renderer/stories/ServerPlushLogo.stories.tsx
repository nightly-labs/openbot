import { AVATAR_COLOR_CHOICES, type ServerPlushColor, serverPlushColor } from "@openbot/brand/bloub-avatar";
import { isServerAppearanceColor, SERVER_APPEARANCE_SHAPES } from "@openbot/contracts/team-protocol/host-appearance-v1";
import { Heading, ServerPlushLogo, Text } from "@openbot/ui";
import { For } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

/** One server ID for each plush colour, so the gallery shows all eight. */
function seedsForEveryColor(): Array<{ seed: string; color: ServerPlushColor }> {
  const seen = new Map<ServerPlushColor, string>();
  for (let index = 0; seen.size < 8 && index < 1000; index += 1) {
    const seed = `server-${index}`;
    const color = serverPlushColor(seed);
    if (!seen.has(color)) seen.set(color, seed);
  }
  return [...seen].map(([color, seed]) => ({ seed, color }));
}

const meta = {
  title: "Identity/ServerPlushLogo",
  component: ServerPlushLogo,
  args: { seed: "server-0" },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof ServerPlushLogo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Single: Story = {};

export const Gallery: Story = {
  parameters: { layout: "fullscreen" },
  render: () => (
    <main
      class="min-h-screen p-8"
      style={{ background: "var(--openbot-bg-canvas)", color: "var(--openbot-text-primary)" }}
    >
      <div class="mx-auto grid max-w-5xl gap-6">
        <header class="grid gap-2">
          <Heading as="h1" size="lg">
            Server plush logos
          </Heading>
        </header>
        <div class="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
          <For each={seedsForEveryColor()}>
            {(item) => (
              <article
                class="grid justify-items-center gap-4 rounded-2xl p-5"
                style={{ background: "var(--openbot-bg-surface)", "box-shadow": "0 0 0 1px var(--openbot-border)" }}
              >
                <ServerPlushLogo seed={item.seed} class="[--server-plush-logo-size:96px]" />
                <div class="flex items-center gap-3">
                  <ServerPlushLogo seed={item.seed} />
                  <Text variant="label-sm">{item.color}</Text>
                </div>
              </article>
            )}
          </For>
        </div>
      </div>
    </main>
  ),
};

/** Every shape that an owner or admin can choose, in the automatic colour and in each picker colour. */
const SHAPE_COLORS: Array<`#${string}` | null> = [
  null,
  ...AVATAR_COLOR_CHOICES.flatMap((choice) => {
    const color = choice.swatch.toLowerCase();
    return isServerAppearanceColor(color) ? [color] : [];
  }),
];

export const Shapes: Story = {
  parameters: { layout: "fullscreen" },
  render: () => (
    <main
      class="min-h-screen p-8"
      style={{ background: "var(--openbot-bg-canvas)", color: "var(--openbot-text-primary)" }}
    >
      <div class="grid gap-3">
        <For each={SERVER_APPEARANCE_SHAPES}>
          {(shape) => (
            <div class="flex items-center gap-3">
              <Text variant="label-sm" class="w-20">
                {shape}
              </Text>
              <For each={SHAPE_COLORS}>
                {(color) => (
                  <ServerPlushLogo
                    seed="server-0"
                    appearance={{ shape, color }}
                    class="[--server-plush-logo-size:48px]"
                  />
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </main>
  ),
};
