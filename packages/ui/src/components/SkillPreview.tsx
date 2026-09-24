import type { MarketplaceSkillDetail } from "@openbot/contracts/ipc";
import { ArrowRight, IconButton, Puzzle } from "@openbot/ui";
import { MarkdownMessageText } from "@openbot/ui/features/conversation/MarkdownMessageText";
import { safeBrowserUrl } from "@openbot/ui/features/conversation/RichMessageText";
import { ReferenceChip } from "@openbot/ui/reference-chip";
import { SkillGradient } from "@openbot/ui/skill-gradient";
import type { JSX } from "@solidjs/web";
import { createSignal, Show } from "solid-js";

export function skillExamplePrompt(skill: Pick<MarketplaceSkillDetail, "examplePrompt">): string {
  return skill.examplePrompt?.trim() || "Help me use this skill.";
}

function skillInstructions(skill: MarketplaceSkillDetail): string {
  const instructions = skill.instructions || skill.description;
  const [first, ...rest] = instructions.split(/\r?\n/u);
  return first?.replace(/^#\s+/u, "").trim() === skill.name ? rest.join("\n").trim() : instructions;
}

export function SkillPreview(props: {
  onOpenUrl: (url: string) => Promise<void>;
  skill: MarketplaceSkillDetail;
  onTry?: () => void;
  unavailableReason?: string;
  /** The creator line under the name, where the page that shows the preview names one. */
  creatorName?: string;
  /** What the page offers for this skill, on the name's line. */
  action?: JSX.Element;
}) {
  const [linkError, setLinkError] = createSignal<string | null>(null);
  const [iconTint, setIconTint] = createSignal<{ url: string; color: string } | null>(null);
  const [failedIcon, setFailedIcon] = createSignal<string | null>(null);
  const iconUrl = () => (props.skill.iconUrl && failedIcon() !== props.skill.iconUrl ? props.skill.iconUrl : null);
  const readIconTint = (image: HTMLImageElement, url: string) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 16;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(image, 0, 0, 16, 16);
      const pixels = context.getImageData(0, 0, 16, 16).data;
      let red = 0,
        green = 0,
        blue = 0,
        total = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i] ?? 0,
          g = pixels[i + 1] ?? 0,
          b = pixels[i + 2] ?? 0;
        const weight = (Math.max(r, g, b) - Math.min(r, g, b)) * (pixels[i + 3] ?? 0);
        red += r * weight;
        green += g * weight;
        blue += b * weight;
        total += weight;
      }
      if (total)
        setIconTint({
          url,
          color: `rgb(${Math.round(red / total)} ${Math.round(green / total)} ${Math.round(blue / total)})`,
        });
    } catch {
      // Cross-origin artwork can still display when its pixels cannot be sampled.
    }
  };
  const openLink = (url: string) => {
    const safe = safeBrowserUrl(url);
    if (safe) void props.onOpenUrl(safe).catch(() => setLinkError("Could not open the link."));
  };
  return (
    <section class="skill-preview t-stagger is-shown" aria-label={`${props.skill.name} preview`}>
      <header class="skill-preview-heading t-stagger-line t-stagger-line--1">
        <span class="agent-skill-icon" aria-hidden="true">
          <Show when={iconUrl()} fallback={<Puzzle />} keyed>
            {(url) => (
              <img
                src={url}
                alt=""
                onLoad={(event) => readIconTint(event.currentTarget, url)}
                onError={() => setFailedIcon(url)}
              />
            )}
          </Show>
        </span>
        <div class="skill-preview-name">
          <h2>{props.skill.name}</h2>
          <Show when={props.creatorName}>{(name) => <p class="skill-preview-creator">By {name()}</p>}</Show>
        </div>
        <Show when={props.action}>{(action) => <div class="skill-preview-action">{action()}</div>}</Show>
        <p class="skill-preview-summary">{props.skill.description}</p>
      </header>
      <div class="skill-preview-card t-stagger-line t-stagger-line--2">
        <SkillGradient name={props.skill.name} />
        <div class="skill-preview-request">
          <p>
            <ReferenceChip
              kind="skill"
              name={props.skill.name}
              class="skill-preview-chip"
              style={{
                "--skill-logo-color": iconTint()?.url === iconUrl() ? iconTint()?.color : "var(--openbot-accent-text)",
              }}
              icon={
                <Show when={iconUrl()} fallback={<Puzzle />} keyed>
                  {(url) => <img src={url} alt="" onError={() => setFailedIcon(url)} />}
                </Show>
              }
            />{" "}
            {skillExamplePrompt(props.skill)}
          </p>
          <IconButton
            label="Try skill"
            size="icon-lg"
            variant="ghost"
            disabled={!props.onTry}
            onClick={() => props.onTry?.()}
          >
            <ArrowRight />
          </IconButton>
        </div>
      </div>
      <Show when={!props.onTry && props.unavailableReason}>
        <p class="skill-preview-unavailable t-stagger-line t-stagger-line--3">{props.unavailableReason}</p>
      </Show>
      <div class="skill-preview-description message-markdown t-stagger-line t-stagger-line--3">
        <MarkdownMessageText
          imagesAsLinks
          body={skillInstructions(props.skill)}
          agents={[]}
          onSelectAgent={() => undefined}
          onOpenLink={openLink}
        />
      </div>
      <Show when={linkError()}>{(error) => <p role="alert">{error()}</p>}</Show>
    </section>
  );
}
