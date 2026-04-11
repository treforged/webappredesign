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

const RATE_LIMIT: RateLimitConfig = { windowMs: 60_000, max: 10 };

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const incomingTraceId = req.headers.get("x-trace-id") ?? undefined;
  const tracer = createTracer("create-setup-intent", incomingTraceId);
  const rootSpan = tracer.startSpan("fn.create-setup-intent", {
    kind: "SERVER",
    attributes: { "http.method": req.method },
  });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const ip = getClientIp(req);
  const rl = await checkRateLimit(supabase, `${ip}:create-setup-intent`, RATE_LIMIT);
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

    // ── DB: get Stripe customer ID ────────────────────────────────────────
    const dbSelectSpan = tracer.startSpan("db.user_subscriptions.select", {
      parentSpanId: rootSpan.spanId,
      kind: "CLIENT",
      attributes: { "db.table": "user_subscriptions", "db.operation": "select", "user.hash": userHash },
    });
    const { data: userSub } = await supabase
      .from("user_subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle();
    dbSelectSpan.end("OK");

    if (!userSub?.stripe_customer_id) {
      rootSpan.end("ERROR", new Error("no_customer_found"));
      return new Response(JSON.stringify({ error: "No Stripe customer found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Stripe: create SetupIntent ────────────────────────────────────────
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basil" });

    const stripeSpan = tracer.startSpan("stripe.setupIntents.create", {
      parentSpanId: rootSpan.spanId,
      kind: "CLIENT",
      attributes: { "peer.service": "stripe" },
    });
    let setupIntent: Stripe.SetupIntent;
    try {
      setupIntent = await stripe.setupIntents.create({
        customer: userSub.stripe_customer_id,
        // 'off_session' = this payment method will be charged later without the customer present
        usage: "off_session",
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      });
      stripeSpan.end("OK");
    } catch (stripeErr) {
      stripeSpan.end("ERROR", stripeErr);
      throw stripeErr;
    }

    rootSpan.end("OK");
    return new Response(
      JSON.stringify({ client_secret: setupIntent.client_secret }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json", "x-trace-id": tracer.traceId },
      }
    );
  } catch (error) {
    console.error("create-setup-intent error:", error);
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
