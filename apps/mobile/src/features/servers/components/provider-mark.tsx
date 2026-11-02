import { providerLogoShape } from "@openbot/brand/provider-logo-shape";
import type { AgentProviderId } from "@openbot/contracts/ipc";
import { useThemeColor } from "heroui-native/hooks";
import Svg, { Path } from "react-native-svg";
import { useCSSVariable } from "uniwind";

/** The colour of a provider mark. Codex, Grok and the others draw in the text colour. */
function useProviderColor(provider: AgentProviderId): string {
  const foreground = String(useThemeColor("foreground"));
  const [claude, gemini] = useCSSVariable(["--openbot-provider-claude", "--openbot-provider-antigravity"]);
  if (provider === "claude" && claude) return String(claude);
  if (provider === "antigravity" && gemini) return String(gemini);
  return foreground;
}

/** The mark of a provider, from the shapes that desktop draws too. */
export function ProviderMark({ provider, size }: { provider: AgentProviderId; size: number }) {
  const color = useProviderColor(provider);
  const shape = providerLogoShape(provider);
  return (
    <Svg width={size} height={size} viewBox={shape.viewBox} accessibilityElementsHidden importantForAccessibility="no">
      {shape.paths.map((path) => (
        <Path
          key={path.d}
          d={path.d}
          fill={color}
          opacity={path.opacity}
          fillRule={path.evenOdd ? "evenodd" : "nonzero"}
        />
      ))}
    </Svg>
  );
}
