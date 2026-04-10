/**
 * Database-backed sliding-window rate limiter for Supabase Edge Functions.
 *
 * State is stored in the `rate_limits` table via the `rate_limit_check`
 * Postgres function. The table has RLS enabled with no policies and all
 * table/function privileges revoked from `anon` and `authenticated` —
 * only the service role key used here can write to it.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface RateLimitConfig {
  /** Time window length in milliseconds. */
  windowMs: number;
  /** Maximum requests allowed within the window. */
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** JS timestamp (ms) when the current window resets. */
  resetAt: number;
}

/**
 * Atomically check and increment the rate limit counter for `key`.
 * Calls the `rate_limit_check` Postgres function via the service role client.
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const { data, error } = await supabase.rpc("rate_limit_check", {
    p_key: key,
    p_window_ms: config.windowMs,
    p_max: config.max,
  });

  if (error || !data || data.length === 0) {
    // On DB error, fail open so a Supabase hiccup doesn't block all requests.
    console.error("rate_limit_check error:", error?.message ?? "no data");
    return { allowed: true, remaining: config.max, resetAt: Date.now() + config.windowMs };
  }

  const row = data[0] as { allowed: boolean; remaining: number; reset_at: string };
  return {
    allowed: row.allowed,
    remaining: row.remaining,
    resetAt: new Date(row.reset_at).getTime(),
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
      "Retry-After": String(Math.max(retryAfterSec, 1)),
      "X-RateLimit-Limit": String(config.max),
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
    },
  });
}
