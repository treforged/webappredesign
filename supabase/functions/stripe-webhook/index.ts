import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    if (!STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not configured");

    const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    if (!STRIPE_WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET not configured");

    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basil" });
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");
    if (!signature) throw new Error("Missing stripe-signature header");

    const event = stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const relevantEvents = [
      "checkout.session.completed",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "invoice.payment_succeeded",
      "invoice.payment_failed",
    ];

    if (!relevantEvents.includes(event.type)) {
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── checkout.session.completed ────────────────────────────────────────────
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.metadata?.supabase_user_id;
      const customerId = session.customer as string;
      const subscriptionId = session.subscription as string | null;

      if (!userId) {
        console.error("checkout.session.completed: missing supabase_user_id in metadata");
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (subscriptionId) {
        // Retrieve subscription to get accurate status and period end
        const sub = await stripe.subscriptions.retrieve(subscriptionId);

        const { error } = await supabase.from("user_subscriptions").upsert({
          user_id: userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          plan: "premium",
          subscription_status: sub.status,
          current_period_end: toISO((sub as any).current_period_end),
        }, { onConflict: "user_id" });

        if (error) {
          console.error("checkout upsert error:", error.message);
          throw new Error(error.message);
        }
      } else {
        // No subscription ID on the session (e.g. setup mode) — mark premium with customer only
        const { error } = await supabase.from("user_subscriptions").upsert({
          user_id: userId,
          stripe_customer_id: customerId,
          plan: "premium",
          subscription_status: "active",
        }, { onConflict: "user_id" });

        if (error) {
          console.error("checkout upsert (no sub) error:", error.message);
          throw new Error(error.message);
        }
      }
    }

    // ── customer.subscription.updated / deleted ───────────────────────────────
    if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const sub = event.data.object;
      const customerId = sub.customer as string;

      const { data: userSub } = await supabase
        .from("user_subscriptions")
        .select("user_id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();

      if (userSub) {
        const isActive = ["active", "trialing"].includes(sub.status);

        const { error } = await supabase.from("user_subscriptions").update({
          subscription_status: sub.status,
          plan: isActive ? "premium" : "free",
          current_period_end: toISO((sub as any).current_period_end),
          stripe_subscription_id: sub.id,
        }).eq("user_id", userSub.user_id);

        if (error) console.error("subscription updated error:", error.message);
      }
    }

    // ── invoice.payment_succeeded ─────────────────────────────────────────────
    // Re-activates subscriptions that were past_due. Also sets plan: "premium"
    // in case the row was downgraded while payment was failing.
    if (event.type === "invoice.payment_succeeded") {
      const invoice = event.data.object as any;
      const customerId = invoice.customer as string;
      const subscriptionId = invoice.subscription as string | null;

      if (!subscriptionId) {
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: userSub } = await supabase
        .from("user_subscriptions")
        .select("user_id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();

      if (userSub) {
        // Retrieve subscription to get accurate period end
        const sub = await stripe.subscriptions.retrieve(subscriptionId);

        const { error } = await supabase.from("user_subscriptions").update({
          subscription_status: "active",
          plan: "premium",
          stripe_subscription_id: subscriptionId,
          current_period_end: toISO((sub as any).current_period_end),
        }).eq("user_id", userSub.user_id);

        if (error) console.error("invoice.payment_succeeded update error:", error.message);
      }
    }

    // ── invoice.payment_failed ────────────────────────────────────────────────
    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as any;
      const customerId = invoice.customer as string;

      const { data: userSub } = await supabase
        .from("user_subscriptions")
        .select("user_id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();

      if (userSub) {
        const { error } = await supabase.from("user_subscriptions").update({
          subscription_status: "past_due",
        }).eq("user_id", userSub.user_id);

        if (error) console.error("invoice.payment_failed update error:", error.message);
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
