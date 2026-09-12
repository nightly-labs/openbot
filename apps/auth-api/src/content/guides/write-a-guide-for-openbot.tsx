import { Link } from "@tanstack/solid-router";
import { ArticleClip, ArticleGif, ArticleImage, ArticleVideo } from "../../components/content/ArticleMedia";
import { EXTERNAL_LINK_REL, OPENBOT_LINKS } from "../../lib/landing-links";
import aClearTask from "./media/write-a-guide-for-openbot/a-clear-task.webp";
import aShortTour from "./media/write-a-guide-for-openbot/a-short-tour.mp4";
import aShortTourCaptions from "./media/write-a-guide-for-openbot/a-short-tour.vtt?url";
import aShortTourPoster from "./media/write-a-guide-for-openbot/a-short-tour-poster.webp";
import readAThread from "./media/write-a-guide-for-openbot/read-a-thread.mp4";
import readAThreadPoster from "./media/write-a-guide-for-openbot/read-a-thread-poster.webp";
import switchProvider from "./media/write-a-guide-for-openbot/switch-provider.gif";
import switchProviderStill from "./media/write-a-guide-for-openbot/switch-provider-still.webp";

export function WriteAGuideForOpenBot() {
  return (
    <>
      <p>
        This page is two things at once. It is the instructions for adding a guide to this site, and it is the worked
        example: every element a guide body can use appears below, in the place where the text needs it. Copy from here
        rather than reading the components.
      </p>

      <h2>Add a guide in three steps</h2>
      <ol>
        <li>
          Write the body as a TSX component in <code>apps/auth-api/src/content/guides/</code>, named after its slug.
        </li>
        <li>
          Add one entry to <code>GUIDES_COLLECTION.articles</code> in <code>src/lib/guides.ts</code>, and one line to{" "}
          <code>GUIDE_BODIES</code> in <code>src/content/guides/index.ts</code>.
        </li>
        <li>
          Run <code>bun run api:images</code> and commit what it writes into <code>apps/auth-api/content-art</code>.
        </li>
      </ol>
      <p>The registry entry is the only description of the article the rest of the site reads:</p>
      <pre>
        <code>{REGISTRY_ENTRY}</code>
      </pre>
      <p>
        The artwork is generated, not drawn: four images per guide, from the title. The build fails when the committed
        folder and the registry disagree, so the last step is not optional. Nothing else needs changing — the index
        page, the article page, the sitemap and the feed all read the registry.
      </p>

      <h3>House rules</h3>
      <ul>
        <li>
          Write in ASD-STE100 Simplified Technical English: short sentences, one idea each, no words the reader has to
          decode.
        </li>
        <li>
          Keep <code>description</code> between 110 and 160 characters. It is the search result and the social card.
        </li>
        <li>
          Say what a picture shows in its <code>alt</code>, not that it is a picture. A caption adds what the prose did
          not.
        </li>
        <li>Check every claim against the code. A guide that is confidently wrong costs more than no guide.</li>
      </ul>
      <blockquote>
        Write for somebody who has the application open and is stuck. That reader does not want the history of the
        feature. They want the next thing to press.
      </blockquote>

      <hr />

      <h2>The elements you can use</h2>
      <p>
        A body is plain TSX, so any markup renders — but only the elements below are styled, and anything else will look
        like it escaped. Headings give the page its shape: <code>h2</code> for a section, <code>h3</code> for a step
        inside one. Use <strong>strong</strong> for the sentence a skimming reader must not miss, and no more than one
        per section.
      </p>
      <p>
        Use <code>ul</code> for things of equal weight and <code>ol</code> when the order is the point. Use inline{" "}
        <code>code</code> for a path, a flag or a setting, and a <code>pre</code> block for anything the reader will
        copy. Name a key with <kbd>⌘</kbd>
        <kbd>K</kbd> rather than describing it, and use a table when the reader is choosing between options.
      </p>

      <h3>Linking out and linking on</h3>
      <p>
        An external link takes its address from <code>OPENBOT_LINKS</code> and carries <code>target="_blank"</code> with{" "}
        <code>rel={"{EXTERNAL_LINK_REL}"}</code>, like this link to{" "}
        <a href={OPENBOT_LINKS.repository} target="_blank" rel={EXTERNAL_LINK_REL}>
          the repository
        </a>
        . Never paste a bare URL: one constant keeps every page pointing at the same place.
      </p>
      <p>
        A link inside the site is a router <code>Link</code>, so it navigates without reloading the page — for example
        to{" "}
        <Link to="/news/$slug" params={{ slug: "one-agent-many-providers" }}>
          One agent, many providers
        </Link>
        , or back to <Link to="/guides">all guides</Link>.
      </p>

      <hr />

      <h2>Pictures, animations and video</h2>
      <p>
        Import the file rather than writing its path, and keep it in <code>src/content/guides/media/&lt;slug&gt;/</code>
        . The build then fingerprints it and fails on a file that is not there, so a renamed picture cannot ship broken.
        Every one of these components needs the real width and height, which is what holds the page still while the file
        loads.
      </p>
      <table>
        <thead>
          <tr>
            <th>Component</th>
            <th>Use it for</th>
            <th>It needs</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>ArticleImage</code>
            </td>
            <td>A screenshot or a diagram.</td>
            <td>
              <code>alt</code>. Optional <code>mountOn</code> (the article title) puts it on the card gradient; leave it
              out for a bare picture. <code>mountPad</code> is <code>"tight"</code> or <code>"roomy"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>ArticleGif</code>
            </td>
            <td>A few frames that repeat, where each frame matters.</td>
            <td>
              <code>alt</code> and a <code>still</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>ArticleClip</code>
            </td>
            <td>A silent loop of movement, at a fraction of a GIF's size.</td>
            <td>
              <code>label</code> and a <code>poster</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>ArticleVideo</code>
            </td>
            <td>Something with sound, or longer than a loop.</td>
            <td>
              <code>label</code>, a <code>poster</code> and <code>captions</code>
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        A <code>caption</code> on any of them draws the line underneath. Leave it out and the picture stands on its own,
        which is right when the picture only repeats the sentence above it.
      </p>

      <h3>A still picture</h3>
      <p>Reach for this first. It is the cheapest thing to load and the easiest thing to read.</p>
      <p>
        Leave <code>mountOn</code> out and the picture is the whole of the figure, which is right when it is already
        dark to its edges. Give it <code>mountOn</code> with this article's title to sit it on the card gradient.{" "}
        <code>mountPad="tight"</code> is a thin mat, <code>mountPad="roomy"</code> is a field. Leave{" "}
        <code>mountPad</code> out and a wide picture is tight, a tall one is roomy.
      </p>
      <ArticleImage
        src={aClearTask}
        alt="An agent thread where the reader asks Research which claim is still open and what would close it."
        width={1696}
        height={612}
        caption="No mount. The picture stops where the column stops."
      />
      <ArticleImage
        src={aClearTask}
        alt="An agent thread where the reader asks Research which claim is still open and what would close it."
        width={1696}
        height={612}
        mountOn="Write a guide for OpenBot"
        caption="The same file on the card gradient. Rest a pointer on it and the artwork starts from the frame already on screen."
      />

      <h3>An animation</h3>
      <p>
        Use a GIF for a handful of states the reader compares against each other. It carries its own Pause control, and
        a reader who asked their system for less motion is given the still until they ask for the motion.
      </p>
      <ArticleGif
        src={switchProvider}
        still={switchProviderStill}
        alt="The provider tabs in the model picker, changing between Claude, ChatGPT, Grok and OpenCode, each with its command-line tool version."
        width={1440}
        height={912}
        caption="Four providers behind one agent. The version under each name is the command-line tool OpenBot will start."
      />

      <h3>A silent loop</h3>
      <p>
        A clip is a GIF that compresses. It has no sound, it loops, it downloads nothing until it is on screen, and it
        stops when the reader stops it.
      </p>
      <ArticleClip
        src={readAThread}
        poster={readAThreadPoster}
        label="A thread scrolling through an agent's answer, from the opening summary down to the table of workstreams and the shell command under it."
        width={1696}
        height={940}
        caption="Movement is worth the bytes when the point is the movement — here, how much of a turn sits below the answer."
      />

      <h3>A video with captions</h3>
      <p>
        Use a video when a loop is too short for what you have to show. The reader starts it, and{" "}
        <strong>a WebVTT captions file is required</strong> — write it by hand next to the video. A video nobody can
        read is a video half the readers are shut out of.
      </p>
      <ArticleVideo
        src={aShortTour}
        poster={aShortTourPoster}
        captions={aShortTourCaptions}
        label="A three-part tour of OpenBot: an agent thread, a shared channel, and a routine with its schedule."
        width={2400}
        height={860}
        caption="Three scenes, three seconds each. Turn the captions on to see what a hand-written WebVTT file looks like in use."
      />

      <hr />

      <h2>Before you open the pull request</h2>
      <p>
        Read your own guide with the application open beside it and do what it says. Then check the article page, the
        index card, the feed and the social card, because one registry entry feeds all four. If a sentence only makes
        sense to somebody who already knows the answer, it is not finished.
      </p>
      <p>
        The{" "}
        <a href={OPENBOT_LINKS.contributing} target="_blank" rel={EXTERNAL_LINK_REL}>
          contributing notes
        </a>{" "}
        cover the rest of the checks. Start from{" "}
        <Link to="/guides/$slug" params={{ slug: "openbot-101" }}>
          OpenBot 101
        </Link>{" "}
        if you need the vocabulary this site uses.
      </p>
    </>
  );
}

const REGISTRY_ENTRY = `{
  slug: "write-a-guide-for-openbot",
  title: "Write a guide for OpenBot",
  description: "…110 to 160 characters, and the only summary the site has…",
  publishedAt: "2026-09-11",
  author: NEWS_AUTHOR,
}`;
