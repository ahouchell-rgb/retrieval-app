import { PublicFooter, PublicHeader } from "./PublicChrome";

export function LegalPage({ eyebrow, title, intro, sections, updated = "24 August 2026" }) {
  return (
    <div className="public-shell">
      <PublicHeader />
      <main id="main-content">
        <header className="legal-hero"><div className="public-wrap"><div className="section-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{intro}</p><div style={{ marginTop: 18, color: "#96a0aa", fontSize: 11 }}>Last updated: {updated}</div></div></header>
        <div className="public-wrap legal-layout">
          <nav className="legal-nav" aria-label={title + " sections"}>{sections.map((section) => <a href={"#" + section.id} key={section.id}>{section.title}</a>)}</nav>
          <div className="legal-copy">{sections.map((section) => <section id={section.id} key={section.id}><h2>{section.title}</h2>{section.content}</section>)}</div>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
