/**
 * plaid-sync
 *
 * Phase 4.4 — triggered manually (button) or on login; cron every 12hr is a
 * separate Supabase scheduled task (not implemented here).
 *
 * For each of the user's linked Plaid items:
 *   1. Calls /accounts/balance/get to get current balances
 *   2. Upserts into the accounts table (keyed on user_id + plaid_account_id)
 *   3. Updates last_synced_at on the plaid_items row
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, getClientIp, rateLimitedResponse } from "../_shared/rate-limit.ts";

const RATE_LIMIT = { windowMs: 60_000, max: 20 };

// Map Plaid account type/subtype → our account_type enum
function mapPlaidType(type: string, subtype: string | null): string {
  if (type === "depository") {
    if (subtype === "savings" || subtype === "money market") return "savings";
    if (subtype === "cd")           return "savings";
    return "checking";
  }
  if (type === "credit")     return "credit_card";
  if (type === "investment")  return "brokerage";
  if (type === "loan") {
    if (subtype === "auto" || subtype === "auto loan") return "auto_loan";
    if (subtype === "student")                         return "student_loan";
    return "other_liability";
  }
  return "other_asset";
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const ip = getClientIp(req);
  const rl = await checkRateLimit(supabase, `${ip}:plaid-sync`, RATE_LIMIT);
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

    // Fetch all plaid items for user (service role reads access_token)
    const { data: plaidItems, error: itemsErr } = await supabase
      .from("plaid_items")
      .select("id, plaid_item_id, access_token, institution_name")
      .eq("user_id", userId);

    if (itemsErr) throw new Error(itemsErr.message);
    if (!plaidItems || plaidItems.length === 0) {
      return new Response(JSON.stringify({ synced: 0, accounts: [] }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date().toISOString();
    const syncedAccounts: any[] = [];

    for (const item of plaidItems) {
      // Get current balances from Plaid
      const balRes = await fetch(`${plaidBase}/accounts/balance/get`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: PLAID_CLIENT_ID,
          secret:    PLAID_SECRET,
          access_token: item.access_token,
        }),
      });
      const balBody = await balRes.json();

      if (!balRes.ok) {
        console.error(`Balance fetch failed for item ${item.plaid_item_id}:`, JSON.stringify(balBody));
        continue; // skip this item, sync others
      }

      const plaidAccounts: any[] = balBody.accounts ?? [];

      for (const acct of plaidAccounts) {
        // Plaid credit card balance: current = amount owed (positive), we store as positive
        // Plaid depository: current = available cash balance
        const balance = Math.abs(Number(acct.balances?.current ?? 0));
        const creditLimit = acct.balances?.limit != null ? Number(acct.balances.limit) : null;

        const payload = {
          user_id:          userId,
          name:             acct.official_name || acct.name,
          institution:      item.institution_name ?? "",
          account_type:     mapPlaidType(acct.type, acct.subtype),
          balance,
          credit_limit:     creditLimit,
          apr:              null,
          active:           true,
          plaid_account_id: acct.account_id,
          plaid_item_id:    item.plaid_item_id,
          updated_at:       now,
        };

        const { error: upsertErr } = await supabase
          .from("accounts")
          .upsert(payload, { onConflict: "user_id,plaid_account_id" });

        if (upsertErr) {
          console.error("Account upsert error:", upsertErr.message);
        } else {
          syncedAccounts.push({ name: payload.name, balance, type: payload.account_type });
        }
      }

      // Update last_synced_at on the plaid_items row
      await supabase
        .from("plaid_items")
        .update({ last_synced_at: now, updated_at: now })
        .eq("id", item.id);
    }

    return new Response(JSON.stringify({ synced: syncedAccounts.length, accounts: syncedAccounts }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("plaid-sync:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
