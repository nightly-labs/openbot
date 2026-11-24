import MaskedView from "@react-native-masked-view/masked-view";
import { createContext, type ReactNode, use, useCallback, useEffect, useState } from "react";
import type { LayoutChangeEvent, LayoutRectangle } from "react-native";
import Svg, { Path } from "react-native-svg";

type ReportHole = (hole: LayoutRectangle | null) => void;

const AvatarHoleContext = createContext<ReportHole | null>(null);

export function useAvatarHole(): ((event: LayoutChangeEvent) => void) | undefined {
  const report = use(AvatarHoleContext);
  useEffect(() => (report ? () => report(null) : undefined), [report]);
  return report ? (event) => report(event.nativeEvent.layout) : undefined;
}

function pillPath({ x, y, width, height }: LayoutRectangle): string {
  const radius = Math.min(width, height) / 2;
  const right = x + width;
  const bottom = y + height;
  return [
    `M${x + radius} ${y}`,
    `H${right - radius}`,
    `A${radius} ${radius} 0 0 1 ${right - radius} ${bottom}`,
    `H${x + radius}`,
    `A${radius} ${radius} 0 0 1 ${x + radius} ${y}`,
    "Z",
  ].join(" ");
}

function holeKey(hole: LayoutRectangle | null): string {
  return hole ? `${hole.x},${hole.y},${hole.width},${hole.height}` : "none";
}

export function AvatarCutout({ size, children, badge }: { size: number; children: ReactNode; badge: ReactNode }) {
  const [hole, setHole] = useState<LayoutRectangle | null>(null);
  const report = useCallback<ReportHole>(
    (next) => setHole((current) => (holeKey(current) === holeKey(next) ? current : next)),
    [],
  );
  const outline = `M0 0H${size}V${size}H0Z`;
  return (
    <AvatarHoleContext value={report}>
      <MaskedView
        style={{ width: size, height: size }}
        maskElement={
          <Svg key={holeKey(hole)} width={size} height={size}>
            <Path d={hole ? `${outline} ${pillPath(hole)}` : outline} fill="#000" fillRule="evenodd" />
          </Svg>
        }
      >
        {children}
      </MaskedView>
      {badge}
    </AvatarHoleContext>
  );
}
