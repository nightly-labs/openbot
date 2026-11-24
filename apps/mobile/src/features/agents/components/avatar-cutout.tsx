import MaskedView from "@react-native-masked-view/masked-view";
import { createContext, type ReactNode, use, useCallback, useEffect, useId, useState } from "react";
import { type LayoutChangeEvent, type LayoutRectangle, View } from "react-native";
import Svg, { Path } from "react-native-svg";

const AVATAR_OVERFLOW = 0.15;

interface OwnedHole {
  owner: string;
  rect: LayoutRectangle;
}

type ReportHole = (owner: string, rect: LayoutRectangle | null) => void;

const AvatarHoleContext = createContext<ReportHole | null>(null);

export function useAvatarHole(): ((event: LayoutChangeEvent) => void) | undefined {
  const report = use(AvatarHoleContext);
  const owner = useId();
  useEffect(() => (report ? () => report(owner, null) : undefined), [owner, report]);
  return report ? (event) => report(owner, event.nativeEvent.layout) : undefined;
}

function pillPath({ x, y, width, height }: LayoutRectangle, offset: number): string {
  const radius = Math.min(width, height) / 2;
  const left = x + offset;
  const top = y + offset;
  const right = left + width;
  const bottom = top + height;
  return [
    `M${left + radius} ${top}`,
    `H${right - radius}`,
    `A${radius} ${radius} 0 0 1 ${right - radius} ${bottom}`,
    `H${left + radius}`,
    `A${radius} ${radius} 0 0 1 ${left + radius} ${top}`,
    "Z",
  ].join(" ");
}

function rectKey(rect: LayoutRectangle | undefined): string {
  return rect ? `${rect.x},${rect.y},${rect.width},${rect.height}` : "none";
}

function nextHole(current: OwnedHole | null, owner: string, rect: LayoutRectangle | null): OwnedHole | null {
  if (!rect) return current?.owner === owner ? null : current;
  if (current?.owner === owner && rectKey(current.rect) === rectKey(rect)) return current;
  return { owner, rect };
}

export function AvatarCutout({ size, children, badge }: { size: number; children: ReactNode; badge: ReactNode }) {
  const [hole, setHole] = useState<OwnedHole | null>(null);
  const report = useCallback<ReportHole>((owner, rect) => setHole((current) => nextHole(current, owner, rect)), []);
  const pad = Math.ceil(size * AVATAR_OVERFLOW);
  const box = size + pad * 2;
  const outline = `M0 0H${box}V${box}H0Z`;
  return (
    <AvatarHoleContext value={report}>
      <MaskedView
        style={{ position: "absolute", left: -pad, top: -pad, width: box, height: box }}
        maskElement={
          <Svg key={rectKey(hole?.rect)} width={box} height={box}>
            <Path d={hole ? `${outline} ${pillPath(hole.rect, pad)}` : outline} fill="#000" fillRule="evenodd" />
          </Svg>
        }
      >
        <View style={{ padding: pad }}>{children}</View>
      </MaskedView>
      {badge}
    </AvatarHoleContext>
  );
}
