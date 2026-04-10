import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.25.76";
import {
  checkRateLimit,
  getClientIp,
  rateLimitedResponse,
  type RateLimitConfig,
} from "../_shared/rate-limit.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createTracer, hashId } from "../_shared/tracer.ts";

const PAYLOAD_SIZE_LIMIT = 2048;

const RATE_LIMIT: RateLimitConfig = { windowMs: 60_000, max: 20 };

// Price IDs — override via edge function secrets if needed
const PRICE_IDS = {
  monthly: Deno.env.get("STRIPE_PRICE_MONTHLY") ?? "price_1TKXd02cDVgFonAbfApHZHkd",
  yearly:  Deno.env.get("STRIPE_PRICE_YEARLY")  ?? "price_1TDyCe2cDVgFonAb5P637p2r",
} as const;

const bodySchema = z.object({
  return_url: z.string().url('return_url must be a valid URL').max(2000).optional(),
  plan: z.enum(['monthly', 'yearly']).default('yearly'),
}).strict();

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Propagate trace ID from frontend if provided; otherwise start a new trace.
  const incomingTraceId = req.headers.get("x-trace-id") ?? undefined;
  const tracer = createTracer("create-checkout", incomingTraceId);
  const rootSpan = tracer.startSpan("fn.create-checkout", {
    kind: "SERVER",
    attributes: { "http.method": req.method },
  });

  // Service role client — only this key can access the rate_limits table
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Rate limit by IP before doing any auth or business logic
  const ip = getClientIp(req);
  const rl = await checkRateLimit(supabase, `${ip}:create-checkout`, RATE_LIMIT);
  if (!rl.allowed) {
    rootSpan.end("ERROR", new Error("rate_limit_exceeded"));
    return rateLimitedResponse(corsHeaders, RATE_LIMIT, rl.resetAt);
  }

  try {
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    if (!STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not configured");

    // The gateway has already verified the JWT. Extract sub from the Authorization header.
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      rootSpan.end("ERROR", new Error("unauthorized"));
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify JWT via Supabase auth — validates the signature server-side
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
    const userEmail = authUser.email ?? "";

    // Hash user ID for safe log correlation (not reversible)
    const userHash = await hashId(userId);

    // Read and size-limit the raw body before parsing
    const rawBody = await req.text();
    if (rawBody.length > PAYLOAD_SIZE_LIMIT) {
      rootSpan.end("ERROR", new Error("payload_too_large"));
      return new Response(JSON.stringify({ error: "Payload too large" }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Reject malformed JSON and unexpected fields
    let parsed: { return_url?: string; plan?: 'monthly' | 'yearly' } = {};
    if (rawBody.trim()) {
      let json: unknown;
      try {
        json = JSON.parse(rawBody);
      } catch {
        rootSpan.end("ERROR", new Error("invalid_json"));
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = bodySchema.safeParse(json);
      if (!result.success) {
        rootSpan.end("ERROR", new Error("validation_error"));
        return new Response(
          JSON.stringify({ error: result.error.issues[0].message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      parsed = result.data;
    }

    // Sanitize and extract origin from the validated return_url (strip any injected content)
    const sanitizedReturnUrl = parsed.return_url
      ? parsed.return_url.replace(/<[^>]*>/g, '').trim()
      : null;
    const origin = sanitizedReturnUrl
      ? new URL(sanitizedReturnUrl).origin
      : req.headers.get("origin") || "https://app.treforged.com";

    // ── DB: check for existing Stripe customer ─────────────────────────────
    const dbSelectSpan = tracer.startSpan("db.user_subscriptions.select", {
      parentSpanId: rootSpan.spanId,
      kind: "CLIENT",
      attributes: { "db.table": "user_subscriptions", "db.operation": "select", "user.hash": userHash },
    });
    const { data: existingSub } = await supabase
      .from("user_subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle();
    dbSelectSpan.end("OK");

    let customerId = existingSub?.stripe_customer_id;

    if (!customerId) {
      // ── Stripe: create customer ──────────────────────────────────────────
      const stripeCustomerSpan = tracer.startSpan("stripe.customers.create", {
        parentSpanId: rootSpan.spanId,
        kind: "CLIENT",
        attributes: {
          "http.method": "POST",
          "http.path": "/v1/customers",
          "peer.service": "stripe",
        },
      });
      const customerRes = await fetch("https://api.stripe.com/v1/customers", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          email: userEmail || "",
          "metadata[supabase_user_id]": userId,
        }),
      });
      const customer = await customerRes.json();
      stripeCustomerSpan.end(
        customerRes.ok ? "OK" : "ERROR",
        customerRes.ok ? undefined : new Error(`stripe_customers_create_${customerRes.status}`),
      );
      if (!customerRes.ok) throw new Error(`Stripe customer error: ${JSON.stringify(customer)}`);
      customerId = customer.id;

      // ── DB: upsert Stripe customer ID ────────────────────────────────────
      const dbUpsertSpan = tracer.startSpan("db.user_subscriptions.upsert", {
        parentSpanId: rootSpan.spanId,
        kind: "CLIENT",
        attributes: { "db.table": "user_subscriptions", "db.operation": "upsert", "user.hash": userHash },
      });
      await supabase.from("user_subscriptions").upsert({
        user_id: userId,
        stripe_customer_id: customerId,
      }, { onConflict: "user_id" });
      dbUpsertSpan.end("OK");
    }

    // ── Stripe: create checkout session ──────────────────────────────────────
    const stripeSessionSpan = tracer.startSpan("stripe.checkout.sessions.create", {
      parentSpanId: rootSpan.spanId,
      kind: "CLIENT",
      attributes: {
        "http.method": "POST",
        "http.path": "/v1/checkout/sessions",
        "peer.service": "stripe",
        "checkout.mode": "subscription",
      },
    });
    const sessionRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        customer: customerId,
        "line_items[0][price]": PRICE_IDS[parsed.plan ?? 'yearly'],
        "line_items[0][quantity]": "1",
        mode: "subscription",
        allow_promotion_codes: "true",
        payment_method_collection: "if_required",
        success_url: `${origin}/premium/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/premium/cancel`,
        "metadata[supabase_user_id]": userId,
      }),
    });
    const session = await sessionRes.json();
    stripeSessionSpan.end(
      sessionRes.ok ? "OK" : "ERROR",
      sessionRes.ok ? undefined : new Error(`stripe_checkout_sessions_create_${sessionRes.status}`),
    );
    if (!sessionRes.ok) throw new Error(`Stripe session error: ${JSON.stringify(session)}`);

    rootSpan.end("OK");
    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "x-trace-id": tracer.traceId,
      },
    });
  } catch (error) {
    console.error("Checkout error:", error);
    rootSpan.end("ERROR", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "x-trace-id": tracer.traceId,
        },
      }
    );
  }
});
