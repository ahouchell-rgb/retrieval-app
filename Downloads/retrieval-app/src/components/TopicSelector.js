"use client";
import { useEffect, useState } from "react";
import { C } from "../lib/theme";
import { Badge, Card, Headline, Inp, Kicker } from "./ui";

// Topics belong to one of three curriculum schemes, told apart by name + key_stage:
//   • Year 8 (old scheme) — names like "Y8.12 Ventilation"            (KS3)
//   • GCSE — AQA Combined — names like "B1 Cell Biology", "P1 Energy" (KS4)
//   • Springboard         — names like "B1.1 Microscopes"            (KS3, everything else)
// Check Y8 by name first (it's also KS3), then KS4, then fall through to Springboard.
const schemeOf = (t) => {
  if (/^Y\d/i.test(t.name || "")) return "y8";
  if (t.key_stage === "KS4") return "gcse";
  return "springboard";
};

// Render order + presentation for each scheme.
const SCHEMES = [
  { key: "springboard", label: "Springboard", blurb: "KS3 core scheme", color: C.pri },
  { key: "y8", label: "Year 8 (old scheme)", blurb: "KS3 legacy units", color: C.amb },
  { key: "gcse", label: "GCSE — AQA Combined", blurb: "KS4", color: C.acc },
];

// Within Springboard / GCSE the first letter is the subject. Year 8 names start
// with "Y", so they all land in "Other" and are shown as one flat list.
const SUBJECTS = [
  { key: "Biology", color: C.grn },
  { key: "Chemistry", color: C.amb },
  { key: "Physics", color: C.acc },
  { key: "Other", color: C.dim },
];
const subjectOf = (name) => {
  const p = (name || "").charAt(0);
  return p === "B" ? "Biology" : p === "C" ? "Chemistry" : p === "P" ? "Physics" : "Other";
};

// Unit prefix (B1, C4, P10…) used for the thin sub-dividers in Springboard.
const getUnit = (name) => {
  const m = (name || "").match(/^([BCP]\d+)/);
  return m ? m[1] : "";
};
const unitLabel = (u) => ({
  B1: "B1 — Cells", B2: "B2 — Body", B3: "B3 — Nutrition", B4: "B4 — Breathing",
  B5: "B5 — Reproduction", B6: "B6 — Plants", B7: "B7 — Respiration", B8: "B8 — Ecology",
  B9: "B9 — Genetics",
}[u] || u);

export function TopicSelector({ topics, unlocked, toggleT, setUnlocked, cls, userId, deliveries = {}, onMarkTaught, focusTopicId = null, onFocusHandled }) {
  const [expanded, setExpanded] = useState({}); // scheme key → bool (explicit override)
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!focusTopicId) return;
    const topic = topics.find(item => item.id === focusTopicId);
    if (!topic) return;
    setSearch(topic.name);
    const timer = window.setTimeout(() => {
      document.getElementById(`topic-card-${focusTopicId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      onFocusHandled?.();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [focusTopicId, topics, onFocusHandled]);

  const filtered = search.trim()
    ? topics.filter(t => t.name.toLowerCase().includes(search.toLowerCase()))
    : null;

  // Turn a list of topics on/off together. If every topic is already on, this
  // turns them all off; otherwise it switches on the ones that are off.
  const toggleMany = (list) => {
    const allOn = list.every(t => unlocked.has(t.id));
    list.forEach(async t => {
      if (allOn && unlocked.has(t.id)) await toggleT(t.id);
      else if (!allOn && !unlocked.has(t.id)) await toggleT(t.id);
    });
  };

  const renderTopic = (t) => {
    const on = unlocked.has(t.id);
    const taught = deliveries[t.id];
    const taughtDate = taught ? new Date(taught.taught_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null;
    return (
      <div id={`topic-card-${t.id}`} key={t.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, scrollMarginTop: 110 }}>
        <button onClick={() => toggleT(t.id)} style={{
          flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 3, cursor: "pointer", textAlign: "left", fontFamily: "inherit", fontSize: 13,
          background: "transparent", border: "none", borderLeft: `3px solid ${on ? C.pri : "transparent"}`, color: on ? C.txt : C.mid, transition: "all .15s",
        }}>
          <div style={{ width: 20, height: 20, borderRadius: 5, border: `2px solid ${on ? C.pri : C.dim}`, background: on ? C.pri : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{on ? "✓" : ""}</div>
          <span style={{ flex: 1 }}>{t.name}</span>
          {taughtDate && <span style={{ fontSize: 10, color: C.grn, fontWeight: 600, whiteSpace: "nowrap" }}>✓ Taught {taughtDate}</span>}
        </button>
        {on && onMarkTaught && (
          <button onClick={() => onMarkTaught(t.id)} title={taught ? "Unmark as taught" : "Mark as taught"} style={{
            padding: "6px 10px", borderRadius: 8, border: `1px solid ${taught ? C.grn : C.bdr}`, background: taught ? C.grnS : "transparent",
            color: taught ? C.grn : C.dim, fontSize: 11, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, whiteSpace: "nowrap",
          }}>{taught ? "Taught ✓" : "Mark taught"}</button>
        )}
      </div>
    );
  };

  // A subject's topics, grouped under thin unit dividers when the subject actually
  // has multi-topic units (Springboard). GCSE units are single topics, Year 8 has
  // no B/C/P unit — both fall back to a plain list.
  const renderTopicList = (list, color) => {
    const units = {};
    list.forEach(t => { const u = getUnit(t.name); (units[u] = units[u] || []).push(t); });
    const useDividers = Object.values(units).some(arr => arr.length >= 2);
    if (!useDividers) return list.map(renderTopic);
    return Object.entries(units).map(([u, unitTopics]) => (
      <div key={u || "_"} style={{ marginBottom: 6 }}>
        {u && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, marginTop: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: 0.5 }}>{unitLabel(u)}</div>
            <div style={{ flex: 1, height: 1, background: C.bdr }} />
            <span style={{ fontSize: 10, color: C.dim }}>{unitTopics.filter(t => unlocked.has(t.id)).length}/{unitTopics.length}</span>
          </div>
        )}
        {unitTopics.map(renderTopic)}
      </div>
    ));
  };

  if (topics.length === 0) return (
    <Card style={{ padding: "40px 20px", textAlign: "center" }}>
      <div style={{ color: C.dim, fontSize: 13 }}>No topics found. Import questions first.</div>
    </Card>
  );

  return (
    <div>
      <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: `1px solid ${C.bdr}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <Kicker>Topic access</Kicker>
            <Headline size={22}>Unlock topics</Headline>
            <div style={{ color: C.mid, fontSize: 13, marginTop: 4 }}>Students only see questions from unlocked topics. Topics are grouped by scheme — open a section to browse.</div>
          </div>
          <Badge color={C.pri}>{unlocked.size}/{topics.length}</Badge>
        </div>
        <Inp placeholder="Search all topics..." value={search} onChange={e => setSearch(e.target.value)} style={{ fontSize: 13, padding: "10px 12px" }} />
      </div>

      {/* Search results — flat across every scheme */}
      {filtered && (
        <Card style={{ padding: 14, marginBottom: 10 }}>
          <div style={{ color: C.dim, fontSize: 12, marginBottom: 8 }}>{filtered.length} result{filtered.length !== 1 ? 's' : ''}</div>
          {filtered.map(renderTopic)}
        </Card>
      )}

      {/* Scheme sections — each a collapsible dropdown */}
      {!filtered && SCHEMES.map(scheme => {
        const schemeTopics = topics.filter(t => schemeOf(t) === scheme.key);
        if (schemeTopics.length === 0) return null;

        const onCount = schemeTopics.filter(t => unlocked.has(t.id)).length;
        const allOn = onCount === schemeTopics.length;
        // Default open if the teacher already has unlocks here; otherwise collapsed.
        const isOpen = expanded[scheme.key] !== undefined ? expanded[scheme.key] : onCount > 0;

        // Group this scheme's topics by subject (Year 8 → single "Other" group).
        const bySubject = {};
        schemeTopics.forEach(t => { const s = subjectOf(t.name); (bySubject[s] = bySubject[s] || []).push(t); });
        const subjectGroups = SUBJECTS.filter(s => bySubject[s.key]).map(s => ({ ...s, topics: bySubject[s.key] }));
        const flat = subjectGroups.length === 1 && subjectGroups[0].key === "Other"; // Year 8 case

        return (
          <Card key={scheme.key} style={{ marginBottom: 10, overflow: "hidden" }}>
            {/* Scheme header */}
            <button onClick={() => setExpanded(p => ({ ...p, [scheme.key]: !isOpen }))} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", width: "100%", textAlign: "left", fontFamily: "inherit", cursor: "pointer",
              background: "transparent", border: "none", borderLeft: `4px solid ${scheme.color}`, borderBottom: isOpen ? `1px solid ${C.bdr}` : "none",
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: C.txt, fontWeight: 700, fontSize: 15 }}>{scheme.label}</div>
                <div style={{ color: C.dim, fontSize: 11, marginTop: 1 }}>{scheme.blurb} · {schemeTopics.length} topics</div>
              </div>
              <span style={{ fontSize: 12, color: onCount > 0 ? scheme.color : C.dim, fontWeight: 700 }}>{onCount}/{schemeTopics.length}</span>
              <span style={{ color: C.dim, fontSize: 16, transition: "transform .2s", transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}>▾</span>
            </button>

            {isOpen && (
              <div style={{ padding: "10px 12px 12px" }}>
                {/* Select / deselect the whole scheme */}
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  <button onClick={() => toggleMany(schemeTopics)} style={{
                    padding: "6px 12px", borderRadius: 6, border: `1px solid ${allOn ? "rgba(239,68,68,.3)" : scheme.color + "44"}`,
                    background: allOn ? C.redS : `${scheme.color}15`, color: allOn ? C.red : scheme.color,
                    fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                  }}>
                    {allOn ? "Deselect all" : "Select all"} · {scheme.label}
                  </button>
                </div>

                {flat
                  ? renderTopicList(subjectGroups[0].topics, scheme.color)
                  : subjectGroups.map(sg => {
                    const sOn = sg.topics.filter(t => unlocked.has(t.id)).length;
                    const sAllOn = sOn === sg.topics.length;
                    return (
                      <div key={sg.key} style={{ marginBottom: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: sg.color }}>{sg.key}</span>
                          <span style={{ fontSize: 10, color: C.dim }}>{sOn}/{sg.topics.length}</span>
                          <button onClick={() => toggleMany(sg.topics)} style={{
                            marginLeft: "auto", padding: "3px 8px", borderRadius: 5, border: "none", background: "transparent",
                            color: sAllOn ? C.red : sg.color, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                          }}>{sAllOn ? "Deselect" : "Select all"}</button>
                        </div>
                        {renderTopicList(sg.topics, sg.color)}
                      </div>
                    );
                  })}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/* ─── Question Manager ─── */
