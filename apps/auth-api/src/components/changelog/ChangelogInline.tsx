import { For, Match, Switch } from "solid-js";
import { type InlineSegment, parseInline } from "../../lib/changelog";
import { EXTERNAL_LINK_REL } from "../../lib/landing-links";

/** Only links a reader can follow safely. Anything else in the file is shown as its text. */
function safeHref(href: string): string | undefined {
  return /^(https:\/\/|\/(?![/\\]))/u.test(href) ? href : undefined;
}

/** One line of release notes, with its code, bold and links drawn as elements rather than as HTML. */
export function ChangelogInline(props: { text: string }) {
  return (
    <For each={parseInline(props.text)}>
      {(segment: InlineSegment) => (
        <Switch fallback={segment.text}>
          <Match when={segment.kind === "code"}>
            <code class="changelog-code">{segment.text}</code>
          </Match>
          <Match when={segment.kind === "strong"}>
            <strong class="changelog-strong">{segment.text}</strong>
          </Match>
          <Match when={segment.kind === "link" && safeHref(segment.href)}>
            {(href) => (
              <a class="changelog-link" href={href()} target="_blank" rel={EXTERNAL_LINK_REL}>
                {segment.text}
              </a>
            )}
          </Match>
        </Switch>
      )}
    </For>
  );
}
