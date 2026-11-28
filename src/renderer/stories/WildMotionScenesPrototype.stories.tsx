import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  AgentsMagicHatVariant,
  CelebrateFireworksVariant,
  CrashDizzyVariant,
  CrashExplodingVariant,
  OfflineSpaceTetherVariant,
  SearchBallPitVariant,
  SearchTumbleweedVariant,
  StartupPopcornVariant,
  WaitingSnoringVariant,
} from "./wild-motion-scenes-prototype";

const meta = {
  title: "Prototypes/Motion scenes/Wild",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The plush heats up and pops the whole crew out, then itself, onto the pile. "App ready" sends them away. */
export const StartupPopcorn: Story = { name: "Startup W2. Popcorn crew", render: () => <StartupPopcornVariant /> };

/** The plush bursts into felt balls and eyes that bounce around the window. Throw them; Reload gathers them. */
export const CrashExploding: Story = { name: "Crash W1. Exploding plush", render: () => <CrashExplodingVariant /> };

/** The plush dives head first into a pit of felt balls and comes up with nothing. Type to make it dive again. */
export const SearchBallPit: Story = { name: "Search W1. Ball-pit dive", render: () => <SearchBallPitVariant /> };

/** The plush bonks a felt top hat; the crew pop out, stack into a tower, and dive back in. */
export const AgentsMagicHat: Story = { name: "No agents W1. Magic hat", render: () => <AgentsMagicHatVariant /> };

/** Felt fireworks over the app while the whole crew hops past in a conga line. */
export const CelebrateFireworks: Story = {
  name: "Task done W1. Felt fireworks",
  render: () => <CelebrateFireworksVariant />,
};

/** The plush snores felt "z" balls in a sleeping bag while the usage limit resets. Tap it to wake it. */
export const WaitingSnoring: Story = { name: "Waiting W1. Snoring plush", render: () => <WaitingSnoringVariant /> };

/** The plush spins, felt balls circle its head, and it falls flat. Reload stands it up. */
export const CrashDizzy: Story = { name: "Crash W2. Dizzy plush", render: () => <CrashDizzyVariant /> };

/** A felt tumbleweed rolls across the empty result and hops over the plush. Type to send another. */
export const SearchTumbleweed: Story = { name: "Search W3. Tumbleweed", render: () => <SearchTumbleweedVariant /> };

/** The plush floats away on a yarn tether. Retry tugs it; "Online" reels it home. Drag it to throw it. */
export const OfflineSpaceTether: Story = {
  name: "Offline W1. Space tether",
  render: () => <OfflineSpaceTetherVariant />,
};
