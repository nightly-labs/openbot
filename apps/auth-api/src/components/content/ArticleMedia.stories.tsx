import { AppLogo } from "@openbot/brand";
import type { JSX } from "@solidjs/web";
import { For } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
// The site's stylesheet, not the desktop app's. It is imported here rather than in
// .storybook/preview.tsx because it carries `html`, `body` and `a` rules of its
// own: loaded for every story it would restyle the whole of Storybook, and loaded
// here it arrives only once this story is opened.
import "../../styles.css";
import "./ArticleMedia.stories.css";
import aChannel from "../../content/guides/media/openbot-101/a-channel.webp";
import aThread from "../../content/guides/media/openbot-101/a-thread.webp";
import pickAModel from "../../content/guides/media/openbot-101/pick-a-model.webp";
import { CONTENT_COLLECTIONS } from "../../lib/content";
import { formatArticleDate } from "../../lib/content-collection";
import { GUIDES_COLLECTION } from "../../lib/guides";
import { EXTERNAL_LINK_REL, OPENBOT_LINKS } from "../../lib/landing-links";
import { Button } from "../ui/button";
import { ArticleGradient } from "./ArticleGradient";
import { ArticleImage } from "./ArticleMedia";

// The string the mount's colours are drawn from. A real article passes its own
// title, so a mounted picture matches the artwork on the card the reader arrived
// from; here it is a control, so the colour families can be compared.
const ARTICLE_TITLE = "OpenBot 101";
const GUIDE = GUIDES_COLLECTION.articles.find((article) => article.slug === "openbot-101");
if (!GUIDE) throw new Error("OpenBot 101 must be in the guides registry.");

const meta = {
  title: "Site/Article media",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function StoryHeader() {
  return (
    <header class="landing-header">
      <a class="landing-brand" href="/" aria-label="OpenBot home">
        <AppLogo variant="production" class="landing-brand-logo" />
        <span>OpenBot</span>
      </a>
      <nav class="landing-navigation" aria-label="Primary navigation">
        <For each={CONTENT_COLLECTIONS}>
          {(collection) => (
            <a class="landing-header-link" href={collection.indexRoute}>
              {collection.name}
            </a>
          )}
        </For>
        <Button
          href={OPENBOT_LINKS.contact}
          target="_blank"
          rel={EXTERNAL_LINK_REL}
          variant="secondary"
          size="sm"
          icon="contact"
          class="landing-header-contact"
        >
          Contact
        </Button>
        <Button href="/" variant="primary" size="sm" icon="download">
          Download
        </Button>
      </nav>
    </header>
  );
}

function ProseColumn(props: { children: JSX.Element }) {
  return (
    <main class="post-main">
      <article class="post-container post-article-body">
        <div class="post-prose">{props.children}</div>
      </article>
    </main>
  );
}

/**
 * A screenshot on the article card's own gradient, the way a product shot sits on a
 * coloured field. The gradient is live here so the motion is the first thing you
 * see; rest is not required.
 */
export const ProductShot: Story = {
  render: () => (
    <div class="story-product-shot">
      <ArticleGradient title={ARTICLE_TITLE} mode="live" />
      <img
        class="story-product-shot-window"
        src={aThread}
        alt="An agent thread. Chief answers a launch question with a table of workstreams, owners and status."
        width={2400}
        height={1064}
      />
    </div>
  ),
};

/**
 * How a mounted screenshot reads on a real article page: the same header, title,
 * hero artwork and column as /guides/openbot-101, with the article gradient moving
 * around the pictures.
 */
export const InTheArticle: Story = {
  render: () => (
    <div class="landing-page post-article">
      <StoryHeader />
      <main class="post-main">
        <article class="post-container post-article-body">
          <header class="post-article-header">
            <a class="post-article-back" href="/guides">
              {GUIDES_COLLECTION.backLabel}
            </a>
            <h1 class="post-article-title">{GUIDE.title}</h1>
            <p class="post-article-standfirst">{GUIDE.description}</p>
            <p class="post-meta post-article-byline">
              <time datetime={GUIDE.publishedAt}>{formatArticleDate(GUIDE.publishedAt)}</time>
              <span aria-hidden="true"> · </span>
              <span>{GUIDE.author}</span>
            </p>
          </header>
          <div class="post-article-art">
            <ArticleGradient title={GUIDE.title} mode="live" />
          </div>
          <div class="post-prose">
            <p>
              I built OpenBot because I wanted teammates, not chats. A chat window forgets. A teammate keeps the folder
              it works in, the history of what it did, and a name you can call it by.
            </p>
            <p>
              Four things belong to an agent, and all four survive a restart and a change of model: a workspace, a
              thread, an identity, and a private provider session. Move an agent from Codex to Claude and only the
              thinking changes.
            </p>
            <ArticleImage
              src={aThread}
              alt="An agent thread. Chief answers a launch question with a table of workstreams, owners and status."
              width={2400}
              height={1064}
              caption="No mountOn. The picture is the whole of the figure, which is right when it is already dark to its edges."
            />
            <ArticleImage
              src={aThread}
              alt="An agent thread. Chief answers a launch question with a table of workstreams, owners and status."
              width={2400}
              height={1064}
              mountOn={GUIDE.title}
              mountPad="tight"
              caption="The same file with mountOn. The colours come from the article title, so this is the picture the reader met on the card."
            />
            <h2>Install it, then connect a provider</h2>
            <p>
              Take the installer from GitHub Releases. Then give it a provider. In onboarding, in Settings or in the
              model picker, select a provider and press Download: OpenBot installs and pins its own managed copy of that
              command-line tool.
            </p>
            <ArticleImage
              src={pickAModel}
              alt="The model picker open on the ChatGPT tab, showing the installed Codex CLI version and a list of GPT models."
              width={1440}
              height={1484}
              mountOn={GUIDE.title}
              mountPad="roomy"
              caption="The picker names the command-line tool and its version, so you can see which binary an answer came from."
            />
            <h2>Channels: more than one agent on one thing</h2>
            <p>
              A channel is a shared thread that several agents read and write. One agent owns the task at a time, and it
              hands the task on explicitly. It works best when the agents are different from each other.
            </p>
            <ArticleImage
              src={aChannel}
              alt="A channel called Launch room. Chief assigns the release note to Launch, Research reports which claims it could verify, and Launch posts the finished draft."
              width={2400}
              height={1090}
              mountOn={GUIDE.title}
              caption="One room, one task owner. The handover is a message, so you can read who took the work and why."
            />
          </div>
        </article>
      </main>
    </div>
  ),
};

/**
 * A tall picture on a mount. The padding is proportional to the column rather than
 * to the picture, so a portrait screenshot keeps the same border as a wide one.
 */
export const TallPicture: Story = {
  render: () => (
    <ProseColumn>
      <ArticleImage
        src={pickAModel}
        alt="The model picker open on the ChatGPT tab, showing the installed Codex CLI version and a list of GPT models."
        width={1440}
        height={1484}
        mountOn={ARTICLE_TITLE}
        caption="The picker names the command-line tool and its version, so you can see which binary an answer came from."
      />
    </ProseColumn>
  ),
};

/**
 * The same wide screenshot with no mount, then both pads. Leave `mountOn` out for
 * a bare picture. Rest a pointer on a mount: the gradient is the article's own.
 */
export const MountPad: Story = {
  render: () => (
    <ProseColumn>
      <ArticleImage
        src={aThread}
        alt="An agent thread. Chief answers a launch question with a table of workstreams, owners and status."
        width={2400}
        height={1064}
        caption="No mountOn"
      />
      <ArticleImage
        src={aThread}
        alt="An agent thread. Chief answers a launch question with a table of workstreams, owners and status."
        width={2400}
        height={1064}
        mountOn={ARTICLE_TITLE}
        mountPad="tight"
        caption={`mountOn + mountPad="tight"`}
      />
      <ArticleImage
        src={aThread}
        alt="An agent thread. Chief answers a launch question with a table of workstreams, owners and status."
        width={2400}
        height={1064}
        mountOn={ARTICLE_TITLE}
        mountPad="roomy"
        caption={`mountOn + mountPad="roomy"`}
      />
    </ProseColumn>
  ),
};

/**
 * Four titles, four colour families. Every mount in one article agrees with every
 * other, and two articles rarely land on the same band.
 */
export const ColourFamilies: Story = {
  render: () => (
    <ProseColumn>
      {["OpenBot 101", "Write a guide for OpenBot", "One agent, many providers", "Run the team server yourself"].map(
        (title) => (
          <ArticleImage
            src={pickAModel}
            alt="The model picker open on the ChatGPT tab, showing the installed Codex CLI version and a list of GPT models."
            width={1440}
            height={1484}
            mountOn={title}
            caption={title}
          />
        ),
      )}
    </ProseColumn>
  ),
};
