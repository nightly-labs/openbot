import { Context, Layer } from "effect";
import type { WorkerBindings } from "./types";

/** Worker storage bindings belong to the request that created the marketplace. */
export class MarketplaceStorage extends Context.Service<MarketplaceStorage, Pick<WorkerBindings, "DB" | "SKILLS">>()(
  "@openbot/auth-api/MarketplaceStorage",
) {
  static layer(bindings: Pick<WorkerBindings, "DB" | "SKILLS">) {
    return Layer.succeed(MarketplaceStorage, bindings);
  }
}
