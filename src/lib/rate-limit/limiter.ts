export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Limitador de ventana fija en memoria. Adecuado para una sola instancia.
 * Para varias réplicas sustituir por almacenamiento compartido (p. ej. Redis).
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  consume(key: string): RateLimitResult {
    const current = this.now();
    const entry = this.hits.get(key);
    if (!entry || current - entry.windowStart >= this.windowMs) {
      this.hits.set(key, { count: 1, windowStart: current });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (entry.count >= this.limit) {
      const retryAfterMs = this.windowMs - (current - entry.windowStart);
      return { allowed: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
    }
    entry.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  reset(): void {
    this.hits.clear();
  }
}
