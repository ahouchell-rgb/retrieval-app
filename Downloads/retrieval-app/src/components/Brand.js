export function Brand({ href = "/", inverse = false }) {
  const content = <><span className="brand-mark" style={inverse ? { background: "white", color: "#c93b32" } : undefined}>F</span><span className="brand-name" style={inverse ? { color: "white" } : undefined}>Feynman<span> Education</span></span></>;
  return href ? <a className="brand-lockup" href={href}>{content}</a> : <span className="brand-lockup">{content}</span>;
}
