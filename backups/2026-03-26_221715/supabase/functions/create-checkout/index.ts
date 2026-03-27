import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    if (!STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub;
    const userEmail = claimsData.claims.email;

    const { return_url, coupon_code } = await req.json();
    const origin = return_url || req.headers.get("origin") || "https://app.treforged.com";

    // Coupon validation — runs before Stripe, bypasses payment if valid
    if (coupon_code) {
      const validCodes = (Deno.env.get("VALID_COUPON_CODES") || "")
        .split(",")
        .map((c: string) => c.trim())
        .filter(Boolean);

      if (!validCodes.includes(coupon_code.trim())) {
        return new Response(JSON.stringify({ error: "Invalid coupon code" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Valid coupon: grant premium directly, no Stripe session needed
      const serviceClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      const { error: upsertError } = await serviceClient
        .from("user_subscriptions")
        .upsert(
          { user_id: userId, plan: "premium", subscription_status: "active" },
          { onConflict: "user_id" }
        );
      if (upsertError) throw upsertError;

      return new Response(JSON.stringify({ granted: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if user already has a stripe customer
    const { data: existingSub } = await supabase
      .from("user_subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle();

    let customerId = existingSub?.stripe_customer_id;

    if (!customerId) {
      // Create Stripe customer
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
      if (!customerRes.ok) throw new Error(`Stripe customer error: ${JSON.stringify(customer)}`);
      customerId = customer.id;

      // Use service role to upsert subscription record
      const serviceClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      await serviceClient.from("user_subscriptions").upsert({
        user_id: userId,
        stripe_customer_id: customerId,
      }, { onConflict: "user_id" });
    }

    // Create checkout session
    const sessionRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        customer: customerId,
        "line_items[0][price]": "price_1TCZWP2cDVgFonAbtUAJHskT",
        "line_items[0][quantity]": "1",
        mode: "subscription",
        success_url: `${origin}/premium/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/premium/cancel`,
        "metadata[supabase_user_id]": userId,
      }),
    });
    const session = await sessionRes.json();
    if (!sessionRes.ok) throw new Error(`Stripe session error: ${JSON.stringify(session)}`);

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Checkout error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
