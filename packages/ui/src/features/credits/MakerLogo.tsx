import { CREDIT_MODEL_MAKERS, type CreditModelMaker } from "@openbot/contracts/credits";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { cx } from "../../utils";
import alibabaLogo from "./maker-logos/alibaba.svg";
import bflLogo from "./maker-logos/bfl.svg";
import bytedanceLogo from "./maker-logos/bytedance.svg";
import googleLogo from "./maker-logos/google.svg";
import ideogramLogo from "./maker-logos/ideogram.svg";
import klingLogo from "./maker-logos/kling.svg";
import metaLogo from "./maker-logos/meta.svg";
import minimaxLogo from "./maker-logos/minimax.svg";
import openaiLogo from "./maker-logos/openai.svg";
import pixverseLogo from "./maker-logos/pixverse.svg";
import recraftLogo from "./maker-logos/recraft.svg";
import syncLogo from "./maker-logos/sync.svg";
import tencentLogo from "./maker-logos/tencent.svg";
import viduLogo from "./maker-logos/vidu.svg";
import xaiLogo from "./maker-logos/xai.svg";
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

const isCreditModelMaker = (value: string): value is CreditModelMaker => Object.hasOwn(CREDIT_MODEL_MAKERS, value);

const MAKER_BY_NAME = new Map(
  Object.keys(CREDIT_MODEL_MAKERS)
    .filter(isCreditModelMaker)
    .map((key) => [CREDIT_MODEL_MAKERS[key].toLowerCase(), key]),
);

export function creditModelMakerNamed(name: string): CreditModelMaker | undefined {
  return MAKER_BY_NAME.get(name.trim().toLowerCase());
}

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
