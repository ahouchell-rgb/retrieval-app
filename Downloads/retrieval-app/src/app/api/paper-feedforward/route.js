// Paper feedforward generator — POST /api/paper-feedforward
//
// Generates a feedforward .docx (agreed bordered-box style) from an exam paper the
// teacher has marked: they tag the questions pupils struggled with — existing paper
// questions (struggled.question_ids), questions parsed from an uploaded .docx
// (struggled.parsed, see /api/parse-paper-docx), and/or free-text notes — and this
// builds parallel practice scaffolded down from them. The .docx is stored in the
// paper-uploads bucket and a paper_feedforward_sheets row ties it to the paper.
// See docs/FEEDFORWARD-FEATURE-SPEC.md.
//
// Node runtime: the docx build + a Sonnet generation can exceed the ~25s edge wall.
// Required env (Vercel): ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY,
//   NEXT_PUBLIC_SUPA_URL, NEXT_PUBLIC_SUPA_KEY.

import { buildFeedforwardDocx } from "../../../lib/feedforwardDocx";
import {
  SUPA_URL, ANON_KEY, SERVICE_KEY, ANTHROPIC_API_KEY,
  jsonResponse as json, rest, getAuthedUid, logUsage, overBackstop, anthropicMessages, responseText, requestHash,
} from "../../../lib/serverSupa";

export const runtime = "nodejs";
export const maxDuration = 60;

// Generation wants a stronger model than the Haiku marker; configurable.
const MODEL = process.env.ANTHROPIC_FEEDFORWARD_MODEL || "claude-sonnet-4-6";
const MAX_OUTPUT_TOKENS = 4096;
const PROMPT_VERSION = 2;

function buildPrompt({ paper, subjectName, struggledQuestions, notes }) {
  const qList = struggledQuestions.length
    ? struggledQuestions.map((q, i) =>
        `${i + 1}. [${q.command_word || ""} ${q.marks || ""}m] ${q.question_text}${q.marking_points?.length ? `\n   Mark scheme: ${q.marking_points.map((p) => p.text).filter(Boolean).join("; ")}` : ""}`
      ).join("\n")
    : "(none selected — use the teacher's notes below to decide the topics)";
  return `You are making a one-page, printable EXAM FEEDFORWARD practice sheet for a UK secondary ${subjectName || "science"} class. A feedforward sheet rebuilds understanding and exam technique on exactly the questions a class has just struggled with on a paper/test.

PAPER: ${paper?.name || "(paper)"}${paper?.exam_board ? ` · ${paper.exam_board}` : ""}${paper?.paper_year ? ` · ${paper.paper_year}` : ""}

QUESTIONS THE CLASS STRUGGLED WITH (build the sheet around EXACTLY these, in order):
${qList}
${notes ? `\nTEACHER'S NOTES on what went wrong: ${notes}` : ""}

For EACH struggled question, produce one box that:
  1. names the topic/skill it tested,
  2. gives a short "Remember" line (2-3 sentences of the core idea in plain language),
  3. gives TWO FRESH, PARALLEL exam-style questions on the same topic/skill (do NOT copy the paper's wording) with mark tariffs and a GCSE/KS3 command word (state, describe, explain, calculate, suggest, evaluate), ramping from a 1-2 mark recall item to a higher-tariff item,
  4. gives a faint mark-scheme line listing the creditworthy points.
Use UK spelling. Pupils answer in their books, so do NOT add answer lines.

Return ONLY a JSON object (no prose, no code fences) of this exact shape:
{"title": string, "boxes": [{"heading": string, "remember": string, "questions": [{"command": string, "text": string, "marks": number}], "markScheme": string, "diagram"?: string}]}
"diagram" is OPTIONAL: include it ONLY when the question genuinely needs pupils to sketch/label something, as a short caption describing what to draw (never a real diagram).`;
}

export async function POST(req) {
  if (!SERVICE_KEY || !ANON_KEY) return json({ error: "Server not configured." }, 500);
  if (!ANTHROPIC_API_KEY) return json({ error: "AI generation is not configured." }, 500);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const { paper_id, source_upload_path, struggled = {}, class_id } = body;
  if (!paper_id) return json({ error: "paper_id is required" }, 400);

  // ── AUTH: a valid staff JWT is required (this triggers a paid AI call). ──
  const uid = await getAuthedUid(req);
  if (!uid) return json({ error: "Sign in to generate a feedforward sheet." }, 401);

  // Load the paper + the caller's profile, and authorise: paper owner, a moderator,
  // or the paper-teacher's HoD (mirrors class_paper_gaps gating).
  let paper, profile;
  try {
    paper = await rest("papers", { params: { id: `eq.${paper_id}`, select: "id,name,teacher_id,subject_id,exam_board,paper_year,subjects(name,marker_profile)" }, single: true });
    profile = await rest("profiles", { params: { id: `eq.${uid}`, select: "id,role,hod_id,school_id" }, single: true });
  } catch { return json({ error: "Paper not found." }, 404); }
  if (!paper) return json({ error: "Paper not found." }, 404);

  const isModerator = profile?.role === "moderator";
  const isOwner = paper.teacher_id === uid;
  let isHodOfOwner = false;
  if (!isOwner && !isModerator) {
    try {
      const owner = await rest("profiles", { params: { id: `eq.${paper.teacher_id}`, select: "hod_id" }, single: true });
      isHodOfOwner = owner?.hod_id === uid;
    } catch { /* not authorised */ }
  }
  if (!isOwner && !isModerator && !isHodOfOwner) return json({ error: "Not your paper." }, 403);
  if (!["teacher", "moderator", "hod"].includes(profile?.role)) return json({ error: "Staff access only." }, 403);

  // Cost backstop (attribute to the class's school if given, else the teacher's).
  let schoolId = profile?.school_id || null;
  if (class_id) {
    try {
      const cls = await rest("classes", { params: { id: `eq.${class_id}`, select: "school_id" }, single: true });
      if (cls?.school_id) schoolId = cls.school_id;
    } catch { /* fall back to teacher's school */ }
  }
  // Assemble the struggled questions from three sources.
  let struggledQuestions = [];
  // (a) existing paper questions selected by id
  const ids = Array.isArray(struggled.question_ids) ? struggled.question_ids.filter(Boolean) : [];
  if (ids.length) {
    try {
      struggledQuestions = await rest("paper_questions", {
        params: { id: `in.(${ids.join(",")})`, paper_id: `eq.${paper_id}`, select: "id,question_label,question_text,command_word,marks,marking_points", order: "sort_order.asc" },
      });
    } catch { struggledQuestions = []; }
  }
  // (b) questions parsed from an uploaded .docx (Phase 2) — content, not ids
  const parsed = Array.isArray(struggled.parsed) ? struggled.parsed : [];
  const parsedQs = parsed
    .filter((p) => p && p.text)
    .map((p) => ({ question_text: p.text, command_word: p.command_word || null, marks: Number(p.marks) || null, marking_points: [] }));
  struggledQuestions = [...struggledQuestions, ...parsedQs];

  const notes = String(struggled.notes || struggled.freeText || "").trim();
  if (!struggledQuestions.length && !notes) {
    return json({ error: "Tell me which questions the class struggled with (tick some questions or add a note)." }, 400);
  }

  // Generate the structured spec, then build the .docx deterministically.
  const subjectName = paper?.subjects?.name || null;
  const prompt = buildPrompt({ paper, subjectName, struggledQuestions, notes });
  const hash = requestHash({ operation: "paper_feedforward", version: PROMPT_VERSION, model: MODEL, paper_id, class_id: class_id || null, source_upload_path: source_upload_path || null, prompt });

  // Retry-safe: an identical teacher request returns the already-built document.
  try {
    const existing = await rest("paper_feedforward_sheets", { params: { request_hash: `eq.${hash}`, select: "*", limit: "1" } });
    if (existing?.[0]) {
      const sheet = existing[0];
      return json({ ok: true, sheet, url: `${SUPA_URL}/storage/v1/object/public/paper-uploads/${sheet.docx_path}`, cached: true });
    }
  } catch { /* migration not present or cache miss: continue */ }

  if (await overBackstop(schoolId)) {
    return json({ error: "AI generation is paused for your school right now — please check your usage." }, 429);
  }

  const data = await anthropicMessages({ model: MODEL, max_tokens: MAX_OUTPUT_TOKENS, messages: [{ role: "user", content: prompt }] });
  const requestId = crypto.randomUUID();
  await logUsage("paper-feedforward", schoolId, data?.usage, {
    model: MODEL, request_id: requestId, operation: "paper_feedforward",
    latency_ms: data?._telemetry?.latency_ms, success: data?._telemetry?.success,
  }).catch(() => {});
  if (!data?._telemetry?.success) return json({ error: "Could not generate a feedforward sheet — please try again." }, 502);
  let spec;
  try { spec = JSON.parse(responseText(data)); } catch { spec = null; }
  if (!spec || !Array.isArray(spec.boxes) || spec.boxes.length === 0) {
    return json({ error: "Could not generate a feedforward sheet — please try again." }, 502);
  }

  let buf;
  try { buf = await buildFeedforwardDocx(spec); } catch (e) { return json({ error: "Could not build the document: " + String(e) }, 500); }

  // Upload to paper-uploads (service role), keyed by the owner so storage policies hold.
  const sheetId = crypto.randomUUID();
  const docxPath = `${paper.teacher_id}/feedforward/${sheetId}.docx`;
  try {
    const up = await fetch(`${SUPA_URL}/storage/v1/object/paper-uploads/${docxPath}`, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "x-upsert": "true" },
      body: buf,
    });
    if (!up.ok) throw new Error(`storage ${up.status}`);
  } catch (e) { return json({ error: "Could not save the document: " + String(e) }, 500); }

  // Record the sheet against the paper.
  let sheet;
  try {
    const rows = await rest("paper_feedforward_sheets", { method: "POST", body: {
      id: sheetId,
      paper_id,
      teacher_id: paper.teacher_id,
      class_id: class_id || null,
      source_upload_path: source_upload_path || null,
      struggled_input: { notes, question_ids: ids, parsed },
      spec,
      docx_path: docxPath,
      title: spec.title || `${paper.name} — feedforward`,
      request_hash: hash,
    } });
    sheet = Array.isArray(rows) ? rows[0] : rows;
  } catch (e) { return json({ error: "Saved the document but could not record it: " + String(e) }, 500); }

  const publicUrl = `${SUPA_URL}/storage/v1/object/public/paper-uploads/${docxPath}`;
  return json({ ok: true, sheet, url: publicUrl, cached: false });
}
