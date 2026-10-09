import type { JSX } from "@solidjs/web";
import { CLAUDE_PATH, CODEX_PATH, CURSOR_PATH } from "./provider-logo-shape";

export type ProviderLogoVariant =
  | "codex"
  | "claude"
  | "grok"
  | "opencode"
  | "antigravity"
  | "cursor"
  | "cline"
  | "acp"
  | "pi"
  | "muse";

export interface ProviderLogoProps {
  provider: ProviderLogoVariant;
  class?: JSX.SvgSVGAttributes<SVGSVGElement>["class"];
}

// The Gemini spark in one colour, from Simple Icons (CC0): https://simpleicons.org/?q=googlegemini
const GEMINI_PATH =
  "M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81";

// The Cline mark in one colour, from Simple Icons (CC0): https://simpleicons.org/?q=cline
const CLINE_PATH =
  "m23.365 13.556-1.442-2.895V8.994c0-2.764-2.218-5.002-4.954-5.002h-2.464c.178-.367.276-.779.276-1.213A2.77 2.77 0 0 0 12.018 0a2.77 2.77 0 0 0-2.763 2.779c0 .434.098.846.276 1.213H7.067c-2.736 0-4.954 2.238-4.954 5.002v1.667L.64 13.549c-.149.29-.149.636 0 .927l1.472 2.855v1.667C2.113 21.762 4.33 24 7.067 24h9.902c2.736 0 4.954-2.238 4.954-5.002V17.33l1.44-2.865c.143-.286.143-.622.002-.91m-12.854 2.36a2.27 2.27 0 0 1-2.261 2.273 2.27 2.27 0 0 1-2.261-2.273v-4.042A2.27 2.27 0 0 1 8.249 9.6a2.267 2.267 0 0 1 2.262 2.274zm7.285 0a2.27 2.27 0 0 1-2.26 2.273 2.27 2.27 0 0 1-2.262-2.273v-4.042A2.267 2.267 0 0 1 15.535 9.6a2.267 2.267 0 0 1 2.261 2.274z";

// OpenBot's own mark for a custom ACP agent: a command prompt. No third-party mark stands for all of
// them.
const ACP_PROMPT_PATH =
  "M4.3 6.3a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 1 1-1.4-1.4L8.6 12 4.3 7.7a1 1 0 0 1 0-1.4Z";
const ACP_CURSOR_PATH = "M12 17a1 1 0 0 1 1-1h7a1 1 0 1 1 0 2h-7a1 1 0 0 1-1-1Z";

export function ProviderLogo(props: ProviderLogoProps) {
  const isClaude = () => props.provider === "claude";
  const isGrok = () => props.provider === "grok";
  const isGemini = () => props.provider === "antigravity";
  const isCursor = () => props.provider === "cursor";
  const isCline = () => props.provider === "cline";
  // Native CLI providers use the existing neutral terminal mark.
  const isAcp = () => props.provider === "acp" || props.provider === "pi" || props.provider === "muse";

  return (
    <svg
      class={props.class}
      viewBox={
        props.provider === "opencode"
          ? "0 0 240 300"
          : isGrok() || isGemini() || isCursor() || isCline() || isAcp()
            ? "0 0 24 24"
            : isClaude()
              ? "0 0 248 248"
              : "0 0 256 260"
      }
      aria-hidden="true"
      data-provider={props.provider}
    >
      {props.provider === "opencode" ? (
        // Official mark: https://github.com/anomalyco/opencode/blob/dev/packages/console/app/src/asset/brand/opencode-logo-dark.svg
        <>
          <path d="M180 240H60V120H180V240Z" opacity="0.3" />
          <path d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z" />
        </>
      ) : isGrok() ? (
        <>
          <path d="M9.26905 15.284 17.2479 9.36086c.3912-.29039.9502-.17712 1.1366.27392.981 2.37872.5427 5.23732-1.409 7.20012-1.9517 1.9627-4.6673 2.3931-7.1494 1.4128L7.1146 19.5102c3.8891 2.6732 8.6117 2.0121 11.5628-.9577 2.3408-2.354 3.0658-5.5628 2.3879-8.4564l.0061.0062c-.983-4.25087.2417-5.94997 2.7504-9.424387L24 .428711l-3.3013 3.319949v-.0103L9.267 15.2861" />
          <path d="M7.62249 16.7237c-2.79136-2.6815-2.31009-6.8315.07168-9.22465 1.76124-1.77119 4.64683-2.49408 7.16583-1.43137l2.7053-1.2563c-.4874-.35424-1.112-.73525-1.8288-1.00299-3.2399-1.34075-7.1187-.67347-9.75237 1.97302-2.53332 2.54763-3.32998 6.46489-1.96194 9.80749 1.02193 2.4982-.6533 4.2652-2.34082 6.0488C1.08337 22.2699.483318 22.9022 0 23.5716l7.62045-6.8459" />
        </>
      ) : isGemini() ? (
        <path d={GEMINI_PATH} />
      ) : isCursor() ? (
        <path d={CURSOR_PATH} />
      ) : isCline() ? (
        <path d={CLINE_PATH} />
      ) : isAcp() ? (
        <>
          <path d={ACP_PROMPT_PATH} />
          <path d={ACP_CURSOR_PATH} />
        </>
      ) : (
        <path d={isClaude() ? CLAUDE_PATH : CODEX_PATH} />
      )}
    </svg>
  );
}
