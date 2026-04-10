/**
 * Production-grade CORS helper for Supabase Edge Functions.
 *
 * Only returns the requesting origin in Access-Control-Allow-Origin when it
 * matches the explicit allowlist. Unknown origins receive the first allowed
 * origin (app.treforged.com), which browsers will reject — no wildcard ever
 * reaches production traffic.
 */

const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "https://app.treforged.com",
  "https://treforged.com",
  // Local dev — never matches in production (Vercel strips these)
  "http://localhost:8080",
  "http://localhost:3000",
  "http://localhost:5173",
]);

const PRODUCTION_ORIGIN = "https://app.treforged.com";

/**
 * Returns CORS headers scoped to the requesting origin if it is allowed,
 * or falls back to the production origin (causing browsers to block the
 * request for unrecognised origins).
 */
export function getCorsHeaders(req: Request): Record<string, string> {
  const requestOrigin = req.headers.get("origin") ?? "";
  const allowedOrigin = ALLOWED_ORIGINS.has(requestOrigin)
    ? requestOrigin
    : PRODUCTION_ORIGIN;

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
