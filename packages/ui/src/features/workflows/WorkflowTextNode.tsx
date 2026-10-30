/** Free text on the canvas, for a heading over a column of nodes. It has no card and no ports. */

import type { AppTextKey } from "@openbot/i18n";
import { Bold, Button, buttonVariants, ChevronDown, DropdownMenu, LabelTooltipTrigger, Textarea } from "@openbot/ui";
import { Show, untrack } from "solid-js";
import { useText } from "../../text";
import { PickerMenu } from "./WorkflowPicker";
import { Hint, useBoard } from "./workflow-board";
import {
  ALIGN_ICONS,
  ALIGNS,
  asBoolean,
  type CanvasColor,
  COLORS,
  colorVar,
  FONTS,
  isAlign,
  isColor,
  isFont,
  LockDelete,
  oneOf,
  ResizeGrip,
  Swatch,
  type TextAlign,
  type TextFont,
  Toolbar,
  ToolbarChoice,
  ToolbarSeparator,
  translated,
  useField,
  useLocked,
  useTextField,
} from "./workflow-node-parts";

/* ---------------------------------------------------------------- Text */

/** The preset sizes of free text, with their size in pixels. */
const TEXT_SIZES = [
  { value: "md", label: "workflow.text.size.body", pixels: 14 },
  { value: "lg", label: "workflow.text.size.heading", pixels: 24 },
  { value: "xl", label: "workflow.text.size.title", pixels: 40 },
] as const satisfies readonly { value: string; label: AppTextKey; pixels: number }[];
type TextSize = (typeof TEXT_SIZES)[number]["value"];

/**
 * Free text on the canvas, for a heading over a column of nodes. It has no card and no ports. The
 * toolbar sets the colour, the font, the size, the alignment and the weight, as on a note.
 */
export function TextNode(props: { id: string; text?: string; size?: TextSize; bold?: boolean }) {
  const board = useBoard();
  const { t } = useText();
  const id = () => props.id;
  const [text, setText] = useTextField(
    id,
    "text",
    untrack(() => props.text ?? ""),
  );
  const [color, setColor] = useField<CanvasColor>(id, "color", "ink", isColor);
  const [typeface, setTypeface] = useField<TextFont>(id, "font", "sans", isFont);
  const [size, setSize] = useField<TextSize>(
    id,
    "size",
    untrack(() => props.size ?? "md"),
    oneOf(TEXT_SIZES.map((choice) => choice.value)),
  );
  const [align, setAlign] = useField<TextAlign>(id, "align", "start", isAlign);
  const [bold, setBold] = useField(
    id,
    "bold",
    untrack(() => props.bold ?? false),
    asBoolean,
  );
  const [locked, setLocked] = useLocked(() => props.id);
  /** A font size that the user set with the grip, else the size of the preset. */
  const font = () => board.size(props.id)?.font;
  const sizeLabel = () =>
    t("workflow.text.pixels", {
      size: font() ?? TEXT_SIZES.find((option) => option.value === size())?.pixels ?? TEXT_SIZES[0].pixels,
    });
  /** A set width wraps the text; without one, the text sets the width. */
  const width = () => board.size(props.id)?.width;
  return (
    <Show when={!board.isRemoved(props.id)}>
      <article
        class="wfn-node wfn-text"
        data-node-id={props.id}
        data-selected={board.isSelected(props.id) ? "" : undefined}
        data-doomed={board.isDoomed(props.id) ? "" : undefined}
        data-locked={locked() ? "" : undefined}
        tabindex={board.resizable ? 0 : undefined}
        data-sized={width() === undefined ? undefined : ""}
        aria-label={t("workflow.text.title")}
        style={{ width: width() === undefined ? undefined : `${width()}px` }}
      >
        <Show when={board.selected() === props.id}>
          <Toolbar id={props.id}>
            <ToolbarChoice
              name={t("workflow.text.colorPlain")}
              value={color()}
              choices={translated(t, COLORS)}
              icon={(value) => <Swatch color={value} />}
              onChange={setColor}
            />
            <ToolbarSeparator />
            <ToolbarChoice
              name={t("workflow.text.font")}
              value={typeface()}
              choices={translated(t, FONTS)}
              icon={(value) => (
                <span class="wfn-font-sample" data-font={value} aria-hidden="true">
                  {t("workflow.text.sample")}
                </span>
              )}
              onChange={setTypeface}
            />
            <DropdownMenu.Root placement="bottom-start" gutter={8}>
              <DropdownMenu.Trigger
                class={`${buttonVariants({ variant: "ghost", size: "xs" })} wfn-toolbar-select`}
                aria-label={t("workflow.node.choice", { name: t("workflow.text.size"), value: sizeLabel() })}
              >
                {sizeLabel()}
                <ChevronDown aria-hidden="true" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <PickerMenu
                  label={t("workflow.text.size")}
                  groups={[
                    {
                      options: TEXT_SIZES.map((option, index) => ({
                        value: option.value,
                        label: t(option.label),
                        tile: () => (
                          <span class="wfn-font-sample" data-step={index + 1} aria-hidden="true">
                            {t("workflow.text.sample")}
                          </span>
                        ),
                        chips: [{ text: t("workflow.text.pixels", { size: option.pixels }) }],
                      })),
                    },
                  ]}
                  value={font() === undefined ? size() : undefined}
                  onSelect={(value) => {
                    setSize(value);
                    board.resetSize?.(props.id);
                  }}
                />
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
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
            <ToolbarSeparator />
            <LockDelete id={props.id} name={t("workflow.text.name")} locked={locked()} onLock={setLocked} />
          </Toolbar>
        </Show>
        <Textarea
          class="wfn-text-input"
          data-font={typeface()}
          data-text-size={size()}
          data-bold={bold() ? "" : undefined}
          style={{
            "--wfn-text-ink": colorVar(color()),
            "text-align": align(),
            "font-size": font() === undefined ? undefined : `${font()}px`,
          }}
          rows={1}
          aria-label={t("workflow.text.title")}
          placeholder={t("workflow.text.placeholder")}
          readonly={locked()}
          value={text()}
          onValueChange={setText}
        />
        <ResizeGrip id={props.id} />
      </article>
    </Show>
  );
}
