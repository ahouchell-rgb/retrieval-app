"use client";
import { useState, forwardRef } from "react";
import { C } from "../lib/theme";

const softFor = (color) => {
  if (color === C.grn) return C.grnS;
  if (color === C.amb) return C.ambS;
  if (color === C.blue || color === C.acc) return C.blueS;
  if (color === C.teal) return C.tealS;
  if (color === C.red || color === C.pri) return C.priSoft;
  return `${color}18`;
};

/* ─── UI primitives ─── */
export const Inp = ({ style, ...p }) => <input {...p} style={{ width: "100%", padding: "12px 14px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 8, color: C.txt, fontSize: 15, outline: "none", boxSizing: "border-box", WebkitAppearance: "none", transition: "border-color .15s, box-shadow .15s", ...style }} />;
export const TA = forwardRef(function TA({ style, ...p }, ref) {
  return <textarea ref={ref} {...p} style={{ width: "100%", padding: "12px 14px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 8, color: C.txt, fontSize: 15, outline: "none", boxSizing: "border-box", fontFamily: "inherit", resize: "vertical", transition: "border-color .15s, box-shadow .15s", ...style }} />;
});
export const Btn = ({ v = "pri", style, children, ...p }) => {
  const s = {
    pri: { background: C.pri, color: "#fff", border: `1px solid ${C.pri}` },
    ghost: { background: C.card, color: C.txt, border: `1px solid ${C.bdr}` },
  };
  return <button {...p} style={{ minHeight: 38, padding: "9px 14px", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit", transition: "all .15s", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, whiteSpace: "nowrap", ...s[v], ...style, ...(p.disabled ? { background: C.card2, color: C.dim, border: `1px solid ${C.bdr}`, opacity: 1, cursor: "default" } : {}) }}>{children}</button>;
};
export const Card = ({ children, style, ...p }) => <div {...p} style={{ background: C.card, borderRadius: C.radius, border: `1px solid ${C.bdr}`, boxShadow: "0 1px 0 rgba(20,23,26,0.02)", ...style }}>{children}</div>;
export const Badge = ({ children, color = C.pri, style }) => <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: softFor(color), color, lineHeight: 1.35, whiteSpace: "nowrap", ...style }}>{children}</span>;
export const Pill = ({ on, children, onClick, style }) => <button onClick={onClick} aria-pressed={!!on} style={{ padding: "7px 13px", borderRadius: 999, border: `1px solid ${on ? C.pri : C.bdr}`, background: on ? C.priSoftBg : C.card, color: on ? C.pri : C.mid, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", ...style }}>{children}</button>;
export const Stat = ({ label, value, color = C.txt }) => <Card style={{ padding: "15px 12px", textAlign: "left", flex: "1 1 0", minWidth: 0 }}><div style={{ fontSize: 11, color: C.mid, fontWeight: 700, marginBottom: 12 }}>{label}</div><div style={{ fontSize: 30, fontWeight: 800, color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</div></Card>;
export const Bar = ({ pct, label }) => {
  const now = Math.max(0, Math.min(100, Math.round(pct || 0)));
  return <div role="progressbar" aria-valuenow={now} aria-valuemin={0} aria-valuemax={100} aria-label={label || "progress"} style={{ width: "100%", height: 8, background: C.bdrSoft, borderRadius: 999, overflow: "hidden" }}><div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: pct >= 70 ? C.grn : pct >= 50 ? C.amb : C.red, borderRadius: 999, transition: "width .4s" }} /></div>;
};

/* Editorial primitives — for D2 register */
export const Kicker = ({ children, color = C.pri, style }) => <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color, marginBottom: 6, ...style }}>{children}</div>;
export const Headline = ({ children, size = 24, style }) => <div style={{ fontFamily: C.serif, fontSize: size, fontWeight: 700, lineHeight: 1.12, color: C.txt, ...style }}>{children}</div>;
export const Deck = ({ children, style }) => <div style={{ fontSize: 14, lineHeight: 1.5, color: C.mid, ...style }}>{children}</div>;
export const SectionTitle = ({ children, style }) => <div style={{ fontFamily: C.serif, fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em", color: C.txt, ...style }}>{children}</div>;
export const Dateline = ({ left, right, style }) => <div style={{ padding: "9px 0", borderBottom: `1px solid ${C.bdr}`, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: C.mid, fontWeight: 700, ...style }}><span style={{ color: C.pri }}>{left}</span><span>{right}</span></div>;
// Collapsible detail section: shows just a title + one-line teaser until the
// teacher opens it. Lets the dashboard lead with headlines and keep the deep
// analytics/settings one tap away. `right` holds header controls shown when open.
export const Section = ({ label, teaser, right = null, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderTop: `2px solid ${C.bdr}`, marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: open ? "14px 0 10px" : "14px 0" }}>
        <button onClick={() => setOpen(o => !o)} aria-expanded={open} style={{ display: "flex", alignItems: "baseline", gap: 9, minWidth: 0, background: "transparent", border: "none", cursor: "pointer", textAlign: "left", fontFamily: "inherit", padding: 0 }}>
          <span aria-hidden="true" style={{ color: C.dim, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{open ? "▾" : "▸"}</span>
          <span style={{ color: C.txt, fontWeight: 600, fontSize: 13, flexShrink: 0 }}>{label}</span>
          {!open && teaser != null && <span style={{ fontSize: 11, color: C.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{teaser}</span>}
        </button>
        {open && (right || <button onClick={() => setOpen(false)} style={{ fontSize: 11, color: C.dim, fontWeight: 600, background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>Hide</button>)}
      </div>
      {open && <div style={{ paddingBottom: 4 }}>{children}</div>}
    </div>
  );
};
export const StatTile = ({ label, value, onClick, active, color }) => (
  <button onClick={onClick} disabled={!onClick} aria-pressed={onClick ? !!active : undefined} style={{ padding: "10px 8px", background: active ? C.priSoft : C.card, border: `1px solid ${active ? C.pri : C.bdr}`, borderRadius: 8, cursor: onClick ? "pointer" : "default", fontFamily: "inherit", textAlign: "center" }}>
    <div style={{ fontSize: 18, fontWeight: 700, color: color || (active ? C.pri : C.txt), lineHeight: 1 }}>{value}</div>
    <div style={{ fontSize: 10, color: C.mid, textTransform: "uppercase", letterSpacing: .5, marginTop: 4 }}>{label}</div>
  </button>
);

/* ─── HoD PANEL ─── */
