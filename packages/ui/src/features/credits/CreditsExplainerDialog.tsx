import type { BillingCurrency } from "@openbot/contracts/billing";
import { type CreditMediaModel, creditModelCostsLive } from "@openbot/contracts/credit-media";
import {
  CREDIT_CLIP_SECONDS,
  CREDIT_MODEL_COSTS,
  CREDIT_WELCOME,
  type CreditModelCost,
  creditModelCharge,
  creditStopPrice,
  creditStops,
} from "@openbot/contracts/credits";
import type { AppTextKey } from "@openbot/i18n";
import {
  ArrowRight,
  AudioLines,
  Button,
  CalendarClock,
  Dialog,
  Film,
  Gift,
  IconButton,
  Image,
  MessageCircle,
  X,
} from "@openbot/ui";
import { RollingPrice } from "@openbot/ui/rolling-price";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import { formatMinorMoney } from "../billing/money";
import { CreditIcon } from "./CreditIcon";
import { MakerLogo } from "./MakerLogo";
import "./credits-explainer.css";

const EXAMPLE_MODEL_IDS = ["gpt-image-2.6", "nano-banana-pro", "seedance-2.5", "veo-3.1"];

interface ChargeRange {
  min: number;
  max: number;
}

interface CreditPrices {
  all: readonly CreditModelCost[];
  examples: readonly CreditModelCost[];
  topExample: number;
  picture: ChargeRange;
  video: ChargeRange;
}

function chargeRange(costs: readonly CreditModelCost[], kind: CreditModelCost["kind"]): ChargeRange {
  const charges = costs.filter((model) => model.kind === kind).map(creditModelCharge);
  if (charges.length === 0) return chargeRange(CREDIT_MODEL_COSTS, kind);
  return { min: Math.min(...charges), max: Math.max(...charges) };
}

function exampleModels(costs: readonly CreditModelCost[]): CreditModelCost[] {
  return EXAMPLE_MODEL_IDS.flatMap((id) => {
    const model = costs.find((entry) => entry.modelId === id);
    return model ? [model] : [];
  });
}

function creditPrices(live: readonly CreditMediaModel[] | undefined): CreditPrices {
  const models = live && live.length > 0 ? live : undefined;
  const all = models ? creditModelCostsLive(models) : CREDIT_MODEL_COSTS;
  const available = models ? new Set(models.map((model) => model.id)) : undefined;
  const ranged = available ? all.filter((model) => available.has(model.modelId)) : all;
  const liveExamples = exampleModels(ranged);
  const examples = liveExamples.length > 0 ? liveExamples : exampleModels(CREDIT_MODEL_COSTS);
  return {
    all,
    examples,
    topExample: Math.max(...examples.map(creditModelCharge)),
    picture: chargeRange(ranged, "image"),
    video: chargeRange(ranged, "video"),
  };
}

function useCredits() {
  const { format } = useText();
  return (value: number) => format.number(value, { maximumFractionDigits: 1 });
}

function barShare(model: CreditModelCost, top: number): number {
  return Math.sqrt(creditModelCharge(model) / top);
}

const ORBIT = [
  { key: "picture", icon: () => <Image /> },
  { key: "video", icon: () => <Film /> },
  { key: "voice", icon: () => <AudioLines /> },
] as const;

function SceneMedia() {
  return (
    <div class="credits-explainer-orbit">
      <span class="credits-explainer-orbit-path" />
      <span class="credits-explainer-orbit-ring">
        <For each={ORBIT}>
          {(item, index) => (
            <span class="credits-explainer-orbit-item" data-kind={item.key} style={{ "--item": index() }}>
              <span class="credits-explainer-orbit-tile">{item.icon()}</span>
            </span>
          )}
        </For>
      </span>
      <span class="credits-explainer-orb">
        <span class="credits-explainer-orb-glow" />
        <CreditIcon tile class="credits-explainer-orb-tile" />
      </span>
    </div>
  );
}

function SceneChat() {
  const { t } = useText();
  return (
    <div class="credits-explainer-thread">
      <span class="credits-explainer-thread-bubble" data-side="user">
        <span class="credits-explainer-thread-line" style={{ "--line": "72%" }} />
        <span class="credits-explainer-thread-line" style={{ "--line": "48%" }} />
      </span>
      <span class="credits-explainer-thread-bubble" data-side="agent">
        <span class="credits-explainer-thread-line" style={{ "--line": "88%" }} />
        <span class="credits-explainer-thread-line" style={{ "--line": "100%" }} />
        <span class="credits-explainer-thread-line" style={{ "--line": "60%" }} />
      </span>
      <span class="credits-explainer-zero">
        <MessageCircle />
        {t("billing.credits.explainer.chatFree")}
      </span>
    </div>
  );
}

function SceneModels(props: { prices: CreditPrices }) {
  const { t } = useText();
  const credits = useCredits();
  const unit = (model: CreditModelCost) =>
    model.unit === "clip"
      ? t("billing.credits.explainer.perClip", { seconds: CREDIT_CLIP_SECONDS })
      : t("billing.credits.explainer.perPicture");
  return (
    <ul class="credits-explainer-bars">
      <For each={props.prices.examples}>
        {(model, index) => (
          <li style={{ "--item": index(), "--share": barShare(model, props.prices.topExample) }}>
            <span class="credits-explainer-bar-name">
              <MakerLogo maker={model.maker} class="credits-explainer-maker" />
              <span>{model.name}</span>
            </span>
            <span class="credits-explainer-bar-track">
              <span class="credits-explainer-bar-fill" data-kind={model.kind} />
            </span>
            <span class="credits-explainer-bar-cost">
              <CreditIcon />
              {credits(creditModelCharge(model))}
              <span class="credits-explainer-bar-unit">{unit(model)}</span>
            </span>
          </li>
        )}
      </For>
    </ul>
  );
}

function SceneGet(props: { currency: BillingCurrency }) {
  const { t, format } = useText();
  const credits = useCredits();
  const starter = () => creditStops(props.currency)[0];
  const [shown, setShown] = createSignal(0);
  onSettled(() => {
    const frame = requestAnimationFrame(() => setShown(starter()?.credits ?? 0));
    return () => cancelAnimationFrame(frame);
  });
  const price = () => {
    const stop = starter();
    return stop ? formatMinorMoney(format, creditStopPrice(stop, props.currency), props.currency) : "";
  };
  return (
    <div class="credits-explainer-get">
      <span class="credits-explainer-pack">
        <span class="credits-explainer-pack-price">{price()}</span>
        <ArrowRight class="credits-explainer-pack-arrow" />
        <span class="credits-explainer-pack-credits">
          <CreditIcon />
          <RollingPrice class="credits-explainer-pack-number" value={shown()} format={credits} />
        </span>
      </span>
      <span class="credits-explainer-gifts">
        <span class="credits-explainer-gift">
          <Gift />
          {t("billing.credits.explainer.welcome", { amount: credits(CREDIT_WELCOME) })}
        </span>
        <span class="credits-explainer-gift">
          <CalendarClock />
          {t("billing.credits.explainer.freeEnd")}
        </span>
      </span>
    </div>
  );
}

type Scene = "media" | "chat" | "models" | "get";

const PAGES = [
  { scene: "media", title: "billing.credits.explainer.mediaTitle" },
  { scene: "chat", title: "billing.credits.explainer.chatTitle" },
  { scene: "models", title: "billing.credits.explainer.modelsTitle" },
  { scene: "get", title: "billing.credits.explainer.getTitle" },
] as const satisfies readonly { scene: Scene; title: AppTextKey }[];

const PLAIN_TEXT = {
  media: "billing.credits.explainer.mediaText",
  chat: "billing.credits.explainer.chatText",
  get: "billing.credits.explainer.getText",
} as const satisfies Record<Exclude<Scene, "models">, AppTextKey>;

function PageText(props: { scene: Scene; prices: CreditPrices }) {
  const { t } = useText();
  const credits = useCredits();
  const text = () => {
    const scene = props.scene;
    if (scene !== "models") return t(PLAIN_TEXT[scene]);
    return t("billing.credits.explainer.modelsText", {
      pictureMin: credits(props.prices.picture.min),
      pictureMax: credits(props.prices.picture.max),
      seconds: CREDIT_CLIP_SECONDS,
      videoMin: credits(props.prices.video.min),
      videoMax: credits(props.prices.video.max),
    });
  };
  return <>{text()}</>;
}

function SceneView(props: { scene: Scene; currency: BillingCurrency; prices: CreditPrices }) {
  return (
    <>
      <Show when={props.scene === "media"}>
        <SceneMedia />
      </Show>
      <Show when={props.scene === "chat"}>
        <SceneChat />
      </Show>
      <Show when={props.scene === "models"}>
        <SceneModels prices={props.prices} />
      </Show>
      <Show when={props.scene === "get"}>
        <SceneGet currency={props.currency} />
      </Show>
    </>
  );
}

type Direction = "next" | "back";

function createStepper(count: number, onFinish: () => void) {
  const [page, setPage] = createSignal(0);
  const [direction, setDirection] = createSignal<Direction>("next");
  const go = (target: number) => {
    if (target < 0 || target >= count || target === page()) return;
    setDirection(target > page() ? "next" : "back");
    setPage(target);
  };
  const last = () => page() === count - 1;
  return {
    page,
    direction,
    last,
    go,
    next: () => {
      if (last()) onFinish();
      else go(page() + 1);
    },
    back: () => go(page() - 1),
  };
}

export interface CreditsExplainerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency?: BillingCurrency | undefined;
  onOpenPrices?: (() => void) | undefined;
  models?: readonly CreditMediaModel[] | undefined;
}

export function CreditsExplainerDialog(props: CreditsExplainerDialogProps) {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay>
          <ExplainerContent
            currency={props.currency ?? "eur"}
            onClose={() => props.onOpenChange(false)}
            onOpenPrices={props.onOpenPrices}
            models={props.models}
          />
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ExplainerContent(props: {
  currency: BillingCurrency;
  onClose: () => void;
  onOpenPrices: (() => void) | undefined;
  models: readonly CreditMediaModel[] | undefined;
}) {
  const { t, format } = useText();
  const prices = createMemo(() => creditPrices(props.models));
  const stepper = createStepper(PAGES.length, props.onClose);
  const current = () => PAGES[stepper.page()] ?? PAGES[0];
  let primary: HTMLButtonElement | undefined;
  const back = () => {
    const toFirst = stepper.page() === 1;
    stepper.back();
    if (toFirst) requestAnimationFrame(() => primary?.focus());
  };
  const keys = (event: KeyboardEvent) => {
    if (event.key === "ArrowRight" && !stepper.last()) stepper.next();
    if (event.key === "ArrowLeft") back();
  };
  return (
    <Dialog.Content
      as="section"
      class="hosted-upsell-modal credits-explainer"
      data-scene={current().scene}
      data-direction={stepper.direction()}
      onKeyDown={keys}
    >
      <span class="credits-explainer-close">
        <IconButton label={t("common.close")} variant="ghost" onClick={props.onClose}>
          <X />
        </IconButton>
      </span>
      <Show when={current()} keyed>
        {(page) => (
          <>
            <div class="credits-explainer-scene">
              <div class="credits-explainer-scene-in" aria-hidden="true">
                <SceneView scene={page.scene} currency={props.currency} prices={prices()} />
              </div>
              <Show when={page.scene === "models" && props.onOpenPrices}>
                {(openPrices) => (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    class="credits-explainer-prices"
                    onClick={() => openPrices()()}
                  >
                    {t("billing.credits.explainer.allPrices", {
                      count: format.number(prices().all.length),
                    })}
                    <ArrowRight aria-hidden="true" />
                  </Button>
                )}
              </Show>
            </div>
            <div class="credits-explainer-text">
              <span class="credits-explainer-kicker">
                <CreditIcon />
                {t("billing.credits.explainer.title")}
                <span class="credits-explainer-count">
                  {t("billing.credits.explainer.page", { page: stepper.page() + 1, total: PAGES.length })}
                </span>
              </span>
              <Dialog.Title as="h2" class="credits-explainer-title">
                {t(page.title)}
              </Dialog.Title>
              <Dialog.Description class="credits-explainer-lead">
                <PageText scene={page.scene} prices={prices()} />
              </Dialog.Description>
            </div>
          </>
        )}
      </Show>
      <footer class="credits-explainer-foot">
        <ol class="credits-explainer-dots" aria-label={t("billing.credits.explainer.pages")}>
          <For each={PAGES}>
            {(item, index) => (
              <li>
                <Button
                  type="button"
                  variant="link"
                  class="credits-explainer-dot"
                  aria-label={t(item.title)}
                  aria-current={index() === stepper.page() ? "step" : undefined}
                  data-seen={index() < stepper.page() ? "" : undefined}
                  onClick={() => stepper.go(index())}
                />
              </li>
            )}
          </For>
        </ol>
        <span class="credits-explainer-buttons">
          <Show when={stepper.page() > 0}>
            <Button type="button" variant="ghost" onClick={back}>
              {t("common.back")}
            </Button>
          </Show>
          <Button
            ref={(element: HTMLButtonElement) => {
              primary = element;
            }}
            type="button"
            class="credits-explainer-primary"
            onClick={stepper.next}
          >
            <Show when={stepper.last()} fallback={t("billing.credits.explainer.next")}>
              {t("billing.credits.explainer.gotIt")}
            </Show>
          </Button>
        </span>
      </footer>
    </Dialog.Content>
  );
}
