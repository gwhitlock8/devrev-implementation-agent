const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const ESC = "\x1b[";
const CLEAR_LINE = `${ESC}2K\r`;

export type ProgressOptions = {
  /** Force enable/disable the animated spinner. Default: only in TTYs. */
  enabled?: boolean;
  /** Stream to write to. Default: process.stderr (so stdout stays clean for pipes). */
  stream?: NodeJS.WriteStream;
};

/**
 * Lightweight in-place spinner + status lines. No deps. Use:
 *   const p = new Progress();
 *   p.start("Synthesizing blueprint");
 *   p.info("→ looking up Acme");
 *   p.update("Validating");
 *   p.succeed("Plan built");
 */
export class Progress {
  private label = "";
  private frame = 0;
  private timer: NodeJS.Timeout | null = null;
  private readonly stream: NodeJS.WriteStream;
  private readonly enabled: boolean;

  constructor(opts: ProgressOptions = {}) {
    this.stream = opts.stream ?? process.stderr;
    this.enabled = opts.enabled ?? Boolean(this.stream.isTTY);
  }

  start(label: string): void {
    this.label = label;
    if (!this.enabled) {
      this.stream.write(`… ${label}\n`);
      return;
    }
    this.tick();
    this.timer = setInterval(() => this.tick(), 80);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  update(label: string): void {
    this.label = label;
    if (!this.enabled) {
      this.stream.write(`… ${label}\n`);
    }
  }

  /** Print a one-line note above the spinner (cleared and re-drawn). */
  info(line: string): void {
    if (!this.enabled) {
      this.stream.write(`  ${line}\n`);
      return;
    }
    this.clearLine();
    this.stream.write(`  ${line}\n`);
    this.tick();
  }

  succeed(label?: string): void {
    this.stop();
    this.stream.write(`✓ ${label ?? this.label}\n`);
  }

  fail(label?: string): void {
    this.stop();
    this.stream.write(`✗ ${label ?? this.label}\n`);
  }

  /** Stop the spinner without printing a final status line. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.enabled) this.clearLine();
  }

  private tick(): void {
    if (!this.enabled) return;
    const frame = FRAMES[this.frame++ % FRAMES.length];
    this.clearLine();
    this.stream.write(`${frame} ${this.label}`);
  }

  private clearLine(): void {
    this.stream.write(CLEAR_LINE);
  }
}
