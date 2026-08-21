"use client";
import { useState } from "react";
import { SUPA_URL, SUPA_KEY, sb } from "../lib/supabase";
import { roleOf } from "../lib/roles";
import { C } from "../lib/theme";
import { Btn } from "./ui";

// In-product paywall → captured lead. Hitting the custom-question lock is a
// high-intent signal that a teacher wants the annual School plan, so
// instead of a dead-end "speak to your administrator" line we capture it as a lead
// (source: in_app_paywall) that lands in the moderator AdminPanel "Leads" inbox.
//
// Insert with return=minimal: the leads SELECT policy is moderator-only, so asking
// PostgREST to return the row would trip RLS (same reason the pricing page does this).
export function RequestCore({ user }) {
  const [state, setState] = useState("idle"); // idle | sending | done | error

  const request = async () => {
    setState("sending");
    try {
      const token = sb.auth.getToken?.();
      const r = await fetch(`${SUPA_URL}/rest/v1/leads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPA_KEY,
          Authorization: `Bearer ${token || SUPA_KEY}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          contact_name: user?.user_metadata?.display_name || user?.profile?.display_name || null,
          email: user?.email || null,
          role: roleOf(user) || "teacher",
          plan_interest: "core",
          message: "In-app request to unlock custom questions with the £800 annual School plan.",
          source: "in_app_paywall",
        }),
      });
      if (!r.ok) throw new Error("lead insert failed");
      setState("done");
    } catch { setState("error"); }
  };

  if (state === "done") {
    return (
      <div style={{ marginTop: 16, fontSize: 13, color: C.grn || C.pri, fontWeight: 600 }}>
        ✓ Request sent — we&rsquo;ll be in touch about the School plan.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      <Btn onClick={request} disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : "Ask about the £800 School plan"}
      </Btn>
      {state === "error" && <div style={{ fontSize: 12, color: C.red, marginTop: 8 }}>Couldn&rsquo;t send just now — email schools@feynmaneducation.com and we&rsquo;ll sort it.</div>}
    </div>
  );
}
