import type { ComputerUseCoveredArea } from "@openbot/contracts/ipc";
import { useText } from "@openbot/ui/text";

export interface ComputerUseWindowHighlightProps {
  windowTitle: string;
  cornerRadius?: number;
  covered?: readonly ComputerUseCoveredArea[];
  width?: number;
  height?: number;
}

export function ComputerUseWindowHighlight(props: ComputerUseWindowHighlightProps) {
  const { t } = useText();
  return (
    <div
      class="computer-use-window-highlight"
      style={{
        "--computer-use-window-radius": `${props.cornerRadius ?? 12}px`,
        "clip-path": clipPath(props),
      }}
      role="status"
      aria-label={t("computerUse.highlight.working", { title: props.windowTitle })}
    />
  );
}

function clipPath(props: ComputerUseWindowHighlightProps): string | undefined {
  const covered = props.covered ?? [];
  if (covered.length === 0 || !props.width || !props.height) return undefined;
  const holes = covered.map((area) => rectangle(area.x, area.y, area.width, area.height));
  return `path(evenodd, "${[rectangle(0, 0, props.width, props.height), ...holes].join(" ")}")`;
}

function rectangle(x: number, y: number, width: number, height: number): string {
  return `M${x} ${y}H${x + width}V${y + height}H${x}Z`;
}
