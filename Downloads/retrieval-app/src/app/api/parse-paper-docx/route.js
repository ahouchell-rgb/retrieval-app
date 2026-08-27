// Parse an uploaded exam .docx into a tickable question list — POST /api/parse-paper-docx
//
// Phase 2 of the feedforward feature. The teacher uploads a Word exam paper to the
// paper-uploads bucket; this downloads it, extracts the text with mammoth, and asks
// OpenAI to split it into numbered questions with mark tariffs. Returns a DRAFT list
// the teacher ticks in the Feedforward panel — nothing is written to paper_questions
// (parsing is best-effort; the teacher confirms what's relevant).
//
// Node runtime: mammoth is a Node library and the model call can run a few seconds.
// Required env (Vercel): OPENAI_API_KEY, SUPABASE_SERVICE_ROLE_KEY,
//   NEXT_PUBLIC_SUPA_URL, NEXT_PUBLIC_SUPA_KEY.

import mammoth from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  SUPA_URL, ANON_KEY, SERVICE_KEY, OPENAI_API_KEY, OPENAI_MARKING_MODEL,
  jsonResponse as json, rest, getAuthedUid, logUsage, overBackstop, openAIResponses, responseText,
  contentHash, requestHash, getCachedOperation, putCachedOperation,
} from "../../../lib/serverSupa";

export const runtime = "nodejs";
export const maxDuration = 60;

const EXTRACT_MODEL = process.env.OPENAI_EXTRACT_MODEL || OPENAI_MARKING_MODEL;
const MAX_TEXT_CHARS = 24000;            // bound the prompt for the .docx text path
const MAX_BINARY_BYTES = 18 * 1024 * 1024; // PDF/image cap (base64 inflates ~33%; API limit ~32MB)
const MIN_LOCAL_PDF_CHARS = 300;          // shorter usually means a scan; use vision fallback
const PARSER_VERSION = 2;

const EXTRACT_SYSTEM = `You extract exam questions from a UK secondary past paper (given as text, a PDF, or an image).
- label: the question number/label exactly as printed (e.g. "3", "7(a)", "11").
- text: the question wording a pupil answers, concise. OMIT mark schemes, instructions, figure captions, and page headers.
- marks: the mark tariff if shown (e.g. "[3 marks]" -> 3), else null.
- command_word: the GCSE/KS3 command word if identifiable (State, Define, Describe, Explain, Calculate, Suggest, Evaluate, Compare), else null.
Include every distinct question and sub-question a pupil answers, in order. Ignore cover pages, blank lines, "Answer all questions", and formula sheets. Use the supplied JSON schema and return an empty questions array if none are found.`;

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: ["string", "null"] },
          text: { type: "string" },
          marks: { type: ["integer", "null"] },
          command_word: { type: ["string", "null"] },
        },
        required: ["label", "text", "marks", "command_word"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

async function extractPdfText(buffer) {
  const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false });
  const pdf = await task.promise;
  try {
    const pages = [];
    for (let n = 1; n <= Math.min(pdf.numPages, 80); n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => typeof item?.str === "string" ? item.str : "").filter(Boolean).join(" "));
    }
    return pages.join("\n\n").replace(/[ \t]+/g, " ").trim();
  } finally {
    await pdf.destroy();
  }
}

export async function POST(req) {
  if (!SERVICE_KEY || !ANON_KEY) return json({ error: "Server not configured." }, 500);
  if (!OPENAI_API_KEY) return json({ error: "AI parsing is not configured." }, 500);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const path = String(body?.source_upload_path || "");
  if (!path) return json({ error: "source_upload_path is required" }, 400);

  const uid = await getAuthedUid(req);
  if (!uid) return json({ error: "Sign in to read a paper." }, 401);
  // The upload is keyed by the uploader's uid (see PaperEditor). Only let a caller
  // parse their own upload (or a moderator) — don't read arbitrary bucket paths.
  let schoolId = null;
  try {
    const profile = await rest("profiles", { params: { id: `eq.${uid}`, select: "role,school_id" }, single: true });
    schoolId = profile?.school_id || null;
    if (profile?.role !== "moderator" && !path.startsWith(`${uid}/`)) return json({ error: "Not your file." }, 403);
  } catch { return json({ error: "Could not verify access." }, 403); }
  // Accept Word (.docx, parsed via mammoth) or a PDF / image (read multimodally by OpenAI).
  const ext = (path.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
  const IMAGE_MEDIA = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
  const isDocx = ext === "docx" || ext === "doc";
  const isPdf = ext === "pdf";
  const isImage = !!IMAGE_MEDIA[ext];
  if (!isDocx && !isPdf && !isImage) {
    return json({ error: "Upload a Word (.docx), PDF, or photo of the paper — or type the questions in the notes box." }, 415);
  }

  // Download the file with the service role (bucket is public, but use the auth path).
  let buffer;
  try {
    const r = await fetch(`${SUPA_URL}/storage/v1/object/paper-uploads/${path}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!r.ok) throw new Error(`storage ${r.status}`);
    buffer = Buffer.from(await r.arrayBuffer());
  } catch (e) { return json({ error: "Could not read the uploaded file: " + String(e) }, 502); }

  const hash = requestHash({ operation: "paper_parse", version: PARSER_VERSION, uid, path, file: contentHash(buffer), model: EXTRACT_MODEL });
  const cached = await getCachedOperation("paper_parse", hash);
  if (cached?.result?.questions) {
    return json({ ok: true, questions: cached.result.questions, extraction: cached.result.extraction || "cached", cached: true });
  }

  // Cost backstop applies only when this request will actually call the model.
  if (await overBackstop(schoolId)) {
    return json({ error: "AI parsing is paused for your school right now — please check your usage." }, 429);
  }

  // Build the user content: extracted text for Word, or a multimodal block for PDF/image.
  let userContent;
  let extraction = "multimodal";
  if (isDocx) {
    let text;
    try {
      const out = await mammoth.extractRawText({ buffer });
      text = (out?.value || "").trim();
    } catch (e) { return json({ error: "Could not read text from that document: " + String(e) }, 422); }
    if (!text) return json({ error: "That document had no readable text. Type the questions in the notes box instead." }, 422);
    userContent = `Past paper text:\n\n${text.slice(0, MAX_TEXT_CHARS)}`;
    extraction = "docx_text";
  } else if (isPdf) {
    // Digital PDFs are usually text-bearing. Extract that locally first: it is
    // faster and sends far fewer provider tokens than uploading every page as a
    // document. Scanned/image-only PDFs fall back to model vision.
    let text = "";
    try { text = await extractPdfText(buffer); } catch { /* vision fallback below */ }
    if (text.length >= MIN_LOCAL_PDF_CHARS) {
      userContent = `Past paper text:\n\n${text.slice(0, MAX_TEXT_CHARS)}`;
      extraction = "pdf_text";
    }
  }

  if (!userContent) {
    // PDF scan / image: send bytes inline to OpenAI. Bound the size.
    extraction = isPdf ? "pdf_vision" : "image_vision";
    if (buffer.length > MAX_BINARY_BYTES) {
      return json({ error: "That file is too large to read automatically — try a smaller PDF/photo, or type the questions in the notes box." }, 413);
    }
    const b64 = buffer.toString("base64");
    const block = isPdf
      ? { type: "input_file", filename: `paper.${ext}`, file_data: `data:application/pdf;base64,${b64}` }
      : { type: "input_image", image_url: `data:${IMAGE_MEDIA[ext]};base64,${b64}`, detail: "high" };
    userContent = [{
      role: "user",
      content: [
        block,
        { type: "input_text", text: "The attached file is a past paper or test the class has sat. Extract its questions as specified." },
      ],
    }];
  }

  // Ask the cost-efficient OpenAI model to split it into questions.
  const data = await openAIResponses({
    model: EXTRACT_MODEL,
    max_output_tokens: 4096,
    instructions: EXTRACT_SYSTEM,
    input: userContent,
    schema: EXTRACT_SCHEMA,
    schema_name: "paper_questions",
    reasoning_effort: "minimal",
    prompt_cache_key: "paper-parser-v3",
  });
  const requestId = crypto.randomUUID();
  await logUsage("paper-parse", schoolId, data?.usage, {
    model: EXTRACT_MODEL, request_id: requestId, operation: "paper_parse",
    latency_ms: data?._telemetry?.latency_ms, success: data?._telemetry?.success,
  }).catch(() => {});
  if (!data?._telemetry?.success) return json({ error: "Could not read questions from that paper — try again." }, 502);

  let parsed;
  try { parsed = JSON.parse(responseText(data))?.questions; } catch { parsed = null; }
  if (!Array.isArray(parsed)) return json({ error: "Could not read questions from that paper — type them in the notes box instead." }, 502);

  // Validate/clamp into a clean draft list.
  const questions = parsed
    .filter((q) => q && typeof q.text === "string" && q.text.trim())
    .slice(0, 60)
    .map((q) => ({
      label: typeof q.label === "string" ? q.label.slice(0, 12) : null,
      text: q.text.trim().slice(0, 600),
      marks: Number.isFinite(q.marks) ? Math.max(0, Math.min(30, q.marks | 0)) : null,
      command_word: typeof q.command_word === "string" ? q.command_word.slice(0, 20) : null,
    }));

  await putCachedOperation({
    operation: "paper_parse", request_hash: hash, actor_id: uid, school_id: schoolId,
    model: EXTRACT_MODEL, result: { questions, extraction },
  });

  return json({ ok: true, questions, extraction, cached: false });
}
