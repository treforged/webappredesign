import { getCorsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let token: string | undefined;
  try {
    const body = await req.json();
    token = typeof body?.token === "string" ? body.token.trim() : undefined;
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: "Security check failed. Please refresh and try again." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!token) {
    return new Response(
      JSON.stringify({ success: false, error: "Security check failed. Please refresh and try again." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const secretKey = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secretKey) {
    console.error("verify-turnstile: TURNSTILE_SECRET_KEY not configured");
    return new Response(
      JSON.stringify({ success: false, error: "Security check failed. Please refresh and try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const formData = new FormData();
    formData.append("secret", secretKey);
    formData.append("response", token);

    const cfRes = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body: formData },
    );

    if (!cfRes.ok) {
      console.error("verify-turnstile: Cloudflare siteverify HTTP error:", cfRes.status);
      return new Response(
        JSON.stringify({ success: false, error: "Security check failed. Please refresh and try again." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const outcome = await cfRes.json() as { success: boolean; "error-codes"?: string[] };

    if (!outcome.success) {
      return new Response(
        JSON.stringify({ success: false, error: "Security check failed. Please refresh and try again." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("verify-turnstile: unexpected error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Security check failed. Please refresh and try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
