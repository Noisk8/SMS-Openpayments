/** Utilidades de tiempo. Todas las fechas se guardan como ISO-8601 UTC. */

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoPlusMs(ms: number, from: Date = new Date()): string {
  return new Date(from.getTime() + ms).toISOString();
}

export function isoPlusSeconds(seconds: number, from: Date = new Date()): string {
  return isoPlusMs(seconds * 1000, from);
}

export function isPast(iso: string, now: Date = new Date()): boolean {
  return Date.parse(iso) <= now.getTime();
}
