"use client";
import { useState } from "react";
import { PracticePreview, ReviewPreview } from "./GuidedTour";
import { Icon } from "./Icon";
import { ProductPreview } from "./ProductPreview";

const VIEWS = [
  { id: "teacher", label: "Teacher dashboard", icon: "home", eyebrow: "The teacher’s Today view", title: "The next action is already at the top.", body: "Class progress, missing practice, weak knowledge and review work come together in one calm starting point.", bullets: ["Attention queue before deeper analytics", "Targeted assignment from a class gap", "Progress and marking review in context"] },
  { id: "pupil", label: "Pupil answer", icon: "clipboard", eyebrow: "The pupil experience", title: "A written explanation, marked while it matters.", body: "Pupils retrieve in their own words and get concise, mark-scheme-aware feedback while the reasoning is still fresh.", bullets: ["Immediate score and useful next step", "Responsive on phones and laptops", "The answer is scheduled back through spaced retrieval"] },
  { id: "review", label: "Teacher review", icon: "flag", eyebrow: "Human oversight", title: "Teachers keep the final judgement.", body: "A pupil appeal brings the answer, marking context and original decision together for a quick, accountable review.", bullets: ["Uphold or overturn the AI decision", "Visible agreement and appeal rates", "Evidence for departmental quality review"] },
];

export function ProductWalkthrough() {
  const [view, setView] = useState("teacher");
  const item = VIEWS.find((entry) => entry.id === view);
  return (
    <div className="public-demo">
      <div className="public-demo-tabs" role="tablist" aria-label="Product walkthrough">{VIEWS.map((entry) => <button className={"public-demo-tab " + (entry.id === view ? "active" : "")} key={entry.id} onClick={() => setView(entry.id)} role="tab" aria-selected={entry.id === view}><Icon name={entry.icon} size={15}/>{entry.label}</button>)}</div>
      <div className="public-demo-content">
        <div className="public-demo-stage">{view === "teacher" ? <ProductPreview compact/> : view === "pupil" ? <PracticePreview/> : <ReviewPreview/>}</div>
        <div className="public-demo-copy"><small>{item.eyebrow}</small><h3>{item.title}</h3><p>{item.body}</p><ul>{item.bullets.map((bullet) => <li key={bullet}><Icon name="check" size={15}/><span>{bullet}</span></li>)}</ul></div>
      </div>
    </div>
  );
}

