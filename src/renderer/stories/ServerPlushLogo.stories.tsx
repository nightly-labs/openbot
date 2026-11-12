import { type ServerPlushColor, serverPlushColor } from "@openbot/brand/bloub-avatar";
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
