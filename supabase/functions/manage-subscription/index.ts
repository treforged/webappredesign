import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { z } from "https://esm.sh/zod@3.25.76";
import {
  checkRateLimit,
  getClientIp,
  rateLimitedResponse,
  type RateLimitConfig,
} from "../_shared/rate-limit.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createTracer, hashId } from "../_shared/tracer.ts";

const RATE_LIMIT: RateLimitConfig = { windowMs: 60_000, max: 10 };

const bodySchema = z.object({
  action: z.enum(["cancel", "resume"]),
}).strict();

/** Extract current_period_end from a Stripe Subscription. */
function getPeriodEnd(sub: Stripe.Subscription): number | null {
  return (sub as unknown as { current_period_end?: number }).current_period_end ?? null;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const incomingTraceId = req.headers.get("x-trace-id") ?? undefined;
  const tracer = createTracer("manage-subscription", incomingTraceId);
  const rootSpan = tracer.startSpan("fn.manage-subscription", {
    kind: "SERVER",
    attributes: { "http.method": req.method },
  });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const ip = getClientIp(req);
  const rl = await checkRateLimit(supabase, `${ip}:manage-subscription`, RATE_LIMIT);
  if (!rl.allowed) {
    rootSpan.end("ERROR", new Error("rate_limit_exceeded"));
    return rateLimitedResponse(corsHeaders, RATE_LIMIT, rl.resetAt);
  }

  try {
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    if (!STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not configured");

    // Verify JWT
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

    // Parse and validate body
    let parsed: { action: "cancel" | "resume" };
    try {
      const json = await req.json();
      const result = bodySchema.safeParse(json);
      if (!result.success) {
        rootSpan.end("ERROR", new Error("validation_error"));
        return new Response(
          JSON.stringify({ error: result.error.issues[0].message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      parsed = result.data;
    } catch {
      rootSpan.end("ERROR", new Error("invalid_json"));
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── DB: get subscription ──────────────────────────────────────────────
    const dbSelectSpan = tracer.startSpan("db.user_subscriptions.select", {
      parentSpanId: rootSpan.spanId,
      kind: "CLIENT",
      attributes: { "db.table": "user_subscriptions", "db.operation": "select", "user.hash": userHash },
    });
    const { data: userSub } = await supabase
      .from("user_subscriptions")
      .select("stripe_subscription_id, stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle();
    dbSelectSpan.end("OK");

    if (!userSub?.stripe_subscription_id) {
      rootSpan.end("ERROR", new Error("no_subscription_found"));
      return new Response(JSON.stringify({ error: "No active subscription found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Stripe: update subscription ───────────────────────────────────────
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basil" });
    const cancelAtPeriodEnd = parsed.action === "cancel";

    const stripeSpan = tracer.startSpan("stripe.subscriptions.update", {
      parentSpanId: rootSpan.spanId,
      kind: "CLIENT",
      attributes: {
        "peer.service": "stripe",
        "stripe.action": parsed.action,
      },
    });
    let sub: Stripe.Subscription;
    try {
      sub = await stripe.subscriptions.update(userSub.stripe_subscription_id, {
        cancel_at_period_end: cancelAtPeriodEnd,
      });
      stripeSpan.end("OK");
    } catch (stripeErr) {
      stripeSpan.end("ERROR", stripeErr);
      throw stripeErr;
    }

    // ── DB: persist the new cancel_at_period_end flag ─────────────────────
    const dbUpdateSpan = tracer.startSpan("db.user_subscriptions.update", {
      parentSpanId: rootSpan.spanId,
      kind: "CLIENT",
      attributes: { "db.table": "user_subscriptions", "db.operation": "update" },
    });
    const { error: dbErr } = await supabase.from("user_subscriptions").update({
      cancel_at_period_end: cancelAtPeriodEnd,
      subscription_status: sub.status,
    }).eq("user_id", userId);
    if (dbErr) {
      dbUpdateSpan.end("ERROR", new Error(dbErr.message));
      // Non-fatal: the webhook will eventually sync this, but log it.
      console.error("manage-subscription DB update error:", dbErr.message);
    } else {
      dbUpdateSpan.end("OK");
    }

    rootSpan.end("OK");
    return new Response(
      JSON.stringify({
        cancel_at_period_end: cancelAtPeriodEnd,
        subscription_status: sub.status,
        current_period_end: getPeriodEnd(sub),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json", "x-trace-id": tracer.traceId },
      }
    );
  } catch (error) {
    console.error("manage-subscription error:", error);
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
