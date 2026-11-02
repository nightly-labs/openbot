/** A sticky note on the canvas. It has no ports, and a run skips it. */

import type { AppTextKey } from "@openbot/i18n";
import { Bold, Button, LabelTooltipTrigger, StickyNote, Textarea, UserRoundPen } from "@openbot/ui";
import { Show, untrack } from "solid-js";
import { useText } from "../../text";
import { Hint } from "./workflow-board";
import {
  ALIGN_ICONS,
  ALIGNS,
  asBoolean,
  asString,
  type CanvasColor,
  COLORS,
  FONTS,
  isAlign,
  isColor,
  isFont,
  isTone,
  NodeShell,
  NodeToolbar,
  type NoteTone,
  oneOf,
  Swatch,
  type TextAlign,
  type TextFont,
  TONES,
  ToolbarChoice,
  ToolbarSeparator,
  translated,
  useField,
  useLocked,
  useTextField,
} from "./workflow-node-parts";

/** The text colour of a note: the paper text, or a note colour darkened so that it reads on paper. */
const noteInk = (color: CanvasColor) =>
  color === "ink"
    ? "var(--openbot-paper-text)"
    : `color-mix(in srgb, var(--openbot-file-${color}) 62%, var(--openbot-paper-text))`;

type NoteSize = "lg" | "2xl" | "3xl" | "display";

/** The sizes of the note text, from the text sizes of the palette, in pixels. */
const NOTE_SIZES: readonly { value: NoteSize; label: AppTextKey; pixels: number }[] = [
  { value: "lg", label: "workflow.note.size.small", pixels: 14 },
  { value: "2xl", label: "workflow.note.size.medium", pixels: 18 },
  { value: "3xl", label: "workflow.note.size.large", pixels: 24 },
  { value: "display", label: "workflow.note.size.extraLarge", pixels: 32 },
];

/**
 * A sticky note, as on Higgsfield: coloured paper with its words and the name of its author. The
 * toolbar sets the paper and text colour, the font, the size, the alignment and the weight, and
 * shows or hides the author. It has no ports, and a run skips it.
 */
export function NoteNode(props: { id: string; text?: string; tone?: NoteTone }) {
  const { t } = useText();
  const id = () => props.id;
  /** The user who wrote the note. The canvas saves the name when it adds the note, so each reader sees the same name. */
  const [writer] = useField(id, "authorName", "", asString);
  const [text, setText] = useTextField(
    id,
    "text",
    untrack(() => props.text ?? ""),
  );
  const [tone, setTone] = useField<NoteTone>(
    id,
    "tone",
    untrack(() => props.tone ?? "yellow"),
    isTone,
  );
  const [ink, setInk] = useField<CanvasColor>(id, "ink", "ink", isColor);
  const [font, setFont] = useField<TextFont>(id, "font", "sans", isFont);
  const [size, setSize] = useField<NoteSize>(id, "size", "2xl", oneOf(NOTE_SIZES.map((choice) => choice.value)));
  const [align, setAlign] = useField<TextAlign>(id, "align", "start", isAlign);
  const [bold, setBold] = useField(id, "bold", false, asBoolean);
  const [author, setAuthor] = useField(id, "author", true, asBoolean);
  const [locked, setLocked] = useLocked(() => props.id);
  return (
    <NodeShell
      id={props.id}
      label={t("workflow.note.title")}
      icon={<StickyNote aria-hidden="true" />}
      kind="note"
      bare
      style={{ "--wfn-note": `var(--openbot-file-${tone()})`, "--wfn-note-ink": noteInk(ink()) }}
      toolbar={
        <NodeToolbar id={props.id} name={t("workflow.note.name")} locked={locked()} onLock={setLocked}>
          <Show when={!locked()}>
            <ToolbarChoice
              name={t("workflow.note.color")}
              value={tone()}
              choices={translated(t, TONES)}
              icon={(value) => <Swatch color={value} />}
              onChange={setTone}
            />
            <ToolbarChoice
              name={t("workflow.text.color")}
              value={ink()}
              choices={translated(t, COLORS)}
              icon={(value) => <span class="wfn-swatch" style={{ "--wfn-swatch": noteInk(value) }} />}
              onChange={setInk}
            />
            <ToolbarSeparator />
            <ToolbarChoice
              name={t("workflow.text.font")}
              value={font()}
              choices={translated(t, FONTS)}
              icon={(value) => (
                <span class="wfn-font-sample" data-font={value} aria-hidden="true">
                  {t("workflow.text.sample")}
                </span>
              )}
              onChange={setFont}
            />
            <ToolbarChoice
              name={t("workflow.text.size")}
              value={size()}
              choices={NOTE_SIZES.map((choice) => ({
                value: choice.value,
                label: t(choice.label),
                meta: t("workflow.text.pixels", { size: choice.pixels }),
              }))}
              tile={(_, index) => (
                <span class="wfn-font-sample" data-step={index + 1} aria-hidden="true">
                  {t("workflow.text.sample")}
                </span>
              )}
              onChange={setSize}
            />
            <ToolbarChoice
              name={t("workflow.text.align")}
              value={align()}
              choices={translated(t, ALIGNS)}
              icon={(value) => {
                const Icon = ALIGN_ICONS[value];
                return <Icon aria-hidden="true" />;
              }}
              onChange={setAlign}
            />
            <Hint label={t("workflow.text.bold")}>
              <LabelTooltipTrigger
                as={Button}
                variant="ghost"
                size="icon-sm"
                class="wfn-tool-action"
                aria-label={t("workflow.text.bold")}
                aria-pressed={bold() ? "true" : "false"}
                onClick={() => setBold(!bold())}
              >
                <Bold />
              </LabelTooltipTrigger>
            </Hint>
            <Show when={writer()}>
              <ToolbarSeparator />
              <Hint label={author() ? t("workflow.note.hideAuthor") : t("workflow.note.showAuthor")}>
                <LabelTooltipTrigger
                  as={Button}
                  variant="ghost"
                  size="icon-sm"
                  class="wfn-tool-action"
                  aria-label={t("workflow.note.showAuthor")}
                  aria-pressed={author() ? "true" : "false"}
                  onClick={() => setAuthor(!author())}
                >
                  <UserRoundPen />
                </LabelTooltipTrigger>
              </Hint>
            </Show>
          </Show>
        </NodeToolbar>
      }
    >
      <Textarea
        class="wfn-input wfn-note-input"
        data-font={font()}
        data-text-size={size()}
        data-bold={bold() ? "" : undefined}
        style={{ "text-align": align() }}
        aria-label={t("workflow.note.title")}
        placeholder={t("workflow.note.placeholder")}
        readonly={locked()}
        value={text()}
        onValueChange={setText}
      />
      <Show when={author() ? writer() : undefined}>{(name) => <span class="wfn-note-author">{name()}</span>}</Show>
    </NodeShell>
  );
}
