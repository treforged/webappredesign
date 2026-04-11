import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createTracer } from "../_shared/tracer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Safely convert a Stripe Unix timestamp to ISO string. Returns null if missing. */
function toISO(unixSeconds: number | null | undefined): string | null {
  if (unixSeconds == null || !Number.isFinite(unixSeconds)) return null;
  return new Date(unixSeconds * 1000).toISOString();
}

/**
 * Extract current_period_end from a Stripe Subscription.
 * The field is typed as `number` in the Stripe SDK but the `2025-08-27.basil`
 * API version renamed several period fields — cast via `unknown` to avoid `any`.
 */
function getPeriodEnd(sub: Stripe.Subscription): number | null {
  return (sub as unknown as { current_period_end?: number }).current_period_end ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Each webhook delivery gets its own trace. Stripe does not send a trace ID,
  // so we generate one here; it is returned in the response header for debugging.
  const tracer = createTracer("stripe-webhook");
  const rootSpan = tracer.startSpan("fn.stripe-webhook", {
    kind: "SERVER",
    attributes: { "http.method": req.method },
  });

  try {
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    if (!STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not configured");

    const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    if (!STRIPE_WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET not configured");

    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basil" });
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");
    if (!signature) throw new Error("Missing stripe-signature header");

    // ── Stripe: verify webhook signature ─────────────────────────────────
    const verifySpan = tracer.startSpan("stripe.webhook.verify", {
      parentSpanId: rootSpan.spanId,
      kind: "INTERNAL",
      attributes: { "peer.service": "stripe" },
    });
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET);
      verifySpan.end("OK");
    } catch (sigErr) {
      verifySpan.end("ERROR", sigErr);
      throw sigErr;
    }

    // rootSpan remains open — closed after all event handlers run below.

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const relevantEvents = [
      "checkout.session.completed",
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      // Use invoice.paid (canonical payment event) only.
      // invoice.payment_succeeded fires for the same invoice and would cause
      // duplicate Stripe API calls + DB writes for no benefit.
      "invoice.paid",
      "invoice.payment_failed",
    ];

    if (!relevantEvents.includes(event.type)) {
      rootSpan.end("OK");
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json", "x-trace-id": tracer.traceId },
      });
    }

    // ── checkout.session.completed ────────────────────────────────────────
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.metadata?.supabase_user_id;
      const customerId = session.customer as string;
      const subscriptionId = session.subscription as string | null;

      if (!userId) {
        console.error("checkout.session.completed: missing supabase_user_id in metadata");
        rootSpan.end("ERROR", new Error("missing_supabase_user_id"));
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json", "x-trace-id": tracer.traceId },
        });
      }

      if (subscriptionId) {
        // ── Stripe: retrieve subscription ──────────────────────────────
        const stripeRetrieveSpan = tracer.startSpan("stripe.subscriptions.retrieve", {
          parentSpanId: rootSpan.spanId,
          kind: "CLIENT",
          attributes: {
            "peer.service": "stripe",
            "stripe.event_type": event.type,
          },
        });
        let sub: Stripe.Subscription;
        try {
          sub = await stripe.subscriptions.retrieve(subscriptionId);
          stripeRetrieveSpan.end("OK");
        } catch (stripeErr) {
          stripeRetrieveSpan.end("ERROR", stripeErr);
          throw stripeErr;
        }

        // ── DB: upsert subscription ───────────────────────────────────
        const dbUpsertSpan = tracer.startSpan("db.user_subscriptions.upsert", {
          parentSpanId: rootSpan.spanId,
          kind: "CLIENT",
          attributes: {
            "db.table": "user_subscriptions",
            "db.operation": "upsert",
            "stripe.event_type": event.type,
          },
        });
        const { error } = await supabase.from("user_subscriptions").upsert({
          user_id: userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          plan: "premium",
          subscription_status: sub.status,
          current_period_end: toISO(getPeriodEnd(sub)),
        }, { onConflict: "user_id" });
        if (error) {
          dbUpsertSpan.end("ERROR", new Error(error.message));
          console.error("checkout upsert error:", error.message);
          throw new Error(error.message);
        }
        dbUpsertSpan.end("OK");
      } else {
        // No subscription ID on the session (e.g. setup mode or one-time payment)
        const dbUpsertSpan = tracer.startSpan("db.user_subscriptions.upsert", {
          parentSpanId: rootSpan.spanId,
          kind: "CLIENT",
          attributes: { "db.table": "user_subscriptions", "db.operation": "upsert", "stripe.event_type": event.type },
        });
        const { error } = await supabase.from("user_subscriptions").upsert({
          user_id: userId,
          stripe_customer_id: customerId,
          plan: "premium",
          subscription_status: "active",
        }, { onConflict: "user_id" });
        if (error) {
          dbUpsertSpan.end("ERROR", new Error(error.message));
          console.error("checkout upsert (no sub) error:", error.message);
          throw new Error(error.message);
        }
        dbUpsertSpan.end("OK");
      }
    }

    // ── customer.subscription.created / updated / deleted ─────────────────
    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const sub = event.data.object;
      const customerId = sub.customer as string;

      // ── DB: look up user by customer ID ──────────────────────────────
      const dbLookupSpan = tracer.startSpan("db.user_subscriptions.select", {
        parentSpanId: rootSpan.spanId,
        kind: "CLIENT",
        attributes: { "db.table": "user_subscriptions", "db.operation": "select", "stripe.event_type": event.type },
      });
      const { data: userSub } = await supabase
        .from("user_subscriptions")
        .select("user_id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();
      dbLookupSpan.end("OK");

      if (userSub) {
        const isActive = ["active", "trialing"].includes(sub.status);

        // ── DB: update subscription status ────────────────────────────
        const dbUpdateSpan = tracer.startSpan("db.user_subscriptions.update", {
          parentSpanId: rootSpan.spanId,
          kind: "CLIENT",
          attributes: {
            "db.table": "user_subscriptions",
            "db.operation": "update",
            "stripe.event_type": event.type,
            "stripe.subscription_status": sub.status,
          },
        });
        const { error } = await supabase.from("user_subscriptions").update({
          subscription_status: sub.status,
          plan: isActive ? "premium" : "free",
          current_period_end: toISO(getPeriodEnd(sub)),
          stripe_subscription_id: sub.id,
          cancel_at_period_end: sub.cancel_at_period_end ?? false,
        }).eq("user_id", userSub.user_id);
        if (error) {
          dbUpdateSpan.end("ERROR", new Error(error.message));
          console.error("subscription updated error:", error.message);
          // Throw so Stripe retries — a silent 200 here would permanently lose
          // the subscription state change.
          throw new Error(error.message);
        }
        dbUpdateSpan.end("OK");
      }
    }

    // ── invoice.paid ──────────────────────────────────────────────────────
    // Canonical payment success event. invoice.payment_succeeded is intentionally
    // not handled — it fires for the same invoice and would cause duplicate work.
    if (event.type === "invoice.paid") {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;
      const subscriptionId = (invoice as unknown as { subscription?: string }).subscription ?? null;

      if (!subscriptionId) {
        // One-time invoice, not a subscription renewal — nothing to update.
        rootSpan.end("OK");
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json", "x-trace-id": tracer.traceId },
        });
      }

      const dbLookupSpan = tracer.startSpan("db.user_subscriptions.select", {
        parentSpanId: rootSpan.spanId,
        kind: "CLIENT",
        attributes: { "db.table": "user_subscriptions", "db.operation": "select", "stripe.event_type": event.type },
      });
      const { data: userSub } = await supabase
        .from("user_subscriptions")
        .select("user_id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();
      dbLookupSpan.end("OK");

      if (userSub) {
        // ── Stripe: retrieve subscription for updated period end ──────
        const stripeRetrieveSpan = tracer.startSpan("stripe.subscriptions.retrieve", {
          parentSpanId: rootSpan.spanId,
          kind: "CLIENT",
          attributes: { "peer.service": "stripe", "stripe.event_type": event.type },
        });
        let sub: Stripe.Subscription;
        try {
          sub = await stripe.subscriptions.retrieve(subscriptionId);
          stripeRetrieveSpan.end("OK");
        } catch (stripeErr) {
          stripeRetrieveSpan.end("ERROR", stripeErr);
          throw stripeErr;
        }

        // ── DB: confirm active status + advance period end ────────────
        const dbUpdateSpan = tracer.startSpan("db.user_subscriptions.update", {
          parentSpanId: rootSpan.spanId,
          kind: "CLIENT",
          attributes: {
            "db.table": "user_subscriptions",
            "db.operation": "update",
            "stripe.event_type": event.type,
            "stripe.subscription_status": "active",
          },
        });
        const { error } = await supabase.from("user_subscriptions").update({
          subscription_status: "active",
          plan: "premium",
          stripe_subscription_id: subscriptionId,
          current_period_end: toISO(getPeriodEnd(sub)),
        }).eq("user_id", userSub.user_id);
        if (error) {
          dbUpdateSpan.end("ERROR", new Error(error.message));
          console.error("invoice.paid update error:", error.message);
          // Throw so Stripe retries — a silent 200 here would leave the user
          // without their renewed period end date.
          throw new Error(error.message);
        }
        dbUpdateSpan.end("OK");
      }
    }

    // ── invoice.payment_failed ────────────────────────────────────────────
    // Stripe enters its dunning retry cycle after the first failure. We mark
    // the subscription past_due but intentionally keep plan = "premium" so the
    // user retains access during the retry window. The plan is downgraded to
    // "free" only when Stripe gives up and fires customer.subscription.deleted.
    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;

      const dbLookupSpan = tracer.startSpan("db.user_subscriptions.select", {
        parentSpanId: rootSpan.spanId,
        kind: "CLIENT",
        attributes: { "db.table": "user_subscriptions", "db.operation": "select", "stripe.event_type": event.type },
      });
      const { data: userSub } = await supabase
        .from("user_subscriptions")
        .select("user_id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();
      dbLookupSpan.end("OK");

      if (userSub) {
        const dbUpdateSpan = tracer.startSpan("db.user_subscriptions.update", {
          parentSpanId: rootSpan.spanId,
          kind: "CLIENT",
          attributes: {
            "db.table": "user_subscriptions",
            "db.operation": "update",
            "stripe.event_type": event.type,
            "stripe.subscription_status": "past_due",
          },
        });
        const { error } = await supabase.from("user_subscriptions").update({
          subscription_status: "past_due",
        }).eq("user_id", userSub.user_id);
        if (error) {
          dbUpdateSpan.end("ERROR", new Error(error.message));
          console.error("invoice.payment_failed update error:", error.message);
          // Throw so Stripe retries — a silent 200 here would leave the
          // subscription status stale (still "active" instead of "past_due").
          throw new Error(error.message);
        }
        dbUpdateSpan.end("OK");
      }
    }

    rootSpan.end("OK");
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "x-trace-id": tracer.traceId,
      },
    });
  } catch (error) {
    console.error("Webhook error:", error);
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
