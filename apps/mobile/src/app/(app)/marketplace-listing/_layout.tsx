import { SheetPageStack } from "@/shared/components/sheet-page-stack";

export const unstable_settings = { anchor: "index" };

/** The page sets its title, the listing's name. Empty until then, so the route name never shows. */
export default function MarketplaceListingLayout() {
  return <SheetPageStack title="" />;
}
