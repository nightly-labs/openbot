import type { AppTextKey } from "@openbot/i18n";
import { Image } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import { resultValue, useBoard, type WfnBoard } from "./workflow-board";

export type InputRole = "reference" | "first" | "last" | "both";

const ROLE_TEXT = {
  reference: "workflow.video.role.reference",
  first: "workflow.video.role.first",
  last: "workflow.video.role.last",
  both: "workflow.video.role.both",
} as const satisfies Record<InputRole, AppTextKey>;

const ROLE_BADGE = {
  first: "workflow.video.badge.first",
  last: "workflow.video.badge.last",
  both: "workflow.video.badge.both",
} as const satisfies Record<Exclude<InputRole, "reference">, AppTextKey>;

export function storedPictureUrl(board: WfnBoard, value: string): string | undefined {
  return (
    board.catalogs().files.find((file) => file.name === value && file.previewKind === "image")?.previewUrl ?? undefined
  );
}

export function orStoredPicture(
  board: WfnBoard,
  made: string | null | undefined,
  value: string,
): string | null | undefined {
  return made ?? storedPictureUrl(board, value) ?? made;
}

export function pictureUrl(board: WfnBoard, value: string): string | null | undefined {
  const preview = board.catalogs().mediaPreview;
  return orStoredPicture(board, preview ? preview(value) : board.catalogs().media?.(value, "image"), value);
}

function inputPictureUrl(board: WfnBoard, source: string): string | undefined {
  const shown = board.shown(source);
  const file = board.field(source, "fileId");
  const value = shown && !shown.failed ? resultValue(shown) : typeof file === "string" && file ? file : undefined;
  return value === undefined ? undefined : (pictureUrl(board, value) ?? undefined);
}

function InputPicture(props: { index: number; url: string | undefined; role: InputRole }) {
  const { t } = useText();
  const badge = () => (props.role === "reference" ? undefined : t(ROLE_BADGE[props.role]));
  const label = () =>
    t("workflow.media.inputLabel", { index: String(props.index + 1), role: t(ROLE_TEXT[props.role]) });
  return (
    <span class="wfn-media-input" role="img" aria-label={label()}>
      <Show when={props.url} fallback={<Image aria-hidden="true" />}>
        {(url) => <img src={url()} alt="" draggable="false" />}
      </Show>
      <Show when={badge()}>{(text) => <span class="wfn-media-input-badge">{text()}</span>}</Show>
    </span>
  );
}

export function InputPictures(props: { sources: readonly string[]; roleOf?: (source: string) => InputRole }) {
  const board = useBoard();
  const { t } = useText();
  return (
    <fieldset class="wfn-media-inputs" aria-label={t("workflow.media.inputs")}>
      <For each={props.sources}>
        {(source, index) => (
          <InputPicture
            index={index()}
            url={inputPictureUrl(board, source)}
            role={props.roleOf?.(source) ?? "reference"}
          />
        )}
      </For>
    </fieldset>
  );
}
