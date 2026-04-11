import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import {
  checkRateLimit,
  getClientIp,
  rateLimitedResponse,
  type RateLimitConfig,
} from "../_shared/rate-limit.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createTracer, hashId } from "../_shared/tracer.ts";

// Strict rate limit — account deletion is irreversible
const RATE_LIMIT: RateLimitConfig = { windowMs: 3_600_000, max: 3 };

/**
 * Tables that are fully deleted on account deletion.
 * Order matters: child rows first, then parents.
 */
const USER_TABLES = [
  "account_reconciliations",
  "transactions",
  "net_worth_snapshots",
  "assets",
  "liabilities",
  "budget_items",
  "car_funds",
  "savings_goals",
  "debts",
  "recurring_rules",
  "accounts",
  "profiles",
] as const;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const incomingTraceId = req.headers.get("x-trace-id") ?? undefined;
  const tracer = createTracer("delete-account", incomingTraceId);
  const rootSpan = tracer.startSpan("fn.delete-account", {
    kind: "SERVER",
    attributes: { "http.method": req.method },
  });

  // Service-role client for privileged operations
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // ── Rate limit ────────────────────────────────────────────────────────────
  const ip = getClientIp(req);
  const rl = await checkRateLimit(supabase, `${ip}:delete-account`, RATE_LIMIT);
  if (!rl.allowed) {
    rootSpan.end("ERROR", new Error("rate_limit_exceeded"));
    return rateLimitedResponse(corsHeaders, RATE_LIMIT, rl.resetAt);
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    rootSpan.end("ERROR", new Error("unauthorized"));
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user: authUser }, error: jwtError } = await userClient.auth.getUser();
  if (jwtError || !authUser) {
    rootSpan.end("ERROR", new Error("unauthorized"));
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userId = authUser.id;
  const userHash = await hashId(userId);

  try {
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");

    // ── 1. Fetch billing record (before we delete anything) ────────────────
    const { data: userSub } = await supabase
      .from("user_subscriptions")
      .select("stripe_subscription_id, stripe_customer_id, plan, subscription_status")
      .eq("user_id", userId)
      .maybeSingle();

    // ── 2. Cancel active Stripe subscription immediately ───────────────────
    if (userSub?.stripe_subscription_id && STRIPE_SECRET_KEY) {
      const stripeSpan = tracer.startSpan("stripe.subscriptions.cancel", {
        parentSpanId: rootSpan.spanId,
        kind: "CLIENT",
        attributes: { "peer.service": "stripe" },
      });
      try {
        const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basil" });
        const status = userSub.subscription_status;
        // Only cancel if actually active — don't error on already-cancelled subs
        if (status === "active" || status === "trialing" || status === "past_due") {
          await stripe.subscriptions.cancel(userSub.stripe_subscription_id);
        }
        stripeSpan.end("OK");
      } catch (stripeErr) {
        // Non-fatal: log and continue. Deletion should proceed even if Stripe
        // call fails (e.g. sub already deleted on Stripe side).
        console.error("delete-account: Stripe cancel error:", stripeErr);
        stripeSpan.end("ERROR", stripeErr);
      }
    }

    // ── 3. Anonymize billing record (IRS 7-year retention) ─────────────────
    // We keep the financial columns (Stripe IDs, plan, dates, status) but
    // sever the link to the Supabase auth user by nulling user_id.
    if (userSub) {
      const { error: anonErr } = await supabase
        .from("user_subscriptions")
        .update({ user_id: null, anonymized_at: new Date().toISOString() })
        .eq("user_id", userId);
      if (anonErr) {
        console.error("delete-account: anonymize billing error:", anonErr.message);
      }
    }

    // ── 4. Delete all user data ─────────────────────────────────────────────
    for (const table of USER_TABLES) {
      const deleteSpan = tracer.startSpan(`db.${table}.delete`, {
        parentSpanId: rootSpan.spanId,
        kind: "CLIENT",
        attributes: { "db.table": table, "db.operation": "delete", "user.hash": userHash },
      });
      const { error: delErr } = await supabase
        .from(table)
        .delete()
        .eq("user_id", userId);
      if (delErr) {
        console.error(`delete-account: delete ${table} error:`, delErr.message);
        deleteSpan.end("ERROR", new Error(delErr.message));
      } else {
        deleteSpan.end("OK");
      }
    }

    // ── 5. Delete rate_limit keys for this user ────────────────────────────
    // rate_limits rows are keyed by IP, not user_id, so no FK to clean up.

    // ── 6. Delete the Supabase auth user (irreversible) ───────────────────
    const authSpan = tracer.startSpan("auth.admin.deleteUser", {
      parentSpanId: rootSpan.spanId,
      kind: "CLIENT",
      attributes: { "user.hash": userHash },
    });
    const { error: authDelErr } = await supabase.auth.admin.deleteUser(userId);
    if (authDelErr) {
      authSpan.end("ERROR", new Error(authDelErr.message));
      throw new Error(`Failed to delete auth user: ${authDelErr.message}`);
    }
    authSpan.end("OK");

    rootSpan.end("OK");
    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json", "x-trace-id": tracer.traceId },
      }
    );
  } catch (error) {
    console.error("delete-account error:", error);
    rootSpan.end("ERROR", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json", "x-trace-id": tracer.traceId },
      }
    );
  }
});
