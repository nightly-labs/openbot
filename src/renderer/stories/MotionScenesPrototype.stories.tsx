import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  CrashVariant,
  FeltCountsSheetVariant,
  FeltCountsTransitionsVariant,
  FeltCountsVariant,
  FilesEmptyVariant,
  MarketplaceNoMatchVariant,
  OfflineYarnVariant,
  SearchNothingFoundVariant,
  SidebarConnectingVariant,
  StartupFeltingVariant,
  TypingBallsVariant,
} from "./motion-scenes-prototype";

const meta = {
  title: "Prototypes/Motion scenes",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Wool wisps felt into the plush. "App ready" squashes it and opens the splash through its shape. */
export const StartupFelting: Story = { name: "1. Startup felting", render: () => <StartupFeltingVariant /> };

/** The same splash on a fast start: the app is ready during the clip, so the rest plays fast. */
export const StartupFeltingFast: Story = {
  name: "1b. Startup felting, fast start",
  render: () => <StartupFeltingVariant readyAfterMs={500} />,
};

/** Type any text. The plush watches the caret, then looks for a result and shrugs. */
export const SearchNothingFound: Story = {
  name: "2. Search: nothing found",
  render: () => <SearchNothingFoundVariant />,
};

/** The yarn hangs loose and each retry tosses it. "Online" ties it, wakes the server and sends a ball across. */
export const OfflineYarn: Story = { name: "3. Offline / reconnecting", render: () => <OfflineYarnVariant /> };

/** The plush tips over and drops its felt balls. Reload calls them back and rolls it upright. */
export const Crash: Story = { name: "4. Crash / oops", render: () => <CrashVariant /> };

/** The plush peeks over the edge. Move the pointer over the empty list, or drag a file over it. */
export const FilesEmpty: Story = { name: "5. Files empty", render: () => <FilesEmptyVariant /> };

/** Three crew plushes wake in a wave while the roster of a joined server connects. */
export const SidebarConnecting: Story = {
  name: "6. No agents / connecting",
  render: () => <SidebarConnectingVariant />,
};

/** The plush tumbles in, finds nothing and shrugs. Change the query to replay it. */
export const MarketplaceNoMatch: Story = {
  name: "7. Marketplace no match",
  render: () => <MarketplaceNoMatchVariant />,
};

/** The app now: the shipped working dots. Chief and Sales work; Research is idle. */
export const TypingBalls: Story = { name: "8. Typing balls, now", render: () => <TypingBallsVariant look="now" /> };

/** A. Larger felt balls in the shipped pill, with no shadow. */
export const TypingBallsPill: Story = {
  name: "8A. Typing balls, pill",
  render: () => <TypingBallsVariant look="pill" />,
};

/** B. No pill: three felt balls sit on the avatar's edge and hop in a wave. */
export const TypingBallsPerch: Story = {
  name: "8B. Typing balls, on the avatar",
  render: () => <TypingBallsVariant look="perch" />,
};

/** C. A round badge, the size of the other sidebar badges, with three balls that roll around it. */
export const TypingBallsOrbit: Story = {
  name: "8C. Typing balls, orbit",
  render: () => <TypingBallsVariant look="orbit" />,
};

/** All looks side by side, with one to three digits and the failed mark. "Replay" plays the entrance. */
export const FeltCountsSheet: Story = { name: "9. Felt counts, close-up", render: () => <FeltCountsSheetVariant /> };

/** Each look opens, changes and closes its count and the X. "Play all" plays the steps in order. */
export const FeltCountsTransitions: Story = {
  name: "9T. Felt counts, transitions",
  render: () => <FeltCountsTransitionsVariant />,
};

/** The app now: Research has ten unread replies and a routine of Sales failed. */
export const FeltCounts: Story = { name: "9. Felt counts, now", render: () => <FeltCountsVariant look="now" /> };

/** D. Fat plum digits with frayed felt edges and a soft top light, on a lilac felt pill. */
export const FeltCountsPuffy: Story = {
  name: "9D. Felt counts, puffy felt",
  render: () => <FeltCountsVariant look="puffy" />,
};

/** E. Cream felt digits on a deep plum felt pill, the same as the "+N" of a channel. */
export const FeltCountsYarn: Story = { name: "9E. Felt counts, yarn", render: () => <FeltCountsVariant look="yarn" /> };

/** E with each wider ring, next to the 2px ring of now: the counts, the X and the channel faces. */
export const FeltCountsRings: Story = {
  name: "9E. Felt counts, ring widths",
  render: () => <FeltCountsSheetVariant rings />,
};

/** E1. A 2.5px ring around the counts, the X and the channel faces. */
export const FeltCountsYarnRing25: Story = {
  name: "9E1. Felt counts, yarn, ring 2.5px",
  render: () => <FeltCountsVariant look="yarn" ring="2.5" />,
};

/** E2. A 3px ring around the counts, the X and the channel faces. */
export const FeltCountsYarnRing3: Story = {
  name: "9E2. Felt counts, yarn, ring 3px",
  render: () => <FeltCountsVariant look="yarn" ring="3" />,
};

/** E3. A 3.5px ring around the counts, the X and the channel faces. */
export const FeltCountsYarnRing35: Story = {
  name: "9E3. Felt counts, yarn, ring 3.5px",
  render: () => <FeltCountsVariant look="yarn" ring="3.5" />,
};
