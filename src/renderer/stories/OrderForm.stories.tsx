import type { BillingCurrency } from "@openbot/contracts/billing";
import { Button } from "@openbot/ui";
import { OrderForm, type OrderFormOrder } from "@openbot/ui/features/billing/OrderForm";
import { useText } from "@openbot/ui/text";
import type { Accessor } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { MOCK_HOSTED_SERVER_CATALOG } from "../src/preview/mock-hosted-servers";

function OrderFormStory(props: {
  withServers: boolean;
  currency?: BillingCurrency;
  currencyLocked?: boolean;
  ownedServer?: boolean;
  used?: number;
  inEu?: boolean;
  licenseTrialEnd?: number;
}) {
  const action = (order: Accessor<OrderFormOrder>) => <OrderAction order={order} />;
  const contact = () => <ContactAction />;
  return (
    <main class="foundation-story">
      <OrderForm
        plans={props.withServers ? MOCK_HOSTED_SERVER_CATALOG.plans : []}
        currency={props.currency}
        currencyLocked={props.currencyLocked}
        ownedServer={props.ownedServer}
        used={props.used}
        inEu={props.inEu}
        licenseTrialEnd={props.licenseTrialEnd}
        initialServer={props.withServers ? "standard" : null}
        initialLicense="team"
        action={action}
        contact={contact}
      />
    </main>
  );
}

function OrderAction(props: { order: Accessor<OrderFormOrder> }) {
  const { t } = useText();
  return (
    <Button type="button" disabled={props.order().server === null && props.order().license === null}>
      {props.order().server === null ? t("billing.order.cta.license") : t("billing.order.cta.server")}
    </Button>
  );
}

function ContactAction() {
  const { t } = useText();
  return <Button type="button">{t("billing.license.contact.action")}</Button>;
}

const meta = {
  title: "Account/Billing/Order form",
  component: OrderFormStory,
  args: { withServers: true },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof OrderFormStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ServerAndLicense: Story = { args: { withServers: true, currency: "eur", inEu: true } };

export const LicenseOnly: Story = { args: { withServers: false, currency: "eur" } };

export const OwnedServer: Story = { args: { withServers: true, currency: "eur", ownedServer: true } };

export const ThreeMembers: Story = { args: { withServers: true, currency: "eur", used: 3 } };

export const Pln: Story = { args: { withServers: true, currency: "pln", currencyLocked: true } };

export const Brl: Story = { args: { withServers: true, currency: "brl" } };

export const LicenseTrial: Story = {
  args: { withServers: true, currency: "eur", inEu: true, licenseTrialEnd: Date.UTC(2026, 11, 1) },
};
