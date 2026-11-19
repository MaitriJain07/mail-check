const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Per-domain politeness: starts of work against the same domain are spaced at least
 * `gapMs` apart, so a 1,000-row list of one provider cannot hammer its mail servers.
 * Different domains do not slow each other down.
 */
export class DomainThrottle {
  private nextSlot = new Map<string, number>();

  constructor(
    private readonly gapMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async run<T>(domain: string, fn: () => Promise<T>): Promise<T> {
    if (this.gapMs > 0) {
      const now = this.now();
      const slot = Math.max(now, this.nextSlot.get(domain) ?? 0);
      this.nextSlot.set(domain, slot + this.gapMs); // reserve synchronously, so concurrent callers queue up
      if (this.nextSlot.size > 5000) this.prune(now);
      if (slot > now) await sleep(slot - now);
    }
    return fn();
  }

  private prune(now: number): void {
    for (const [d, t] of this.nextSlot) if (t <= now) this.nextSlot.delete(d);
  }
}
