/**
 * plaid-exchange-token
 *
 * Exchanges a Plaid public_token (from Link success callback) for a permanent
 * access_token + item_id, then persists to plaid_items.
 *
 * Also runs a secondary check on max 3 linked institutions (defense-in-depth
 * alongside plaid-create-link-token).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, getClientIp, rateLimitedResponse } from "../_shared/rate-limit.ts";

const MAX_LINKED  = 3;
const RATE_LIMIT  = { windowMs: 60_000, max: 10 };

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const ip = getClientIp(req);
  const rl = await checkRateLimit(supabase, `${ip}:plaid-exchange`, RATE_LIMIT);
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

    // Premium gate
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

    // Defense-in-depth max-3 check
    const { count } = await supabase
      .from("plaid_items")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if ((count ?? 0) >= MAX_LINKED) {
      return new Response(JSON.stringify({ error: `Maximum ${MAX_LINKED} linked institutions allowed` }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse body
    let public_token: string;
    let institution_id: string | null = null;
    let institution_name: string | null = null;
    try {
      const body = await req.json();
      public_token     = body.public_token;
      institution_id   = body.institution_id   ?? null;
      institution_name = body.institution_name ?? null;
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!public_token) {
      return new Response(JSON.stringify({ error: "public_token required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Exchange public_token → access_token + item_id
    const exchangeRes = await fetch(`${plaidBase}/item/public_token/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, public_token }),
    });
    const exchangeBody = await exchangeRes.json();
    if (!exchangeRes.ok) {
      console.error("Plaid exchange error:", JSON.stringify(exchangeBody));
      return new Response(JSON.stringify({ error: exchangeBody.error_message ?? "Plaid exchange failed" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { access_token, item_id } = exchangeBody;

    // Resolve institution name if not passed from Link metadata
    if (!institution_name && institution_id) {
      try {
        const instRes = await fetch(`${plaidBase}/institutions/get_by_id`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: PLAID_CLIENT_ID,
            secret: PLAID_SECRET,
            institution_id,
            country_codes: ["US"],
          }),
        });
        const instBody = await instRes.json();
        institution_name = instBody.institution?.name ?? null;
      } catch {
        // Non-fatal — institution_name just stays null
      }
    }

    // Persist to plaid_items (service role bypasses RLS)
    const { error: insertErr } = await supabase.from("plaid_items").upsert({
      user_id: userId,
      plaid_item_id: item_id,
      access_token,
      institution_id,
      institution_name,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,plaid_item_id" });

    if (insertErr) {
      console.error("plaid_items insert error:", insertErr.message);
      return new Response(JSON.stringify({ error: "Failed to save linked bank" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ institution_name, item_id }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("plaid-exchange-token:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
