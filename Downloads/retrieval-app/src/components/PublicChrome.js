import { Brand } from "./Brand";
import { Icon } from "./Icon";

export function PublicHeader({ onLogin }) {
  return (
    <header className="public-header">
      <div className="public-wrap public-header-inner">
        <Brand />
        <nav className="public-nav" aria-label="Main navigation">
          <a href="/#product">Product</a>
          <a href="/#how-it-works">How it works</a>
          <a href="/trust">Trust centre</a>
          <a href="/pricing">Pricing</a>
        </nav>
        <div className="public-actions">
          <a className="public-link-button" href="/pricing#contact">Book a pilot</a>
          {onLogin ? <button className="public-button" onClick={onLogin}>Log in <Icon name="arrow" size={14} /></button> : <a className="public-button" href="/app?login=1">Log in <Icon name="arrow" size={14} /></a>}
        </div>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="public-footer">
      <div className="public-wrap">
        <div className="footer-grid">
          <div className="footer-brand">
            <Brand />
            <p className="footer-about">AI-marked retrieval practice for UK secondary science, designed to give pupils useful feedback and teachers clear next actions.</p>
          </div>
          <div className="footer-col"><b>Product</b><a href="/#product">Overview</a><a href="/#how-it-works">How it works</a><a href="/pricing">School pricing</a><a href="/pricing#contact">Free pilot</a></div>
          <div className="footer-col"><b>For schools</b><a href="/trust">Trust centre</a><a href="/trust#data-flow">AI and data</a><a href="/trust#security">Security</a><a href="mailto:schools@feynmaneducation.com">Procurement contact</a></div>
          <div className="footer-col"><b>Legal</b><a href="/privacy">Privacy notice</a><a href="/terms">Terms of use</a><a href="/trust#accessibility">Accessibility</a><a href="mailto:schools@feynmaneducation.com">Contact</a></div>
        </div>
        <div className="footer-bottom"><span>© {new Date().getFullYear()} Feynman Education</span><span>Built for teachers and pupils in the United Kingdom.</span></div>
      </div>
    </footer>
  );
}
