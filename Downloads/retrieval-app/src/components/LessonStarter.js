"use client";
import { useEffect, useState } from "react";
import { sb } from "../lib/supabase";
import { C } from "../lib/theme";
import { Badge, Btn, Card, Headline, Kicker, Pill } from "./ui";
import { useFeedback } from "./Feedback";

export function LessonStarter({ topics, unlocked, cls, dash, initialTopicId = "", onInitialTopicConsumed }) {
  const { notify } = useFeedback();
  const [numQs, setNumQs] = useState(5);
  const [lastTopic, setLastTopic] = useState("");
  const [lastTopicQs, setLastTopicQs] = useState([]); // all questions for selected topic
  const [selectedLastQs, setSelectedLastQs] = useState(new Set()); // teacher-picked question IDs
  const [recentTopics, setRecentTopics] = useState([]);
  const [generated, setGenerated] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showAnswers, setShowAnswers] = useState(false);
  const [currentQ, setCurrentQ] = useState(0);
  const [mode, setMode] = useState("setup"); // setup | slideshow | list

  // Only show unlocked topics
  const availableTopics = topics.filter(t => unlocked.has(t.id));

  // Group by prefix for nicer display
  const getPrefix = (name) => { const m = name.match(/^([BCP])/); return m ? m[1] : "•"; };

  // Load questions when teacher picks a "last lesson" topic
  const selectLastTopic = async (topicId) => {
    setLastTopic(topicId);
    setSelectedLastQs(new Set());
    setLastTopicQs([]);
    if (!topicId) return;
    setLastTopicQs([{id:"loading"}]); // loading indicator
    try {
      const qs = await sb.q("questions", { params: { topic_id: `eq.${topicId}`, select: "*,topics(name)", order: "difficulty.asc" } });
      setLastTopicQs(qs);
      setSelectedLastQs(new Set(qs.map(q => q.id)));
    } catch (e) { console.error("Failed to load questions:", e); setLastTopicQs([]); }
  };

  useEffect(() => {
    if (!initialTopicId || !unlocked.has(initialTopicId)) return;
    selectLastTopic(initialTopicId);
    onInitialTopicConsumed?.();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [initialTopicId]);

  const toggleLastQ = (qId) => {
    setSelectedLastQs(prev => {
      const n = new Set(prev);
      if (n.has(qId)) n.delete(qId); else n.add(qId);
      return n;
    });
  };

  const generate = async () => {
    if (!lastTopic) return;
    setLoading(true);

    try {
      // Fetch all questions for unlocked topics
      const tids = [...unlocked];
      const allQs = await sb.q("questions", { params: { topic_id: `in.(${tids.join(",")})`, archived: "eq.false", select: "*,topics(name)" } });

      // Get misconception question IDs from dash data
      const misconceptionQs = [];
      if (dash?.mis) {
        for (const m of dash.mis) {
          const match = allQs.find(q => q.question_text === m.q);
          if (match) misconceptionQs.push(match);
        }
      }

      // Questions from last lesson topic — USE TEACHER'S SELECTION
      const lastTopicSelected = allQs.filter(q => selectedLastQs.has(q.id));

      // Questions from recent topics (selected by teacher)
      const recentQs = allQs.filter(q => recentTopics.includes(q.topic_id) && q.topic_id !== lastTopic);

      // Other unlocked questions (not last topic, not recent, not misconceptions)
      const misconIds = new Set(misconceptionQs.map(q => q.id));
      const lastIds = new Set(lastTopicQs.map(q => q.id));
      const recentIds = new Set(recentQs.map(q => q.id));

      // Calculate split
      const nLast = Math.ceil(numQs * 0.4);
      const nRecent = Math.ceil(numQs * 0.3);
      const nMisconMax = numQs - nLast - nRecent; // reserve up to 30% for misconceptions

      // Shuffle helper
      const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);

      // Pick questions — misconceptions always appended last
      const picked = [];
      const usedIds = new Set();

      // 1. Last lesson (40%) — teacher-selected questions
      const shuffledLast = shuffle(lastTopicSelected);
      for (const q of shuffledLast) {
        if (picked.length >= nLast) break;
        if (!usedIds.has(q.id)) { picked.push({ ...q, source: "last" }); usedIds.add(q.id); }
      }

      // 2. Recent topics (30%)
      const shuffledRecent = shuffle(recentQs);
      for (const q of shuffledRecent) {
        if (picked.filter(p => p.source === "recent").length >= nRecent) break;
        if (!usedIds.has(q.id)) { picked.push({ ...q, source: "recent" }); usedIds.add(q.id); }
      }

      // 3. Filler — fill up to (numQs - nMisconMax) so misconceptions land at the end
      const fillerTarget = numQs - Math.min(nMisconMax, misconceptionQs.filter(q => !usedIds.has(q.id)).length);
      if (picked.length < fillerTarget) {
        const filler = shuffle(allQs.filter(q => !usedIds.has(q.id) && !misconIds.has(q.id)));
        for (const q of filler) {
          if (picked.length >= fillerTarget) break;
          picked.push({ ...q, source: "other" }); usedIds.add(q.id);
        }
      }

      // 4. Misconceptions — always last
      const shuffledMis = shuffle(misconceptionQs);
      for (const q of shuffledMis) {
        if (picked.length >= numQs) break;
        if (!usedIds.has(q.id)) { picked.push({ ...q, source: "misconception" }); usedIds.add(q.id); }
      }

      // 5. Final top-up if still short (e.g. not enough misconceptions or filler)
      if (picked.length < numQs) {
        const topUp = shuffle(allQs.filter(q => !usedIds.has(q.id)));
        for (const q of topUp) {
          if (picked.length >= numQs) break;
          picked.push({ ...q, source: "other" }); usedIds.add(q.id);
        }
      }

      setGenerated(picked);
      setCurrentQ(0);
      setShowAnswers(false);
      setMode("slideshow");
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  // Download generated questions + answers as a printable PDF
  const downloadPDF = async () => {
    if (!generated || generated.length === 0) return;
    try {
      // Lazy-load jsPDF from CDN (no npm dependency needed)
      if (!window.jspdf) {
        await new Promise((res, rej) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
          s.onload = res;
          s.onerror = () => rej(new Error("Failed to load PDF library"));
          document.head.appendChild(s);
        });
      }
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const m = 20;
      const w = 210 - m * 2;
      const bottom = 275;

      const topicName = topics.find(t => t.id === lastTopic)?.name || "Retrieval";
      const className = cls?.code || cls?.label || cls?.name || "";
      const dateStr = new Date().toLocaleDateString("en-GB");

      // === Page 1+: Questions with answer lines ===
      let y = m;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text(`${topicName} — Retrieval`, m, y);
      y += 7;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(120);
      const sub = [className, dateStr].filter(Boolean).join(" · ");
      doc.text(sub, m, y);
      y += 10;

      doc.setTextColor(0);
      doc.text(`Name: ___________________________    Mark: ____ / ${generated.length}`, m, y);
      y += 12;

      doc.setFontSize(11);
      generated.forEach((q, i) => {
        const lines = doc.splitTextToSize(`${i + 1}. ${q.question_text}`, w);
        const need = lines.length * 5 + 32;
        if (y + need > bottom) { doc.addPage(); y = m; }

        doc.setFont("helvetica", "normal");
        doc.setTextColor(0);
        doc.text(lines, m, y);
        y += lines.length * 5 + 3;

        doc.setDrawColor(210);
        for (let j = 0; j < 4; j++) {
          doc.line(m, y + 4, 210 - m, y + 4);
          y += 7;
        }
        y += 4;
      });

      // === Answer key (separate page so teacher can withhold) ===
      doc.addPage();
      y = m;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(0);
      doc.text("Answers", m, y);
      y += 7;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(120);
      doc.text(`${topicName} — teacher / self-mark`, m, y);
      y += 10;

      doc.setFontSize(10);
      generated.forEach((q, i) => {
        const qL = doc.splitTextToSize(`${i + 1}. ${q.question_text}`, w);
        const aL = doc.splitTextToSize(q.model_answer || "—", w - 5);
        const need = (qL.length + aL.length) * 4 + 8;
        if (y + need > bottom) { doc.addPage(); y = m; }

        doc.setFont("helvetica", "bold");
        doc.setTextColor(0);
        doc.text(qL, m, y);
        y += qL.length * 4 + 1;

        doc.setFont("helvetica", "normal");
        doc.setTextColor(70);
        doc.text(aL, m + 5, y);
        y += aL.length * 4 + 6;
      });

      // Footer on every page
      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(160);
        doc.text(`retrieval. · ${topicName} · ${i} / ${pages}`, m, 290);
      }

      const safe = topicName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      doc.save(`retrieval-${safe}-${generated.length}q.pdf`);
    } catch (e) {
      console.error("PDF download failed:", e);
      notify("The lesson-starter PDF could not be generated. Please try again.", { title: "PDF not created" });
    }
  };

  // Slideshow mode — one question at a time for projecting
  if (mode === "slideshow" && generated) {
    const q = generated[currentQ];
    const sourceLabel = { last: "Last lesson", recent: "Recent", misconception: "Misconception", other: "Review" };
    const sourceColor = { last: C.pri, recent: C.acc, misconception: C.red, other: C.mid };

    return (
      <div>
        {/* Controls bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <Btn v="ghost" onClick={() => { setMode("setup"); setGenerated(null); }} style={{ padding: "8px 14px", fontSize: 12 }}>← Back</Btn>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <Pill on={mode === "slideshow"} onClick={() => setMode("slideshow")}>Slideshow</Pill>
            <Pill on={mode === "list"} onClick={() => setMode("list")}>All questions</Pill>
            <Btn v="ghost" onClick={downloadPDF} style={{ padding: "8px 12px", fontSize: 12 }}>PDF</Btn>
          </div>
        </div>

        {/* Question card — large for projecting */}
        <Card style={{ overflow: "hidden", minHeight: 300 }}>
          <div style={{ padding: "12px 20px", borderBottom: `1px solid ${C.bdr}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Badge color={sourceColor[q?.source]}>{sourceLabel[q?.source]}</Badge>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: C.dim }}>{q?.topics?.name}</span>
              <Badge color={C.mid}>Q{currentQ + 1}/{generated.length}</Badge>
            </div>
          </div>

          <div style={{ padding: "40px 28px", textAlign: "center" }}>
            <div style={{ fontSize: 22, color: C.txt, lineHeight: 1.5, fontWeight: 500 }}>{q?.question_text}</div>

            {showAnswers && (
              <div style={{ marginTop: 28, padding: "16px 20px", background: C.grnS, borderRadius: 12, border: `1px solid rgba(34,197,94,0.2)`, animation: "slideUp .25s ease" }}>
                <div style={{ fontSize: 10, color: C.grn, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Answer</div>
                <div style={{ fontSize: 18, color: C.txt, fontWeight: 500 }}>{q?.model_answer}</div>
              </div>
            )}
          </div>

          {/* Navigation */}
          <div style={{ padding: "16px 20px", borderTop: `1px solid ${C.bdr}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Btn v="ghost" onClick={() => { setCurrentQ(c => Math.max(0, c - 1)); setShowAnswers(false); }} disabled={currentQ === 0} style={{ padding: "10px 16px", fontSize: 13 }}>← Prev</Btn>
            <Btn v={showAnswers ? "ghost" : "pri"} onClick={() => setShowAnswers(!showAnswers)} style={{ padding: "10px 20px", fontSize: 13 }}>
              {showAnswers ? "Hide answer" : "Show answer"}
            </Btn>
            <Btn v="ghost" onClick={() => { setCurrentQ(c => Math.min(generated.length - 1, c + 1)); setShowAnswers(false); }} disabled={currentQ === generated.length - 1} style={{ padding: "10px 16px", fontSize: 13 }}>Next →</Btn>
          </div>
        </Card>

        {/* Question dots */}
        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 12 }}>
          {generated.map((_, i) => (
            <button key={i} onClick={() => { setCurrentQ(i); setShowAnswers(false); }} style={{
              width: 28, height: 28, borderRadius: 99, border: `2px solid ${i === currentQ ? C.pri : C.bdr}`,
              background: i === currentQ ? C.pri : "transparent", color: i === currentQ ? "#fff" : C.dim,
              fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
            }}>{i + 1}</button>
          ))}
        </div>
      </div>
    );
  }

  // List mode — all questions visible
  if (mode === "list" && generated) {
    const sourceLabel = { last: "Last lesson", recent: "Recent", misconception: "Misconception", other: "Review" };
    const sourceColor = { last: C.pri, recent: C.acc, misconception: C.red, other: C.mid };

    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <Btn v="ghost" onClick={() => { setMode("setup"); setGenerated(null); }} style={{ padding: "8px 14px", fontSize: 12 }}>← Back</Btn>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <Pill on={mode === "slideshow"} onClick={() => setMode("slideshow")}>Slideshow</Pill>
            <Pill on={mode === "list"} onClick={() => setMode("list")}>All questions</Pill>
            <Btn v="ghost" onClick={downloadPDF} style={{ padding: "8px 12px", fontSize: 12 }}>PDF</Btn>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ color: C.txt, fontWeight: 600, fontSize: 14 }}>{generated.length} Questions</div>
          <Btn v={showAnswers ? "ghost" : "pri"} onClick={() => setShowAnswers(!showAnswers)} style={{ padding: "8px 16px", fontSize: 12 }}>
            {showAnswers ? "Hide answers" : "Show answers"}
          </Btn>
        </div>

        {generated.map((q, i) => (
          <Card key={i} style={{ padding: 16, marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 26, height: 26, borderRadius: 99, background: C.priSoft, color: C.pri, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{i + 1}</span>
                <Badge color={sourceColor[q.source]}>{sourceLabel[q.source]}</Badge>
              </div>
              <span style={{ fontSize: 11, color: C.dim }}>{q.topics?.name}</span>
            </div>
            <div style={{ fontSize: 15, color: C.txt, lineHeight: 1.4, fontWeight: 500 }}>{q.question_text}</div>
            {showAnswers && (
              <div style={{ marginTop: 10, padding: "10px 14px", background: C.grnS, borderRadius: 8, fontSize: 13, color: C.txt, animation: "slideUp .2s ease" }}>
                {q.model_answer}
              </div>
            )}
          </Card>
        ))}
      </div>
    );
  }

  // Setup mode
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Kicker>Lesson starter</Kicker>
        <Headline size={22} style={{ marginBottom: 4 }}>Generate a lesson starter</Headline>
        <div style={{ color: C.mid, fontSize: 13, marginBottom: 20 }}>Create a retrieval question set to project at the start of your lesson.</div>

        {/* Number of questions */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: C.mid, fontWeight: 600, marginBottom: 8 }}>Number of questions</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="number"
              min={1}
              max={50}
              value={numQs}
              onChange={e => {
                const n = parseInt(e.target.value) || 1;
                setNumQs(Math.max(1, Math.min(50, n)));
              }}
              style={{ width: 80, padding: "10px 12px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 3, color: C.txt, fontSize: 14, outline: "none", fontFamily: "inherit", textAlign: "center", fontWeight: 600 }}
            />
            <div style={{ display: "flex", gap: 4, flex: 1 }}>
              {[3, 5, 10, 20].map(n => (
                <Pill key={n} on={numQs === n} onClick={() => setNumQs(n)} style={{ flex: 1, textAlign: "center", fontSize: 12 }}>{n}</Pill>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>Any number 1–50. Use the box for custom, or tap a quick preset.</div>
        </div>

        {/* Last lesson topic */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: C.mid, fontWeight: 600, marginBottom: 8 }}>What did you teach last lesson?</div>
          <select value={lastTopic} onChange={e => selectLastTopic(e.target.value)}
            style={{ width: "100%", padding: "10px 12px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 3, color: C.txt, fontSize: 14, outline: "none" }}>
            <option value="">Select topic...</option>
            {availableTopics.map(t => <option key={t.id} value={t.id}>{getPrefix(t.name)} {t.name}</option>)}
          </select>
        </div>

        {/* Question picker for last lesson */}
        {lastTopic && lastTopicQs.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            {lastTopicQs.length === 1 && lastTopicQs[0].id === "loading" ? (
              <div style={{ padding: "16px", textAlign: "center", color: C.mid, fontSize: 13 }}>Loading questions...</div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: C.mid, fontWeight: 600 }}>Pick questions from this topic ({lastTopicQs.length} available)</div>
                  <button onClick={() => {
                    if (selectedLastQs.size === lastTopicQs.length) setSelectedLastQs(new Set());
                    else setSelectedLastQs(new Set(lastTopicQs.map(q => q.id)));
                  }} style={{ background: "none", border: "none", color: C.pri, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                    {selectedLastQs.size === lastTopicQs.length ? "Deselect all" : "Select all"}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: C.dim, marginBottom: 8 }}>{selectedLastQs.size} of {lastTopicQs.length} selected — up to {Math.ceil(numQs * 0.4)} will be used</div>
                <div style={{ maxHeight: 400, overflowY: "auto", borderRadius: 10, border: `1px solid ${C.bdr}`, background: C.card }}>
                  {lastTopicQs.map(q => {
                    const sel = selectedLastQs.has(q.id);
                    const diffLabel = q.difficulty === 1 ? "Easy" : q.difficulty === 2 ? "Medium" : "Hard";
                    const diffColor = q.difficulty === 1 ? C.grn : q.difficulty === 2 ? C.amb : C.red;
                    return (
                      <button key={q.id} onClick={() => toggleLastQ(q.id)} style={{
                        display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", width: "100%", textAlign: "left", fontFamily: "inherit", fontSize: 13, cursor: "pointer",
                        background: sel ? C.priSoft : "transparent", border: "none", borderBottom: `1px solid ${C.bdr}`, color: sel ? C.txt : C.mid, transition: "all .1s",
                      }}>
                        <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${sel ? C.pri : C.dim}`, background: sel ? C.pri : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{sel ? "✓" : ""}</div>
                        <div style={{ flex: 1, lineHeight: 1.35 }}>{q.question_text}</div>
                        <span style={{ fontSize: 10, color: diffColor, fontWeight: 600, flexShrink: 0 }}>{diffLabel}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* Recent topics (optional multi-select) */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: C.mid, fontWeight: 600, marginBottom: 4 }}>Recent topics (last few lessons)</div>
          <div style={{ fontSize: 11, color: C.dim, marginBottom: 8 }}>Tap to select 2-3 topics you taught recently</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 200, overflowY: "auto" }}>
            {availableTopics.filter(t => t.id !== lastTopic).map(t => {
              const sel = recentTopics.includes(t.id);
              return (
                <button key={t.id} onClick={() => setRecentTopics(p => sel ? p.filter(x => x !== t.id) : [...p, t.id])} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, cursor: "pointer", width: "100%", textAlign: "left", fontFamily: "inherit", fontSize: 13,
                  background: sel ? C.priSoft : "transparent", border: `1px solid ${sel ? "rgba(200,54,45,.2)" : "transparent"}`, color: sel ? C.txt : C.mid,
                }}>
                  <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${sel ? C.pri : C.dim}`, background: sel ? C.pri : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{sel ? "✓" : ""}</div>
                  {getPrefix(t.name)} {t.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Misconception info */}
        {dash?.mis?.length > 0 && (
          <div style={{ padding: "10px 14px", background: C.redS, borderRadius: 10, marginBottom: 16, fontSize: 12, color: C.mid, border: `1px solid rgba(239,68,68,0.15)` }}>
            <span style={{ color: C.red, fontWeight: 600 }}>{dash.mis.length} misconception{dash.mis.length !== 1 ? "s" : ""}</span> detected from retrieval data — these will automatically be included in the remaining {Math.round(numQs * 0.3)} question{Math.round(numQs * 0.3) !== 1 ? "s" : ""}
          </div>
        )}

        {/* Generate button */}
        <Btn onClick={generate} disabled={!lastTopic || loading} style={{ width: "100%", padding: "14px 20px" }}>
          {loading ? "Generating..." : `Generate ${numQs} questions`}
        </Btn>

        {/* Split preview */}
        <div style={{ marginTop: 12, display: "flex", gap: 6, justifyContent: "center" }}>
          <span style={{ fontSize: 11, color: C.pri }}>● {Math.ceil(numQs * 0.4)} last lesson</span>
          <span style={{ fontSize: 11, color: C.acc }}>● {Math.ceil(numQs * 0.3)} recent</span>
          <span style={{ fontSize: 11, color: C.red }}>● {numQs - Math.ceil(numQs * 0.4) - Math.ceil(numQs * 0.3)} misconceptions</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Topic Selector (grouped by B/C/P with collapsible sections) ─── */
