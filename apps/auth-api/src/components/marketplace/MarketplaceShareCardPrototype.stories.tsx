import type { MarketplaceAgentSummary } from "@openbot/contracts/ipc";
import type { JSX } from "@solidjs/web";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
// The site's stylesheet, loaded only when a site story opens. See `ArticleMedia.stories.tsx`.
import "../../styles.css";
import "./MarketplaceShareCardPrototype.css";
import { MessagesFrame, ShareCard, SlackFrame, XFrame } from "./MarketplaceShareCardPrototype";
import { PROTOTYPE_AGENTS } from "./marketplace-prototype-fixtures";

function agent(id: string): MarketplaceAgentSummary {
  const found = PROTOTYPE_AGENTS.find((listing) => listing.id === id);
  if (!found) throw new Error(`No prototype agent ${id}.`);
  return found;
}

const VERIFIED = agent("00000000-0000-4000-8000-000000000001");
const PUBLIC = agent("00000000-0000-4000-8000-000000000002");

/** The card at full width for a verified and a public agent, then the verified one in each app. */
function SharePreviews(): JSX.Element {
  return (
    <main class="marketplace-share-page">
      <h2 class="marketplace-share-heading">The card</h2>
      <div class="marketplace-share-cards">
        <ShareCard agent={VERIFIED} />
        <ShareCard agent={PUBLIC} />
      </div>
      <div class="marketplace-share-frames">
        <section aria-label="X">
          <h2 class="marketplace-share-heading">X</h2>
          <XFrame agent={VERIFIED} />
        </section>
        <section aria-label="iMessage">
          <h2 class="marketplace-share-heading">iMessage</h2>
          <MessagesFrame agent={VERIFIED} />
        </section>
        <section aria-label="Slack">
          <h2 class="marketplace-share-heading">Slack</h2>
          <SlackFrame agent={VERIFIED} />
        </section>
      </div>
    </main>
  );
}

const meta = {
  title: "Site/Marketplace share card prototype",
  component: SharePreviews,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SharePreviews>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The chosen card: the site's dark canvas, the avatar on the left, the name beside it. */
export const Dark: Story = {};
