// Retrieval-sync — read-only retrieval analytics for the Head-of-Department app
// (pulse-hub). Feeds per-student and per-class retrieval performance into the HoD
// dashboard. This is the data side of the "per-department analytics tier".
//
// GET  /functions/v1/retrieval-sync?action=<action>&<params>   (pulse-hub uses GET)
// POST /functions/v1/retrieval-sync   { action, ... }          (also accepted)
// Headers: Authorization: Bearer <STAFF JWT>   (a teacher/HoD session token)
//
// actions:
//   student-summary   ?student_id=        -> { student_id, topics:[{topic_name, accuracy_pct, status, total_questions, correct, misconceptions}] }
//   recent-responses  ?student_id=&limit= -> { student_id, responses:[{answered_at, is_correct, marks_awarded, ai_feedback, questions:{question_text, marks, topics:{name}}}] }
//   class-summary     ?class_id=          -> { class_id, student_count, topics:[{topic_name, accuracy_pct, students_attempted, students_struggling, status, total_responses}] }
//   topics                                -> { topics:[{id, name, key_stage}] }
//
// SECURITY — this returns CHILD DATA, so it fails CLOSED:
//   * It requires a real staff JWT. The Supabase anon key is NOT a user, so
//     `auth.getUser(anonKey)` returns no user → 401. pulse-hub currently sends only
//     the anon key (no login), so EVERY call 401s until pulse-hub is wired to send
//     the signed-in HoD's session access_token. That is the intended safe default —
//     do NOT relax it to trust the anon key + a client-supplied id (that would be an
//     unauthenticated cross-school pupil-data read).
//   * The service-role client bypasses RLS, so every class_id / student_id is checked
//     in code against what the caller may see: own classes, classes whose teacher
//     reports to them (HoD: profiles.hod_id == caller), or moderator/admin bypass.
//     This mirrors manage-student / class-misconceptions exactly.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// strong / developing / gap buckets (match the pulse dashboard's demo thresholds).
const bucket = (pct: number) => (pct >= 67 ? "strong" : pct >= 50 ? "developing" : "gap");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

  // ── Auth: require a real staff JWT (fails closed for the anon key) ──────────
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Sign in." }, 401);
  const { data: { user }, error: authErr } = await sb.auth.getUser(authHeader.slice(7));
  if (authErr || !user) return json({ error: "Sign in as a teacher or head of department to view retrieval data." }, 401);

  const { data: profile } = await sb.from("profiles").select("role, school_id").eq("id", user.id).single();
  const role = profile?.role;
  if (!profile || !["teacher", "hod", "moderator", "admin"].includes(role)) {
    return json({ error: "Only staff can view retrieval analytics." }, 403);
  }
  const isPriv = role === "moderator" || role === "admin";

  // ── action + params (query string; POST body as a fallback) ─────────────────
  const url = new URL(req.url);
  let action = url.searchParams.get("action");
  const p: Record<string, string> = Object.fromEntries(url.searchParams.entries());
  if (!action && req.method === "POST") {
    try { const b = await req.json(); action = b?.action; Object.assign(p, b || {}); } catch { /* ignore */ }
  }

  // ── Tenancy: the class ids the caller is allowed to see ─────────────────────
  // own classes + (HoD) classes whose teacher reports to them. null = all (priv).
  let _visible: string[] | null | undefined;
  const visibleClassIds = async (): Promise<string[] | null> => {
    if (isPriv) return null;
    if (_visible !== undefined) return _visible;
    const ids = new Set<string>();
    const { data: own } = await sb.from("classes").select("id").eq("teacher_id", user.id);
    (own || []).forEach((c: any) => ids.add(c.id));
    if (role === "hod") {
      const { data: team } = await sb.from("profiles").select("id").eq("hod_id", user.id);
      const teacherIds = (team || []).map((t: any) => t.id);
      if (teacherIds.length) {
        const { data: teamClasses } = await sb.from("classes").select("id").in("teacher_id", teacherIds);
        (teamClasses || []).forEach((c: any) => ids.add(c.id));
      }
    }
    _visible = [...ids];
    return _visible;
  };
  const canSeeClass = async (classId: string): Promise<boolean> => {
    if (isPriv) return true;
    const allowed = await visibleClassIds();
    return !!allowed && allowed.includes(classId);
  };
  const canSeeStudent = async (studentId: string): Promise<boolean> => {
    if (isPriv) return true;
    const allowed = await visibleClassIds();
    if (!allowed || !allowed.length) return false;
    const { data: mem } = await sb.from("class_members").select("class_id")
      .eq("student_id", studentId).in("class_id", allowed).limit(1);
    return !!(mem && mem.length);
  };

  try {
    if (action === "student-summary") {
      const studentId = p.student_id;
      if (!studentId) return json({ error: "student_id is required" }, 400);
      if (!(await canSeeStudent(studentId))) return json({ error: "You can only view your own pupils." }, 403);

      const { data: rows, error } = await sb.from("responses")
        .select("is_correct, ai_feedback, questions(question_text, topic_id, topics(name))")
        .eq("student_id", studentId)
        .not("is_correct", "is", null);
      if (error) return json({ error: error.message }, 500);

      const byTopic = new Map<string, any>();
      for (const r of (rows || []) as any[]) {
        const tname = r.questions?.topics?.name || "Untitled topic";
        const key = r.questions?.topic_id || tname;
        let t = byTopic.get(key);
        if (!t) { t = { topic_name: tname, total_questions: 0, correct: 0, misconceptions: [] }; byTopic.set(key, t); }
        t.total_questions++;
        if (r.is_correct) t.correct++;
        else if (r.ai_feedback && !String(r.ai_feedback).startsWith("FLAGGED:") && t.misconceptions.length < 3) {
          t.misconceptions.push({ question: r.questions?.question_text || "", feedback: r.ai_feedback });
        }
      }
      const topics = [...byTopic.values()].map((t) => {
        const accuracy_pct = t.total_questions ? Math.round((100 * t.correct) / t.total_questions) : 0;
        return { topic_name: t.topic_name, accuracy_pct, status: bucket(accuracy_pct), total_questions: t.total_questions, correct: t.correct, misconceptions: t.misconceptions };
      }).sort((a, b) => a.accuracy_pct - b.accuracy_pct);
      return json({ student_id: studentId, topics });
    }

    if (action === "recent-responses") {
      const studentId = p.student_id;
      if (!studentId) return json({ error: "student_id is required" }, 400);
      if (!(await canSeeStudent(studentId))) return json({ error: "You can only view your own pupils." }, 403);
      const limit = Math.min(Math.max(parseInt(p.limit) || 20, 1), 100);

      const { data: rows, error } = await sb.from("responses")
        .select("answered_at, is_correct, marks_awarded, ai_feedback, questions(question_text, marks, topics(name))")
        .eq("student_id", studentId)
        .not("is_correct", "is", null)
        .order("answered_at", { ascending: false })
        .limit(limit);
      if (error) return json({ error: error.message }, 500);

      const responses = (rows || []).map((r: any) => ({
        answered_at: r.answered_at,
        is_correct: r.is_correct,
        marks_awarded: r.marks_awarded,
        ai_feedback: r.ai_feedback,
        questions: r.questions
          ? { question_text: r.questions.question_text, marks: r.questions.marks, topics: { name: r.questions.topics?.name || "" } }
          : null,
      }));
      return json({ student_id: studentId, responses });
    }

    if (action === "class-summary") {
      const classId = p.class_id;
      if (!classId) return json({ error: "class_id is required" }, 400);
      if (!(await canSeeClass(classId))) return json({ error: "You can only view your own classes." }, 403);

      // objective_mastery = per-class x per-topic rollup (security-invoker view).
      const { data: om, error } = await sb.from("objective_mastery")
        .select("topic_name, pct_correct, attempts, students").eq("class_id", classId);
      if (error) return json({ error: error.message }, 500);

      const topics = (om || []).map((r: any) => ({
        topic_name: r.topic_name,
        accuracy_pct: r.pct_correct ?? 0,
        students_attempted: r.students ?? 0,
        // students_struggling needs a per-student-per-topic rollup; class-summary has no
        // live consumer yet, so it's a documented placeholder rather than a wrong number.
        students_struggling: 0,
        status: bucket(r.pct_correct ?? 0),
        total_responses: r.attempts ?? 0,
      })).sort((a: any, b: any) => a.accuracy_pct - b.accuracy_pct);

      const { count } = await sb.from("class_members")
        .select("student_id", { count: "exact", head: true }).eq("class_id", classId);
      return json({ class_id: classId, student_count: count ?? 0, topics });
    }

    if (action === "classes") {
      // The classes the caller may oversee (own + HoD's team; priv sees all) —
      // the picker for the HoD dashboard. Tenancy-scoped, no pupil data.
      const allowed = await visibleClassIds();
      let q = sb.from("classes").select("id, name, year_group").eq("archived", false).order("name", { ascending: true });
      if (allowed !== null) {
        if (!allowed.length) return json({ classes: [] });
        q = q.in("id", allowed);
      }
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      return json({ classes: data || [] });
    }

    if (action === "topics") {
      // Scope to the caller's school via subjects.school_id (priv sees all).
      const { data: rows, error } = await sb.from("topics").select("id, name, key_stage, subjects(school_id)");
      if (error) return json({ error: error.message }, 500);
      const schoolId = profile.school_id;
      const topics = (rows || [])
        .filter((t: any) => isPriv || !schoolId || t.subjects?.school_id === schoolId)
        .map((t: any) => ({ id: t.id, name: t.name, key_stage: t.key_stage }));
      return json({ topics });
    }

    return json({ error: `Unknown action: ${action ?? "(none)"}` }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
