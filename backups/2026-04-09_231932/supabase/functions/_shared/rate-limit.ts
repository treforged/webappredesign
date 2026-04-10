/**
 * In-memory sliding-window rate limiter for Supabase Edge Functions.
 *
 * State is per-isolate — good enough for abuse prevention on a small app.
 * Entries are pruned on every check to avoid unbounded memory growth.
 */

interface Entry {
  count: number;
  windowStart: number;
}

const store = new Map<string, Entry>();

export interface RateLimitConfig {
  /** Time window length in milliseconds. */
  windowMs: number;
  /** Maximum requests allowed within the window. */
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Unix timestamp (ms) when the current window resets. */
  resetAt: number;
}

/** Prune entries whose windows have already expired. */
function prune(windowMs: number): void {
  const cutoff = Date.now() - windowMs;
  for (const [key, entry] of store) {
    if (entry.windowStart < cutoff) store.delete(key);
  }
}

export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): RateLimitResult {
  const now = Date.now();

  // Periodically clean up expired entries (every ~100 checks via size heuristic)
  if (store.size > 100) prune(config.windowMs);

  const entry = store.get(key);

  if (!entry || now - entry.windowStart >= config.windowMs) {
    store.set(key, { count: 1, windowStart: now });
    return {
      allowed: true,
      remaining: config.max - 1,
      resetAt: now + config.windowMs,
    };
  }

  entry.count += 1;
  const resetAt = entry.windowStart + config.windowMs;

  if (entry.count > config.max) {
    return { allowed: false, remaining: 0, resetAt };
  }

  return {
    allowed: true,
    remaining: config.max - entry.count,
    resetAt,
  };
}

/**
 * Extract the real client IP from standard proxy headers.
 * Falls back to "unknown" if none are present.
 */
export function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

/**
 * Build a 429 Too Many Requests response with standard rate-limit headers.
 */
export function rateLimitedResponse(
  corsHeaders: Record<string, string>,
  config: RateLimitConfig,
  resetAt: number,
): Response {
  const retryAfterSec = Math.ceil((resetAt - Date.now()) / 1000);
  return new Response(JSON.stringify({ error: "Too many requests" }), {
    status: 429,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Retry-After": String(retryAfterSec),
      "X-RateLimit-Limit": String(config.max),
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
    },
  });
}
