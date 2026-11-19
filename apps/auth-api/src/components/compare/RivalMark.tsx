import { RIVAL_MARK_SHAPES, type RivalMarkName } from "./rival-mark-shapes";

export type { RivalMarkName } from "./rival-mark-shapes";

export function RivalMark(props: { name: RivalMarkName; class?: string }) {
  const shape = () => RIVAL_MARK_SHAPES[props.name];
  return (
    <svg class={props.class} viewBox={shape().viewBox.join(" ")} fill="currentColor" aria-hidden="true">
      <path fill-rule={shape().fillRule ?? "evenodd"} d={shape().path} />
    </svg>
  );
}
