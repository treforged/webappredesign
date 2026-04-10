import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.25.76";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PAYLOAD_SIZE_LIMIT = 2048; // 2 KB — more than enough for { return_url }

const bodySchema = z.object({
  return_url: z.string().url('return_url must be a valid URL').max(2000).optional(),
}).strict(); // reject any unexpected fields

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    if (!STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not configured");

    // The gateway has already verified the JWT. Extract sub from the Authorization header.
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const jwt = authHeader.replace("Bearer ", "");
    // Decode payload without re-verifying — gateway already verified
    const [, payloadB64] = jwt.split(".");
    const payload = JSON.parse(atob(payloadB64));
    const userId = payload.sub as string;
    const userEmail = (payload.email ?? "") as string;

    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Read and size-limit the raw body before parsing
    const rawBody = await req.text();
    if (rawBody.length > PAYLOAD_SIZE_LIMIT) {
      return new Response(JSON.stringify({ error: "Payload too large" }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Reject malformed JSON and unexpected fields
    let parsed: { return_url?: string } = {};
    if (rawBody.trim()) {
      let json: unknown;
      try {
        json = JSON.parse(rawBody);
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = bodySchema.safeParse(json);
      if (!result.success) {
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

    // Use service role for all DB operations since we can't use anon client auth
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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
        allow_promotion_codes: "true",
        payment_method_collection: "if_required",
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
