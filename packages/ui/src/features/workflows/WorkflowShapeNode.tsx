import type { AppTextKey } from "@openbot/i18n";
import { Shapes, Textarea } from "@openbot/ui";
import { Show, untrack } from "solid-js";
import { useText } from "../../text";
import {
  type CanvasColor,
  COLORS,
  colorVar,
  isColor,
  NodeShell,
  NodeToolbar,
  oneOf,
  type ShapeKind,
  Swatch,
  ToolbarChoice,
  translated,
  useField,
  useLocked,
  useTextField,
} from "./workflow-node-parts";

export const SHAPES: readonly { value: ShapeKind; label: AppTextKey; size: { width: number; height: number } }[] = [
  { value: "rectangle", label: "workflow.shape.rectangle", size: { width: 208, height: 128 } },
  { value: "circle", label: "workflow.shape.circle", size: { width: 144, height: 144 } },
  { value: "diamond", label: "workflow.shape.diamond", size: { width: 160, height: 160 } },
  { value: "triangle", label: "workflow.shape.triangle", size: { width: 160, height: 144 } },
  { value: "inverted", label: "workflow.shape.inverted", size: { width: 160, height: 144 } },
  { value: "oval", label: "workflow.shape.oval", size: { width: 208, height: 128 } },
  { value: "star", label: "workflow.shape.star", size: { width: 160, height: 152 } },
];

export const shapeSize = (shape: ShapeKind) =>
  SHAPES.find((option) => option.value === shape)?.size ?? { width: 208, height: 128 };

const STAR = Array.from({ length: 10 }, (_, index) => {
  const reach = index % 2 === 0 ? 1 : 0.4;
  const angle = -Math.PI / 2 + (index * Math.PI) / 5;
  return `${(50 + 50 * reach * Math.cos(angle)).toFixed(1)},${(55 + 55 * reach * Math.sin(angle)).toFixed(1)}`;
}).join(" ");

const POLYGONS: Partial<Record<ShapeKind, string>> = {
  diamond: "50,0 100,50 50,100 0,50",
  triangle: "50,0 100,100 0,100",
  inverted: "0,0 100,0 50,100",
  star: STAR,
};

export function ShapeSurface(props: { shape: ShapeKind; color: CanvasColor }) {
  return (
    <Show
      when={POLYGONS[props.shape]}
      fallback={<span class="wfn-shape-surface" data-shape={props.shape} data-color={props.color} aria-hidden="true" />}
    >
      {(points) => (
        <svg
          class="wfn-shape-surface"
          data-shape={props.shape}
          data-color={props.color}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polygon points={points()} vector-effect="non-scaling-stroke" />
        </svg>
      )}
    </Show>
  );
}

export function ShapeIcon(props: { shape: ShapeKind }) {
  const outline = () => {
    switch (props.shape) {
      case "rectangle":
        return <rect x="4" y="4" width="16" height="16" rx="2" />;
      case "circle":
        return <circle cx="12" cy="12" r="8.5" />;
      case "oval":
        return <rect x="2.5" y="7" width="19" height="10" rx="5" />;
      default:
        return (
          <polygon
            points={(POLYGONS[props.shape] ?? "")
              .split(" ")
              .map((point) => {
                const [x = 0, y = 0] = point.split(",").map(Number);
                return `${(3.5 + x * 0.17).toFixed(2)},${(3.5 + y * 0.17).toFixed(2)}`;
              })
              .join(" ")}
          />
        );
    }
  };
  return (
    <svg
      class="wfn-shape-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {outline()}
    </svg>
  );
}

export function ShapeNode(props: { id: string; shape?: ShapeKind; color?: CanvasColor; text?: string }) {
  const { t } = useText();
  const id = () => props.id;
  const [shape, setShape] = useField<ShapeKind>(
    id,
    "shape",
    untrack(() => props.shape ?? "rectangle"),
    oneOf(SHAPES.map((choice) => choice.value)),
  );
  const [color, setColor] = useField<CanvasColor>(
    id,
    "color",
    untrack(() => props.color ?? "ink"),
    isColor,
  );
  const [text, setText] = useTextField(
    id,
    "text",
    untrack(() => props.text ?? ""),
  );
  const [locked, setLocked] = useLocked(() => props.id);
  return (
    <NodeShell
      id={props.id}
      label={t("workflow.shape.title")}
      icon={<Shapes aria-hidden="true" />}
      kind="shape"
      bare
      style={{ "--wfn-shape": colorVar(color()) }}
      toolbar={
        <NodeToolbar id={props.id} name={t("workflow.shape.name")} locked={locked()} onLock={setLocked}>
          <Show when={!locked()}>
            <ToolbarChoice
              name={t("workflow.shape.title")}
              value={shape()}
              choices={translated(t, SHAPES)}
              icon={(value) => <ShapeIcon shape={value} />}
              onChange={setShape}
            />
            <ToolbarChoice
              name={t("workflow.text.colorPlain")}
              value={color()}
              choices={translated(t, COLORS)}
              icon={(value) => <Swatch color={value} />}
              onChange={setColor}
            />
          </Show>
        </NodeToolbar>
      }
    >
      <ShapeSurface shape={shape()} color={color()} />
      <Textarea
        class="wfn-input wfn-shape-input"
        aria-label={t("workflow.shape.text")}
        rows={1}
        readonly={locked()}
        value={text()}
        onValueChange={setText}
      />
    </NodeShell>
  );
}
