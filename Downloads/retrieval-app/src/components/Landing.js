"use client";
import { SUPA_KEY, SUPA_URL } from "../lib/supabase";
import { sessionId } from "../lib/anonSession";
import { SCHOOL_ANNUAL_PRICE_LABEL } from "../lib/plans";
import { Icon } from "./Icon";
import { ProductPreview } from "./ProductPreview";
import { ProductWalkthrough } from "./ProductWalkthrough";
import { PublicFooter, PublicHeader } from "./PublicChrome";

const BRAND = "Feynman Education";

function emitFunnel(event, data = {}) {
  if (typeof window === "undefined") return;
  try {
    fetch(`${SUPA_URL}/functions/v1/emit-funnel-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPA_KEY },
      body: JSON.stringify({ event, session_id: sessionId(), ...data }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* best-effort marketing telemetry */ }
}
const FEATURES = [
  { icon: "clipboard", title: "Written answers, marked in seconds", body: "Pupils explain science in their own words. Fast checks handle the obvious answers; AI assesses the genuinely open ones against the mark scheme." },
  { icon: "target", title: "The right practice, at the right time", body: "Spaced retrieval brings weak knowledge back automatically, while teachers can assign focused practice to an individual, group or whole class." },
  { icon: "chart", title: "A clear next action for teachers", body: "See who needs a nudge, where the class is struggling and which marks need review—without digging through another spreadsheet." },
];

function PupilLanding({ onLogin, pupilArrival }) {
  const signup = () => {
    emitFunnel("signup_clicked", { ref: pupilArrival.ref, from_source: pupilArrival.from });
    onLogin({ signup: true });
  };
  return (
    <div className="public-shell">
      <PublicHeader onLogin={() => onLogin()} />
      <main id="main-content">
        <section className="marketing-hero">
          <div className="public-wrap hero-grid">
            <div className="hero-copy">
              <div className="marketing-kicker">Continue from your revision booklet</div>
              <h1 className="marketing-title">Make what you revised stick.</h1>
              <p className="marketing-lede">Practise in your own words, get useful feedback straight away and let Feynman bring each question back when your memory needs it.</p>
              <div className="hero-actions"><button className="public-button large" onClick={signup}>Create a free account <Icon name="arrow" size={16}/></button><button className="public-link-button large" onClick={() => onLogin()}>I already have an account</button></div>
              <div className="hero-proof"><span><Icon name="check" size={15}/></span> Free to start · Join your teacher’s class with a code</div>
            </div>
            <ProductPreview compact />
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}

export function Landing({ onLogin, pupilArrival }) {
  if (pupilArrival) return <PupilLanding onLogin={onLogin} pupilArrival={pupilArrival} />;

  return (
    <div className="public-shell">
      <PublicHeader onLogin={onLogin} />
      <main id="main-content">
        <section className="marketing-hero">
          <div className="public-wrap hero-grid">
            <div className="hero-copy">
              <div className="marketing-kicker">AI-marked science retrieval</div>
              <h1 className="marketing-title">Know what pupils know—before the next lesson.</h1>
              <p className="marketing-lede">Pupils answer in their own words. {BRAND} marks, responds and schedules what each one should revisit, while your dashboard turns the evidence into a manageable next step.</p>
              <div className="hero-actions">
                <a className="public-button large" href="/pricing#contact">Start a free school pilot <Icon name="arrow" size={16}/></a>
                <button className="public-link-button large" onClick={onLogin}>Log in</button>
              </div>
              <div className="hero-proof"><span><Icon name="check" size={15}/></span> One whole-school plan · {SCHOOL_ANNUAL_PRICE_LABEL} a year · No card for the pilot</div>
            </div>
            <ProductPreview />
          </div>
        </section>

        <section className="marketing-section" id="product">
          <div className="public-wrap">
            <div className="section-eyebrow">Designed around the teacher’s day</div>
            <h2 className="section-heading">Less data hunting. More useful decisions.</h2>
            <p className="section-intro">The product keeps pupil practice simple and puts the work that needs human judgement at the top of the teacher’s screen.</p>
            <ProductWalkthrough />
            <div className="feature-grid">{FEATURES.map((feature) => <article className="feature-card" key={feature.title}><span className="feature-icon"><Icon name={feature.icon} size={20}/></span><h3>{feature.title}</h3><p>{feature.body}</p></article>)}</div>
          </div>
        </section>

        <section className="marketing-section tinted" id="how-it-works">
          <div className="public-wrap">
            <div className="section-eyebrow">A closed teaching loop</div>
            <h2 className="section-heading">From answer to intervention in three steps.</h2>
            <div className="step-grid">
              <article className="step-card"><span className="step-number">1</span><h3>Pupils retrieve</h3><p>Short, focused science questions work on a phone, tablet or laptop. Pupils explain rather than guess.</p></article>
              <article className="step-card"><span className="step-number">2</span><h3>Feynman marks and responds</h3><p>Each answer is checked against the expected science, with concise feedback and teacher review routes for uncertain decisions.</p></article>
              <article className="step-card"><span className="step-number">3</span><h3>Teachers act</h3><p>The attention queue highlights missing practice, class gaps and marking appeals, with one-click assignments and lesson starters.</p></article>
            </div>
          </div>
        </section>

        <section className="marketing-section">
          <div className="public-wrap">
            <div className="section-eyebrow">Ready for school questions</div>
            <h2 className="section-heading">Clear about AI, data and teacher control.</h2>
            <p className="section-intro">School leaders should be able to understand what is processed, where judgement sits and how to ask for the information their procurement process needs.</p>
            <div className="trust-strip">
              <article className="trust-lead"><h3>A practical trust centre for your school.</h3><p>Read the current data flow, AI provider information, access controls and accessibility approach in one place.</p><a className="public-button" href="/trust">Open trust centre <Icon name="arrow" size={14}/></a></article>
              <article className="trust-item"><Icon name="shield" size={21}/><b>Teacher oversight</b><span>Appeals and uncertain marks can be reviewed and overturned by staff.</span></article>
              <article className="trust-item"><Icon name="database" size={21}/><b>Transparent data flow</b><span>We explain which answer and question content reaches the AI provider.</span></article>
              <article className="trust-item"><Icon name="accessibility" size={21}/><b>Accessible by design</b><span>Keyboard, focus, contrast and responsive behaviour are part of the interface standard.</span></article>
            </div>
          </div>
        </section>

        <section className="marketing-cta"><div className="public-wrap cta-inner"><div><h2>See it with one real class.</h2><p>Run a free pilot before choosing the {SCHOOL_ANNUAL_PRICE_LABEL} whole-school licence.</p></div><a className="public-button large" href="/pricing#contact">Arrange a pilot <Icon name="arrow" size={16}/></a></div></section>
      </main>
      <PublicFooter />
    </div>
  );
}
