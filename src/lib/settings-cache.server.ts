// A few seconds of sharing for settings that every booking reads several times.
//
// On Cloudflare's free plan one request may make at most 50 calls to the
// database. A booking checks the booking rules and the stylist rules from
// several places; reading them once and sharing the result for a few seconds
// keeps a booking well under that limit. Every save of a cached setting calls
// forgetSetting(), so admin changes show at once on this server instance (other
// instances pick them up within the TTL).

const TTL_MS = 10_000;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

/** Returns the cached value for `key` (a fresh copy), loading it when missing or stale. */
export async function cachedSetting<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > TTL_MS) {
    const value = load();
    cache.set(key, { at: Date.now(), value });
    value.catch(() => {
      if (cache.get(key)?.value === value) cache.delete(key);
    });
  }
  return structuredClone((await cache.get(key)!.value) as T);
}

/** Forget a cached setting (call after saving it). */
export function forgetSetting(key: string) {
  cache.delete(key);
}
