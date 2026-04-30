/**
 * ai-advisor
 *
 * Forged AI budget advisor powered by Google Gemini.
 * Accepts a rich financial snapshot and returns structured, personalized advice.
 *
 * Rate limit: 5 requests per minute per user.
 * Auth: JWT required.
 *
 * Required env vars:
 *   GEMINI_API_KEY  — Google AI Studio key
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, getClientIp, rateLimitedResponse } from "../_shared/rate-limit.ts";

const RATE_LIMIT = { windowMs: 60_000, max: 5 };
const GEMINI_MODEL = "gemini-2.5-flash-preview-05-20";

interface DebtDetail {
  name: string;
  balance: number;
  apr: number;
  minPayment: number;
  targetPayment: number;
}

interface SavingsGoalDetail {
  name: string;
  targetAmount: number;
  currentAmount: number;
  monthlyContribution: number;
  targetDate: string | null;
}

interface FinancialSnapshot {
  monthlyIncome: number;
  monthlyExpenses: number;
  totalDebt: number;
  savingsBalance: number;
  cashOnHand: number;
  netWorth: number;
  savingsRate: number;
  topCategories: { category: string; amount: number }[];
  debtDetails: DebtDetail[];
  savingsGoals: SavingsGoalDetail[];
  question?: string;
}

function buildPrompt(body: FinancialSnapshot): string {
  const hasDebts = body.debtDetails.length > 0;
  const hasGoals = body.savingsGoals.length > 0;
  const hasQuestion = !!body.question?.trim();

  const debtSection = hasDebts
    ? body.debtDetails
        .sort((a, b) => b.balance - a.balance)
        .map(d => {
          let line = `  - ${d.name}: $${d.balance.toFixed(0)} balance`;
          if (d.apr > 0) line += `, ${d.apr.toFixed(1)}% APR`;
          if (d.minPayment > 0) line += `, $${d.minPayment.toFixed(0)}/mo minimum`;
          if (d.targetPayment > d.minPayment) line += ` ($${d.targetPayment.toFixed(0)}/mo targeted)`;
          return line;
        })
        .join("\n")
    : "  (none recorded)";

  const goalSection = hasGoals
    ? body.savingsGoals
        .map(g => {
          const pct = g.targetAmount > 0 ? ((g.currentAmount / g.targetAmount) * 100).toFixed(0) : 0;
          let line = `  - ${g.name}: $${g.currentAmount.toFixed(0)} saved of $${g.targetAmount.toFixed(0)} (${pct}% complete)`;
          if (g.monthlyContribution > 0) line += `, contributing $${g.monthlyContribution.toFixed(0)}/mo`;
          if (g.targetDate) line += `, target date ${g.targetDate}`;
          return line;
        })
        .join("\n")
    : "  (none recorded)";

  const categorySection = body.topCategories.length > 0
    ? body.topCategories
        .slice(0, 6)
        .map(c => `  - ${c.category}: $${c.amount.toFixed(0)}/mo`)
        .join("\n")
    : "  (no category data this month)";

  const surplus = body.monthlyIncome - body.monthlyExpenses;

  const directive = hasQuestion
    ? `The user is asking: "${body.question!.trim()}"\n\nAnswer this question directly and specifically using their actual numbers, debt names, and goal names. Then add 1-2 additional high-priority insights if the data warrants it.`
    : `Give a personalized analysis of this person's financial picture. Identify the 2-5 most impactful actions they should take right now, ordered by financial impact. Reference their specific debt names, goal names, and actual dollar amounts — not generic advice.`;

  return `You are Forge, a direct and specific personal finance advisor inside the Forgenta app. You have full access to this user's live financial data. Your job is to give advice that is specific to THIS person — reference their exact numbers, their debt names, their goal names. Never give advice so generic it could apply to anyone.

THEIR FINANCIAL PICTURE

Income & Cash Flow
- Monthly take-home income: $${body.monthlyIncome.toFixed(0)}
- Monthly expenses: $${body.monthlyExpenses.toFixed(0)}
- Monthly surplus/deficit: $${surplus >= 0 ? '+' : ''}${surplus.toFixed(0)}
- Savings rate: ${body.savingsRate.toFixed(1)}%

Debts (total owed: $${body.totalDebt.toFixed(0)})
${debtSection}

Savings Goals
${goalSection}

Cash Position
- Checking / liquid cash: $${body.cashOnHand.toFixed(0)}
- Savings account balance: $${body.savingsBalance.toFixed(0)}
- Net worth: $${body.netWorth.toFixed(0)}

Top Spending Categories This Month
${categorySection}

---
${directive}

Formatting rules:
- Use each debt's actual name (e.g. "your Auto Loan" not "your loan")
- Use each goal's actual name (e.g. "your Emergency Fund" not "your savings goal")
- Cite specific dollar amounts and percentages whenever making a recommendation
- If a debt has a high APR, name it and quantify how much interest it's costing monthly
- If a savings goal is behind pace, calculate the monthly shortfall and name it
- If cash on hand is less than one month of expenses ($${body.monthlyExpenses.toFixed(0)}), call that out
- Vary insight count (2–6) based on what actually warrants attention — do not pad
- Do not be preachy. Do not add disclaimers. Do not suggest consulting a financial advisor.

Respond ONLY in this exact JSON (no markdown, no code fences, no preamble):
{
  "summary": "2-3 sentences summarizing their specific situation using their actual numbers",
  "score": <integer 1-100 representing overall financial health>,
  "scoreLabel": "<Poor|Fair|Good|Strong|Excellent>",
  "insights": [
    { "type": "<positive|warning|action>", "title": "Short specific title", "body": "1-3 sentences with specific numbers and names from their data" }
  ],
  "nextMove": "The single highest-impact action this month with a specific dollar amount or target."
}`;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const ip = getClientIp(req);
  const rl = await checkRateLimit(supabase, `${ip}:ai-advisor`, RATE_LIMIT);
  if (!rl.allowed) return rateLimitedResponse(corsHeaders, RATE_LIMIT, rl.resetAt);

  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: "AI not configured" }), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: jwtErr } = await supabase.auth.getUser(token);
  if (jwtErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json() as FinancialSnapshot;
    const prompt = buildPrompt(body);

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 1500,
          },
        }),
      },
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("ai-advisor: Gemini error", geminiRes.status, errText.slice(0, 500));
      let geminiMsg = "";
      try { geminiMsg = (JSON.parse(errText) as any)?.error?.message ?? ""; } catch { /* ignore */ }
      return new Response(JSON.stringify({
        error: `AI request failed (${geminiRes.status})${geminiMsg ? ": " + geminiMsg.slice(0, 120) : ""}`,
      }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const geminiData = await geminiRes.json();
    const rawText: string = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // Strip markdown code fences Gemini occasionally adds despite instructions
    const jsonText = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      console.error("ai-advisor: JSON parse failed. Raw:", rawText.slice(0, 500));
      return new Response(JSON.stringify({ error: "Invalid AI response. Please try again." }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(parsed), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("ai-advisor:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
