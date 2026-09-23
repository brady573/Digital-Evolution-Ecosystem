import type { RenderSnapshot, RuntimeCommand } from "@digital-evolution/contracts";

export interface RuntimeClient {
  command(command: RuntimeCommand): void;
  subscribe(listener: (snapshot: RenderSnapshot) => void): () => void;
}

/**
 * Replaced with a real module-worker implementation after sim-core parity.
 */
export const RUNTIME_MIGRATION_PENDING = true as const;
