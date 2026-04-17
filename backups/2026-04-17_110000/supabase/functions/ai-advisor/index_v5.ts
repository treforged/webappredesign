/**
 * ai-advisor
 *
 * Forged AI budget advisor powered by Google Gemini (Gemma-family model).
 * Accepts a user's financial snapshot and returns structured advice.
 *
 * Rate limit: 5 requests per minute per user (AI calls are expensive).
 * Auth: JWT required — user_id scoped to their own data.
 *
 * Required env vars:
 *   GEMINI_API_KEY  — Google AI Studio key
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, getClientIp, rateLimitedResponse } from "../_shared/rate-limit.ts";

const RATE_LIMIT = { windowMs: 60_000, max: 5 };
const GEMINI_MODEL = "gemini-2.0-flash";  // Gemma 4-family via Gemini API

interface FinancialSnapshot {
  monthlyIncome: number;
  monthlyExpenses: number;
  totalDebt: number;
  savingsBalance: number;
  cashOnHand: number;
  netWorth: number;
  savingsRate: number;
  topCategories: { category: string; amount: number }[];
  question?: string;  // optional user question; defaults to general advice
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Rate limit by IP
  const ip = getClientIp(req);
  const rl = await checkRateLimit(supabase, `${ip}:ai-advisor`, RATE_LIMIT);
  if (!rl.allowed) return rateLimitedResponse(corsHeaders, RATE_LIMIT, rl.resetAt);

  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: "AI not configured" }), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Verify JWT using service-role client's admin getUser(token)
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    console.error("ai-advisor: missing or malformed Authorization header");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: jwtErr } = await supabase.auth.getUser(token);
  if (jwtErr || !user) {
    console.error("ai-advisor: getUser failed:", jwtErr?.message ?? "no user");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json() as FinancialSnapshot;

    const topCategoryLines = (body.topCategories ?? [])
      .slice(0, 5)
      .map(c => `  - ${c.category}: $${c.amount.toFixed(0)}/mo`)
      .join("\n");

    const userQuestion = body.question?.trim()
      ? `User's question: "${body.question.trim()}"`
      : "Provide a general analysis and the top 3 most impactful actions this person can take right now.";

    const prompt = `You are Forge, a concise and direct personal finance advisor inside the Forged budgeting app. Analyze the user's financial snapshot and give actionable advice. Be specific with numbers. Do not be preachy. Do not add disclaimers. Do not suggest consulting a financial advisor.

Financial Snapshot:
- Monthly take-home income: $${body.monthlyIncome.toFixed(0)}
- Monthly expenses: $${body.monthlyExpenses.toFixed(0)}
- Total debt: $${body.totalDebt.toFixed(0)}
- Cash on hand: $${body.cashOnHand.toFixed(0)}
- Savings balance: $${body.savingsBalance.toFixed(0)}
- Net worth: $${body.netWorth.toFixed(0)}
- Savings rate: ${body.savingsRate.toFixed(1)}%
- Top spending categories this month:
${topCategoryLines || "  (no category data)"}

${userQuestion}

Respond in this exact JSON structure:
{
  "summary": "1-2 sentence plain-English summary of their situation",
  "score": <integer 1-100 representing financial health>,
  "scoreLabel": "<Poor|Fair|Good|Strong|Excellent>",
  "insights": [
    { "type": "<positive|warning|action>", "title": "Short title", "body": "1-2 sentence explanation with specific numbers" }
  ],
  "nextMove": "The single most important thing they should do this month, in one sentence."
}

Return only valid JSON. No markdown. No preamble.`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 1024,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    if (!geminiRes.ok) {
      const errBody = await geminiRes.text();
      console.error("Gemini error:", errBody);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const geminiData = await geminiRes.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

    let advice: Record<string, unknown>;
    try {
      advice = JSON.parse(rawText);
    } catch {
      console.error("Failed to parse Gemini JSON:", rawText);
      return new Response(JSON.stringify({ error: "AI returned invalid response" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(advice), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("ai-advisor:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
