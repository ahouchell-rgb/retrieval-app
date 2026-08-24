"use client";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { ProductPreview } from "./ProductPreview";

const STEPS = [
  {
    eyebrow: "1 of 3 · Teacher workspace",
    title: "Start with the work that matters today.",
    body: "The dashboard leads with pupils who need a nudge, marking decisions that need a human and the weakest class knowledge.",
    bullets: ["Switch class without losing your place", "Assign targeted practice from the attention queue", "Keep deeper analytics available without leading with them"],
  },
  {
    eyebrow: "2 of 3 · Pupil practice",
    title: "Let pupils explain—not just recognise.",
    body: "Pupils answer in their own words and receive concise feedback immediately. Their next retrieval date is scheduled from the result.",
    bullets: ["Works on phone, tablet and laptop", "Multiple choice and written answers in one system", "A pupil can appeal a mark for teacher review"],
  },
  {
    eyebrow: "3 of 3 · Teacher oversight",
    title: "Close the loop with professional judgement.",
    body: "Teachers can review disputed or uncertain marks, see the original evidence and overturn the decision where appropriate.",
    bullets: ["Question, model answer and pupil response together", "A visible record of review outcomes", "Marking-quality evidence for department leaders"],
  },
];

export function PracticePreview() {
  return <div className="tour-answer-card"><div className="tour-question"><div className="tour-question-label">Retrieval · Cell biology</div><h4>Explain why diffusion is faster at a higher temperature.</h4><div className="tour-answer">Particles have more kinetic energy, so they move faster and spread from high to low concentration more quickly.</div><div className="tour-feedback"><b>2 / 2 · Secure</b><br/>Clear link between kinetic energy, particle movement and rate of diffusion.</div></div></div>;
}

export function ReviewPreview() {
  return <div className="tour-review"><div className="tour-question-label">Marking review · Example data</div><div className="tour-review-row"><b>Aisha appealed this mark</b><p>“The current increases because the resistance has decreased.” · AI awarded 0 / 1</p><div className="tour-review-actions"><span>View mark scheme</span><span style={{background:"#e8f5ef",color:"#16835e"}}>Overturn to 1 / 1</span></div></div><div className="tour-review-row"><b>Marking quality this term</b><p>Teacher agreement is visible alongside appeal and overturn rates.</p><div className="tour-review-actions"><span>96% agreement</span><span>2.1% appealed</span><span>0.7% overturned</span></div></div></div>;
}

export function GuidedTour({ onClose }) {
  const [step, setStep] = useState(0);
  const item = STEPS[step];

  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="guided-tour-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="guided-tour" role="dialog" aria-modal="true" aria-labelledby="guided-tour-title">
        <div className="guided-tour-head"><div><small>Guided product tour · Example data</small><h2 id="guided-tour-title">See the teaching loop before setup.</h2></div><button className="guided-tour-close" onClick={onClose} aria-label="Close product tour"><Icon name="x" size={17}/></button></div>
        <div className="guided-tour-content">
          <div className="guided-tour-stage">{step === 0 ? <ProductPreview compact /> : step === 1 ? <PracticePreview /> : <ReviewPreview />}</div>
          <div className="guided-tour-copy"><div className="section-eyebrow">{item.eyebrow}</div><h3>{item.title}</h3><p>{item.body}</p><ul className="guided-tour-list">{item.bullets.map((bullet) => <li key={bullet}><Icon name="check" size={15}/><span>{bullet}</span></li>)}</ul></div>
        </div>
        <div className="guided-tour-footer"><div className="tour-dots" aria-label="Tour progress">{STEPS.map((_, index) => <button key={index} className={"tour-dot " + (index === step ? "active" : "")} onClick={() => setStep(index)} aria-label={"Go to tour step " + (index + 1)} />)}</div><div className="tour-actions">{step > 0 ? <button className="public-link-button" onClick={() => setStep((current) => current - 1)}>Back</button> : null}<button className="public-button" onClick={() => step === STEPS.length - 1 ? onClose() : setStep((current) => current + 1)}>{step === STEPS.length - 1 ? "Start setting up" : "Next"} <Icon name="arrow" size={14}/></button></div></div>
      </div>
    </div>
  );
}
