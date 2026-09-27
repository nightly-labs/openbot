import type { JSX } from "@solidjs/web";
import {
  CLAUDE_LOGO_PATH,
  CODEX_LOGO_PATH,
  GEMINI_LOGO_PATH,
  GROK_LOGO_PATHS,
  OPENCODE_LOGO_PATHS,
  PROVIDER_LOGO_VIEWBOX,
  type ProviderLogoVariant,
} from "./provider-logo-shape";

export type { ProviderLogoVariant } from "./provider-logo-shape";

export interface ProviderLogoProps {
  provider: ProviderLogoVariant;
  class?: JSX.SvgSVGAttributes<SVGSVGElement>["class"];
}

export function ProviderLogo(props: ProviderLogoProps) {
  const isClaude = () => props.provider === "claude";
  const isGrok = () => props.provider === "grok";
  const isGemini = () => props.provider === "antigravity";

  return (
    <svg
      class={props.class}
      viewBox={PROVIDER_LOGO_VIEWBOX[props.provider]}
      aria-hidden="true"
      data-provider={props.provider}
    >
      {props.provider === "opencode" ? (
        <>
          <path d={OPENCODE_LOGO_PATHS.inner} opacity="0.3" />
          <path d={OPENCODE_LOGO_PATHS.outer} />
        </>
      ) : isGrok() ? (
        <>
          <path d={GROK_LOGO_PATHS[0]} />
          <path d={GROK_LOGO_PATHS[1]} />
        </>
      ) : isGemini() ? (
        <path d={GEMINI_LOGO_PATH} />
      ) : (
        <path d={isClaude() ? CLAUDE_LOGO_PATH : CODEX_LOGO_PATH} />
      )}
    </svg>
  );
}
