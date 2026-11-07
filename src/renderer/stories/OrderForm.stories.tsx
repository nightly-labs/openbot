import { Button } from "@openbot/ui";
import { OrderForm, type OrderFormOrder } from "@openbot/ui/features/billing/OrderForm";
import { useText } from "@openbot/ui/text";
import type { Accessor } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { MOCK_HOSTED_SERVER_CATALOG } from "../src/preview/mock-hosted-servers";

/** The shared order form of the pricing page and of Billing. */
function OrderFormStory(props: {
  withServers: boolean;
  currency?: "eur" | "usd" | "pln";
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

/** A server and a Team license, in euro, for a visitor in the EU. */
export const ServerAndLicense: Story = { args: { withServers: true, currency: "eur", inEu: true } };

/** No server catalog: the form sells only the license. */
export const LicenseOnly: Story = { args: { withServers: false, currency: "eur" } };

/** The account pays for a server already, so each license has the bundle price. */
export const OwnedServer: Story = { args: { withServers: true, currency: "eur", ownedServer: true } };

/** 3 people use the account's servers: Starter is not available, and Team starts at 5 members. */
export const ThreeMembers: Story = { args: { withServers: true, currency: "eur", used: 3 } };

/** An account that pays in złoty cannot change the currency. */
export const Pln: Story = { args: { withServers: true, currency: "pln", currencyLocked: true } };

/** A promotion: a license bought now is free until 1 December. */
export const LicenseTrial: Story = {
  args: { withServers: true, currency: "eur", inEu: true, licenseTrialEnd: Date.UTC(2026, 11, 1) },
};
