/**
 * Layer 1: Memory processor interface.
 * Processors transform raw session data into structured memory.
 * The processed/ directory can be wiped and rebuilt at any time.
 */
export interface MemoryProcessor {
  name: string;

  /**
   * Runtimes this processor is compatible with.
   * An empty array means the processor supports all runtimes.
   */
  supportedRuntimes: readonly ("openclaw" | "picoclaw")[];

  /** Initialize processor-specific resources (dirs, indices, etc.) */
  init(projectDir: string): Promise<void>;

  /** Rebuild processed data from raw Layer 0 data */
  rebuild(projectDir: string, runtimeType?: "openclaw" | "picoclaw"): Promise<void>;
}
