/**
 * update-password
 *
 * Updates a user's password using the service-role admin API, bypassing the
 * AAL2 session requirement that blocks supabase.auth.updateUser() when MFA
 * is enabled. The caller's JWT is still verified — AAL1 is sufficient because:
 *   - Recovery flow: the recovery token from the reset email proves ownership
 *   - Settings flow: current_password re-authentication proves ownership
 *
 * Body: { new_password: string, current_password?: string }
 *   current_password — required for in-app settings flow; omit for recovery flow
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, getClientIp, rateLimitedResponse } from "../_shared/rate-limit.ts";

const RATE_LIMIT = { windowMs: 900_000, max: 10 }; // 10 attempts per 15 min

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Service-role client for admin operations and rate limiting
  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Rate limit
  const ip = getClientIp(req);
  const rl = await checkRateLimit(adminClient, `${ip}:update-password`, RATE_LIMIT);
  if (!rl.allowed) return rateLimitedResponse(corsHeaders, RATE_LIMIT, rl.resetAt);

  // Verify caller JWT
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
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
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* no body */ }

    const newPassword = typeof body.new_password === "string" ? body.new_password : "";
    const currentPassword = typeof body.current_password === "string" ? body.current_password : undefined;

    if (newPassword.length < 6) {
      return new Response(JSON.stringify({ error: "Password must be at least 6 characters" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // In-app settings flow: verify current password before allowing change
    if (currentPassword !== undefined) {
      const { error: authErr } = await userClient.auth.signInWithPassword({
        email: user.email!,
        password: currentPassword,
      });
      if (authErr) {
        return new Response(JSON.stringify({ error: "Current password is incorrect" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Admin API — bypasses AAL2 requirement
    const { error: updateErr } = await adminClient.auth.admin.updateUserById(user.id, {
      password: newPassword,
    });
    if (updateErr) throw updateErr;

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("update-password:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
