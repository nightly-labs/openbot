import { Context, Layer } from "effect";
import type { WorkerBindings } from "./types";

export class MarketplaceStorage extends Context.Service<MarketplaceStorage, Pick<WorkerBindings, "DB" | "SKILLS">>()(
  "@openbot/auth-api/MarketplaceStorage",
) {
  static layer(bindings: Pick<WorkerBindings, "DB" | "SKILLS">) {
    return Layer.succeed(MarketplaceStorage, bindings);
  }
}
