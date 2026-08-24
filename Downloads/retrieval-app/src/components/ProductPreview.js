import { Icon } from "./Icon";

const metrics = [
  ["Answers this week", "1,248"], ["Class accuracy", "72%"], ["Below target", "4"], ["Marks to review", "2"],
];

export function ProductPreview({ compact = false }) {
  return (
    <div>
      <div className="product-preview" aria-label="Illustrative preview of the Feynman teacher dashboard">
        <div className="preview-topbar"><span className="preview-dot"/><span className="preview-dot"/><span className="preview-dot"/><strong>Feynman Education</strong><small>Teacher workspace · Example data</small></div>
        <div className="preview-layout">
          <aside className="preview-sidebar">
            <div className="preview-class">10X1 · Year 10</div>
            {[["home","Today"],["clipboard","Assignments"],["flag","Marking review"],["spark","Lesson starter"],["chart","Insights"],["book","Question bank"]].map(([icon,label],i)=><div className={`preview-nav-row ${i===0?"active":""}`} key={label}><Icon name={icon} size={12}/>{label}</div>)}
          </aside>
          <div className="preview-main">
            <div className="preview-heading"><div><small>Class dashboard</small><h3>Good morning, Ms Patel.</h3></div><span className="preview-chip">Updated now</span></div>
            <div className="preview-metrics">{metrics.map(([label,value])=><div className="preview-metric" key={label}><small>{label}</small><b>{value}</b></div>)}</div>
            <div className="preview-queue">
              <div className="preview-panel"><div className="preview-panel-title">Topic performance</div>{[["Cell biology",82],["Atomic structure",68],["Energy changes",51]].map(([label,pct])=><div className="preview-bar-row" key={label}><div className="preview-bar-label"><span>{label}</span><b>{pct}%</b></div><div className="preview-bar"><span style={{width:`${pct}%`,background:pct<60?"#c93b32":pct<70?"#ad6b12":"#16835e"}}/></div></div>)}</div>
              <div className="preview-panel dark"><div className="preview-panel-title">Needs your attention</div><div className="preview-task"><span/><span><b>Four pupils below target</b><small>Last active over 7 days ago</small></span><button>Nudge</button></div><div className="preview-task"><span style={{background:"#4f79d5"}}/><span><b>Energy changes is weakest</b><small>51% across 94 answers</small></span><button>Assign</button></div>{compact ? null : <div className="preview-task"><span style={{background:"#d79a36"}}/><span><b>Two marking appeals</b><small>Ready for teacher review</small></span><button>Review</button></div>}</div>
            </div>
          </div>
        </div>
      </div>
      <div className="preview-caption">Illustrative dashboard using example data. Your school’s view reflects its own classes and question bank.</div>
    </div>
  );
}
