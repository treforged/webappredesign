/**
 * plaid-create-link-token
 *
 * Phase 4.1 — gated behind plan_status = active/trialing (premium only)
 * Phase 4.3 — rejects if user already has >= 3 linked institutions
 * Phase 4.5 — enables only `transactions` + `balance` products
 *
 * Required env vars (set in Supabase dashboard → Edge Functions → Secrets):
 *   PLAID_CLIENT_ID
 *   PLAID_SECRET
 *   PLAID_ENV  (sandbox | production)  defaults to sandbox
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, getClientIp, rateLimitedResponse } from "../_shared/rate-limit.ts";

const MAX_LINKED = 3;
const RATE_LIMIT = { windowMs: 60_000, max: 10 };

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Rate limit
  const ip = getClientIp(req);
  const rl = await checkRateLimit(supabase, `${ip}:plaid-link-token`, RATE_LIMIT);
  if (!rl.allowed) return rateLimitedResponse(corsHeaders, RATE_LIMIT, rl.resetAt);

  try {
    const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID");
    const PLAID_SECRET    = Deno.env.get("PLAID_SECRET");
    if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
      return new Response(JSON.stringify({ error: "Plaid not configured" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const plaidEnv  = Deno.env.get("PLAID_ENV") || "sandbox";
    const plaidBase = `https://${plaidEnv}.plaid.com`;

    // Verify JWT
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: jwtErr } = await userClient.auth.getUser();
    if (jwtErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    // 4.1 — Gate: premium only
    const { data: sub } = await supabase
      .from("user_subscriptions")
      .select("plan, subscription_status")
      .eq("user_id", userId)
      .maybeSingle();

    const isActive = sub?.plan === "premium" &&
      ["active", "trialing"].includes(sub?.subscription_status ?? "");
    if (!isActive) {
      return new Response(JSON.stringify({ error: "Premium subscription required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4.3 — Enforce max 3 linked institutions
    const { count } = await supabase
      .from("plaid_items")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    if ((count ?? 0) >= MAX_LINKED) {
      return new Response(JSON.stringify({ error: `Maximum ${MAX_LINKED} linked institutions allowed` }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4.5 — Create link token with only transactions + balance products
    const res = await fetch(`${plaidBase}/link/token/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: PLAID_CLIENT_ID,
        secret:    PLAID_SECRET,
        client_name: "TRE Forged Budget OS",
        country_codes: ["US"],
        language: "en",
        user: { client_user_id: userId },
        products: ["transactions"],
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      console.error("Plaid link/token/create error:", JSON.stringify(body));
      return new Response(JSON.stringify({ error: body.error_message ?? "Plaid error" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ link_token: body.link_token }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("plaid-create-link-token:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
