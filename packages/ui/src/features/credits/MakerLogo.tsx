import { CREDIT_MODEL_MAKERS, type CreditModelMaker } from "@openbot/contracts/credits";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import alibabaLogo from "../../assets/maker-logos/alibaba.svg";
import bflLogo from "../../assets/maker-logos/bfl.svg";
import bytedanceLogo from "../../assets/maker-logos/bytedance.svg";
import googleLogo from "../../assets/maker-logos/google.svg";
import ideogramLogo from "../../assets/maker-logos/ideogram.svg";
import klingLogo from "../../assets/maker-logos/kling.svg";
import metaLogo from "../../assets/maker-logos/meta.svg";
import minimaxLogo from "../../assets/maker-logos/minimax.svg";
import openaiLogo from "../../assets/maker-logos/openai.svg";
import pixverseLogo from "../../assets/maker-logos/pixverse.svg";
import recraftLogo from "../../assets/maker-logos/recraft.svg";
import syncLogo from "../../assets/maker-logos/sync.svg";
import tencentLogo from "../../assets/maker-logos/tencent.svg";
import viduLogo from "../../assets/maker-logos/vidu.svg";
import xaiLogo from "../../assets/maker-logos/xai.svg";
import { cx } from "../../utils";
import "./maker-logo.css";

const COLOR_LOGOS: Partial<Record<CreditModelMaker, string>> = {
  alibaba: alibabaLogo,
  bytedance: bytedanceLogo,
  google: googleLogo,
  kling: klingLogo,
  meta: metaLogo,
  minimax: minimaxLogo,
  pixverse: pixverseLogo,
  tencent: tencentLogo,
  vidu: viduLogo,
};

const MONO_LOGOS: Partial<Record<CreditModelMaker, string>> = {
  bfl: bflLogo,
  ideogram: ideogramLogo,
  openai: openaiLogo,
  recraft: recraftLogo,
  sync: syncLogo,
  xai: xaiLogo,
};

export function MakerLogo(props: {
  maker: CreditModelMaker;
  mono?: boolean | undefined;
  class?: string | undefined;
}): JSX.Element {
  const colorLogo = () => (props.mono ? undefined : COLOR_LOGOS[props.maker]);
  const maskLogo = () => MONO_LOGOS[props.maker] ?? (props.mono ? COLOR_LOGOS[props.maker] : undefined);
  return (
    <Show
      when={colorLogo()}
      fallback={
        <Show
          when={maskLogo()}
          fallback={
            <span class={cx("maker-logo maker-logo-monogram", props.class)} aria-hidden="true">
              {CREDIT_MODEL_MAKERS[props.maker].slice(0, 1)}
            </span>
          }
        >
          {(src) => (
            <span
              class={cx("maker-logo maker-logo-mono", props.class)}
              style={{ "--maker-logo": `url("${src()}")` }}
              aria-hidden="true"
            />
          )}
        </Show>
      }
    >
      {(src) => <img class={cx("maker-logo", props.class)} src={src()} alt="" aria-hidden="true" />}
    </Show>
  );
}
