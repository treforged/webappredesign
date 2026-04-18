import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "https://app.treforged.com",
  "https://treforged.com",
  "http://localhost:8080",
  "http://localhost:3000",
  "http://localhost:5173",
]);

function getCorsHeaders(req: Request): Record<string, string> {
  const requestOrigin = req.headers.get("origin") ?? "";
  const allowedOrigin = ALLOWED_ORIGINS.has(requestOrigin) ? requestOrigin : "https://app.treforged.com";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-trace-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function mapPlaidType(type: string, subtype: string | null): string {
  if (type === "depository") {
    if (subtype === "hsa")                             return "hsa";
    if (subtype === "savings" || subtype === "money market") return "savings";
    if (subtype === "cd")                              return "savings";
    return "checking";
  }
  if (type === "credit")     return "credit_card";
  if (type === "investment") return "brokerage";
  if (type === "loan") {
    if (subtype === "auto" || subtype === "auto loan") return "auto_loan";
    if (subtype === "student")                         return "student_loan";
    return "other_liability";
  }
  return "other_asset";
}

/** Parse APR % from Plaid account names like "12.5% APR Interest Credit Card" */
function parseAprFromName(name: string): number | null {
  const m = name.match(/(\d+(?:\.\d+)?)\s*%\s*APR/i);
  return m ? parseFloat(m[1]) : null;
}

/** Minimum payment: max($25, ceil(1% of balance + monthly interest)) */
function calcMinPayment(balance: number, apr: number): number {
  if (balance <= 0) return 0;
  const interest = (balance * (apr / 100)) / 12;
  return Math.max(25, Math.ceil(balance * 0.01 + interest));
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

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
      console.error("getUser failed:", jwtErr?.message);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

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
    const SYNC_COOLDOWN_MS = 23.5 * 60 * 60 * 1000; // 23.5 hours — prevents reconnect abuse
    const syncedAccounts: any[] = [];

    for (const item of plaidItems) {
      // Rate-limit: if synced within the cooldown window, return existing DB balances instead
      // of calling Plaid. This survives disconnect-reconnect because the check is per-item
      // and last_synced_at persists as long as the item row exists.
      if (item.last_synced_at) {
        const lastSync = new Date(item.last_synced_at).getTime();
        if (Date.now() - lastSync < SYNC_COOLDOWN_MS) {
          const { data: cachedAccounts } = await supabase
            .from("accounts")
            .select("name, balance, account_type, plaid_account_id")
            .eq("user_id", userId)
            .eq("plaid_item_id", item.plaid_item_id);
          for (const acct of (cachedAccounts ?? [])) {
            syncedAccounts.push({ name: acct.name, balance: acct.balance, type: acct.account_type, plaid_account_id: acct.plaid_account_id });
          }
          continue; // skip Plaid API call for this item
        }
      }

      const balRes = await fetch(`${plaidBase}/accounts/balance/get`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, access_token: item.access_token }),
      });
      const balBody = await balRes.json();

      if (!balRes.ok) {
        console.error(`Balance fetch failed for item ${item.plaid_item_id}:`, JSON.stringify(balBody));
        continue;
      }

      const plaidAccounts: any[] = balBody.accounts ?? [];
      console.log(`Got ${plaidAccounts.length} accounts for item ${item.plaid_item_id}`);

      for (const acct of plaidAccounts) {
        const balance = Math.abs(Number(acct.balances?.current ?? 0));
        const creditLimit = acct.balances?.limit != null ? Number(acct.balances.limit) : null;
        const accountType = mapPlaidType(acct.type, acct.subtype);
        const name = acct.official_name || acct.name;
        // APR: parse from name (Plaid embeds it in sandbox; real accounts: null until user corrects)
        const apr = accountType === "credit_card" ? parseAprFromName(name) : null;

        // Select-then-update-or-insert to avoid partial index conflict issue with PostgREST
        const { data: existing } = await supabase
          .from("accounts")
          .select("id, apr")
          .eq("user_id", userId)
          .eq("plaid_account_id", acct.account_id)
          .maybeSingle();

        let opErr;
        if (existing) {
          // Preserve user-set APR if Plaid name doesn't contain one
          const effectiveApr = apr ?? (existing as any).apr ?? null;
          const { error } = await supabase
            .from("accounts")
            .update({
              balance,
              credit_limit: creditLimit,
              name,
              institution: item.institution_name ?? "",
              account_type: accountType,
              apr: effectiveApr,
              active: true,
              plaid_item_id: item.plaid_item_id,
              updated_at: now,
            })
            .eq("id", existing.id);
          opErr = error;
        } else {
          const { error } = await supabase
            .from("accounts")
            .insert({
              user_id: userId,
              name,
              institution: item.institution_name ?? "",
              account_type: accountType,
              balance,
              credit_limit: creditLimit,
              apr,
              active: true,
              plaid_account_id: acct.account_id,
              plaid_item_id: item.plaid_item_id,
              updated_at: now,
            });
          opErr = error;
        }

        if (opErr) {
          console.error("Account sync error for", acct.account_id, ":", opErr.message);
        } else {
          syncedAccounts.push({ name, balance, type: accountType, plaid_account_id: acct.account_id });
        }
      }

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
