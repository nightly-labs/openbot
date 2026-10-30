import { articleGradient } from "@openbot/brand/article-gradient";
import { useId, useMemo } from "react";
import { StyleSheet } from "react-native";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";

/** Where each spot of colour sits and how far it reaches, as `articleGradientCss` places them. */
const SPOTS = [
  { cx: "22%", cy: "26%", r: "55%" },
  { cx: "78%", cy: "22%", r: "52%" },
  { cx: "32%", cy: "82%", r: "58%" },
  { cx: "84%", cy: "76%", r: "54%" },
] as const;

/**
 * The still gradient of a listing, from its name: the same colours as the desktop and web Marketplace
 * card (`SkillGradient`), drawn as the CSS fallback of that card. It fills its parent.
 */
export function ListingGradient({ name }: { name: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/gu, "");
  const gradient = useMemo(() => articleGradient(name), [name]);
  // A family can have fewer colours than spots; a missing one is the page colour the spots sit on.
  const base = gradient.colors[gradient.colors.length - 1] ?? "#000000";
  const spots = SPOTS.map((_, index) => gradient.colors[index] ?? base);
  const second = spots[1];
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden>
      <Defs>
        <LinearGradient id={`${id}base`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={second} />
          <Stop offset="1" stopColor={base} />
        </LinearGradient>
        {SPOTS.map((spot, index) => (
          <RadialGradient key={spot.cx} id={`${id}spot${index}`} cx={spot.cx} cy={spot.cy} r={spot.r}>
            <Stop offset="0" stopColor={spots[index]} stopOpacity={1} />
            <Stop offset="1" stopColor={spots[index]} stopOpacity={0} />
          </RadialGradient>
        ))}
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id}base)`} />
      {/* CSS paints the first layer on top, so the last spot is drawn first. */}
      {SPOTS.map((spot, index) => (
        <Rect key={spot.cx} width="100%" height="100%" fill={`url(#${id}spot${index})`} />
      )).reverse()}
    </Svg>
  );
}
