"use client";
import { useEffect, useMemo, useState } from "react";
import { C } from "../lib/theme";
import { Badge, Btn, EmptyState, Inp } from "./ui";
import { Icon } from "./Icon";
import { useDialogA11y } from "../hooks/useDialogA11y";

function WorkspaceDialog({ open, onClose, title, eyebrow, children, wide = false }) {
  const ref = useDialogA11y(open, onClose);
  if (!open) return null;
  return (
    <div className="workspace-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={ref} tabIndex={-1} className={`workspace-dialog ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="workspace-dialog-title">
        <div className="workspace-dialog-head"><div><span>{eyebrow}</span><h2 id="workspace-dialog-title">{title}</h2></div><button onClick={onClose} aria-label={`Close ${title}`}><Icon name="x" size={18}/></button></div>
        {children}
      </section>
    </div>
  );
}

export function TeacherWorkspaceTools({ classes, cls, topics, students, actions, readIds, onMarkRead, onMarkAllRead, onNavigate, onSelectClass, onOpenMobileNav }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [query, setQuery] = useState("");
  const unread = actions.filter(action => !readIds.has(action.key));

  useEffect(() => {
    const onKey = event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setInboxOpen(false); setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    const rows = [
      ...[
        ["dashboard", "Today"], ["assignments", "Assignments"], ["starter", "Lesson starter"],
        ["review", "Marking review"], ["papers", "Papers"], ["topics", "Curriculum topics"],
        ["questions", "Question bank"],
      ].map(([id, label]) => ({ key: `view-${id}`, type: "Page", label, detail: "Open workspace page", run: () => onNavigate(id) })),
      ...classes.map(item => ({ key: `class-${item.id}`, type: "Class", label: item.name, detail: item.year_group ? `Year ${item.year_group}` : "Open class", run: () => onSelectClass(item) })),
      ...topics.map(item => ({ key: `topic-${item.id}`, type: "Topic", label: item.name, detail: "Open curriculum topics", run: () => onNavigate("topics") })),
      ...(students || []).map(item => ({ key: `student-${item.id}`, type: "Pupil", label: item.name, detail: cls?.name || "Current class", run: () => onNavigate("dashboard") })),
    ];
    return rows.filter(row => `${row.label} ${row.detail} ${row.type}`.toLowerCase().includes(term)).slice(0, 12);
  }, [query, classes, topics, students, cls, onNavigate, onSelectClass]);

  const choose = result => { result.run(); setQuery(""); setSearchOpen(false); };
  const runAction = action => { onMarkRead(action.key); setInboxOpen(false); action.run?.(); };

  return (
    <>
      <div className="teacher-workspace-bar">
        <button className="workspace-mobile-menu" onClick={onOpenMobileNav} aria-label="Open teacher navigation"><Icon name="menu" size={18}/><span>Menu</span></button>
        <button className="workspace-search-trigger" onClick={() => setSearchOpen(true)}><Icon name="search" size={16}/><span>Search pupils, classes and tools</span><kbd>⌘K</kbd></button>
        <button className="workspace-inbox-trigger" onClick={() => setInboxOpen(true)} aria-label={`Open action centre${unread.length ? `, ${unread.length} unread` : ""}`}><Icon name="bell" size={17}/><span>Action centre</span>{unread.length ? <Badge color={C.red}>{unread.length}</Badge> : null}</button>
      </div>

      <WorkspaceDialog open={searchOpen} onClose={() => { setSearchOpen(false); setQuery(""); }} title="Find anything" eyebrow="Teacher search" wide>
        <div className="workspace-search-box"><Icon name="search" size={18}/><Inp autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search a pupil, class, topic or workspace page…" aria-label="Search teacher workspace" /></div>
        <div className="workspace-results">
          {!query.trim()
            ? <div className="workspace-hint">Start typing, or press Escape to close.</div>
            : results.length
              ? results.map(result => <button key={result.key} onClick={() => choose(result)}><span className="workspace-result-type">{result.type}</span><span><strong>{result.label}</strong><small>{result.detail}</small></span><Icon name="arrow" size={16}/></button>)
              : <EmptyState title="No matches" body="Try a pupil surname, class name, topic or page such as Marking review." style={{ border: 0, boxShadow: "none" }}/>
          }
        </div>
      </WorkspaceDialog>

      <WorkspaceDialog open={inboxOpen} onClose={() => setInboxOpen(false)} title="Action centre" eyebrow={cls?.name || "Teacher workspace"}>
        <div className="workspace-inbox-meta"><span>{unread.length ? `${unread.length} unread item${unread.length === 1 ? "" : "s"}` : "You are up to date"}</span>{unread.length ? <button onClick={() => onMarkAllRead(unread.map(item => item.key))}>Mark all read</button> : null}</div>
        <div className="workspace-inbox-list">
          {actions.length
            ? actions.map(action => <article key={action.key} className={readIds.has(action.key) ? "read" : ""}><span className="workspace-inbox-tone" style={{ background: action.tone }}/><div><strong>{action.title}</strong><p>{action.detail}</p><button onClick={() => runAction(action)}>{action.label || "Open"} <Icon name="arrow" size={14}/></button></div>{!readIds.has(action.key) ? <span className="workspace-unread-dot" aria-label="Unread"/> : null}</article>)
            : <EmptyState title="Nothing needs attention" body="New pupil activity and marking reviews will appear here." style={{ border: 0, boxShadow: "none" }}/>
          }
        </div>
      </WorkspaceDialog>
    </>
  );
}
