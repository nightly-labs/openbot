import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, For } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Badge, Heading, Text } from "../src/components/ui";

const colors = [
  ["Canvas", "--openbot-bg-canvas"],
  ["Surface", "--openbot-bg-surface"],
  ["Control", "--openbot-bg-control"],
  ["Border", "--openbot-border-strong"],
  ["Accent", "--openbot-accent"],
  ["Success", "--openbot-success"],
  ["Warning", "--openbot-warning"],
  ["Danger", "--openbot-danger"],
] as const;

// The two accent families, and what each step is for. The blue is the action
// colour and reaches 155 call sites; the pink says "newly available" and has one,
// the account dock's update pill.
const accentBlue = [
  ["Accent", "--openbot-accent", "Filled buttons, switches, the send control"],
  ["Accent hover", "--openbot-accent-hover", "Hover on a filled control"],
  ["Accent text", "--openbot-accent-text", "Links, and the blue word in a badge"],
  ["Accent soft", "--openbot-accent-soft", "Badge and selected-row fills"],
  ["Accent strong", "--openbot-accent-strong", "Selection rings, glows and gradient stops"],
  ["Border focus", "--openbot-border-focus", "Focus ring on an interactive edge"],
  ["Focus tint", "--openbot-focus-tint", "The ring's outer glow"],
] as const;

const accentPink = [
  ["Badge new", "--openbot-badge-new", "The word in a New pill"],
  ["Badge new soft", "--openbot-badge-new-soft", "Its fill"],
] as const;

const meta = {
  title: "Foundations/Colors",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const SemanticPalette: Story = {
  render: () => (
    <main class="foundation-story">
      <Heading as="h1" size="lg">
        Semantic palette
      </Heading>
      <div class="foundation-story-grid">
        <For each={colors}>{([name, token]) => <Swatch name={name} token={token} />}</For>
      </div>
    </main>
  ),
};

export const Accents: Story = {
  render: () => (
    <main class="foundation-story">
      <section class="foundation-story-section">
        <Heading as="h1" size="lg">
          Accent — action
        </Heading>
        <Text tone="muted">One blue family. Every focus ring, filled control and link resolves to it.</Text>
        <div class="foundation-story-grid">
          <For each={accentBlue}>{([name, token, use]) => <Swatch name={name} token={token} use={use} />}</For>
        </div>
      </section>

      <section class="foundation-story-section">
        <Heading as="h1" size="lg">
          Accent — announcement
        </Heading>
        <Text tone="muted">Pink says a thing is newly available, which is not the same claim as success.</Text>
        <div class="foundation-story-grid">
          <For each={accentPink}>{([name, token, use]) => <Swatch name={name} token={token} use={use} />}</For>
        </div>
      </section>

      <section class="foundation-story-section">
        <Heading as="h1" size="lg">
          In place
        </Heading>
        <Text tone="muted">The vibrant colours are text on a soft fill, which is where they read brightest.</Text>
        <div class="foundation-story-row">
          <Badge variant="new">New</Badge>
          <Badge variant="info-light">Beta</Badge>
          <Badge variant="success-light">Connected</Badge>
          <Badge variant="warning-light">Paused</Badge>
          <Badge variant="destructive-light">Failed</Badge>
        </div>
      </section>
    </main>
  ),
};

function Swatch(props: { name: string; token: string; use?: string }): JSX.Element {
  const [card, setCard] = createSignal<HTMLElement>();
  const [resolved, setResolved] = createSignal("");
  // Read the computed value rather than restating it, so the card cannot drift
  // from packages/brand/src/tokens.css the way a hard-coded hex would.
  createEffect(card, (element) => {
    if (element) setResolved(getComputedStyle(element).getPropertyValue(props.token).trim());
  });

  return (
    <article class="foundation-token-card" ref={setCard}>
      <div class="foundation-color-swatch" style={{ "--foundation-color": `var(${props.token})` }} />
      <Text variant="label">{props.name}</Text>
      <Text variant="caption" tone="muted">
        {resolved()}
      </Text>
      <Text variant="caption" tone="muted">
        {props.use ?? props.token}
      </Text>
    </article>
  );
}
