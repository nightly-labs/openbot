import { BuyCreditsPage } from "@openbot/ui/features/credits/BuyCreditsPage";
import { createCreditsStore } from "@openbot/ui/features/credits/credits-store";
import { appPort } from "../../app-port";
import { useWindowPage } from "./window-page-context";

export function CreditsPage() {
  const windowPage = useWindowPage();
  const store = createCreditsStore(
    () => appPort().credits,
    () => windowPage.page() === "credits",
    windowPage.adoptCredits,
  );
  return (
    <BuyCreditsPage
      store={store}
      initialServerId={windowPage.creditsServerId()}
      headerFrame="window"
      billingDetails={appPort().billing}
      onClose={() => windowPage.showAgents()}
    />
  );
}
