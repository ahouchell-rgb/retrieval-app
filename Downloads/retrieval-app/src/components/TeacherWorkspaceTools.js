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

export function TeacherWorkspaceTools({ classes, cls, topics, students, actions, readIds, onMarkRead, onMarkAllRead, onNavigate, onSelectClass, onOpenStudent, onOpenTopic, onUpdateAction, onOpenMobileNav }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
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
      ...topics.map(item => ({ key: `topic-${item.id}`, type: "Topic", label: item.name, detail: "Open and highlight curriculum topic", run: () => onOpenTopic?.(item) })),
      ...(students || []).map(item => ({ key: `student-${item.id}`, type: "Pupil", label: item.name, detail: `${cls?.name || "Current class"} · open pupil record`, run: () => onOpenStudent?.(item) })),
    ];
    return rows.filter(row => `${row.label} ${row.detail} ${row.type}`.toLowerCase().includes(term)).slice(0, 12);
  }, [query, classes, topics, students, cls, onNavigate, onSelectClass, onOpenStudent, onOpenTopic]);

  useEffect(() => { setActiveIndex(0); }, [query, searchOpen]);

  const choose = result => { result.run(); setQuery(""); setSearchOpen(false); };
  const runAction = action => { onMarkRead(action.key); setInboxOpen(false); action.run?.(); };
  const onSearchKeyDown = event => {
    if (!results.length) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex(index => (index + 1) % results.length); }
    if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex(index => (index - 1 + results.length) % results.length); }
    if (event.key === "Enter") { event.preventDefault(); choose(results[activeIndex] || results[0]); }
  };

  const setWorkflow = (action, patch) => onUpdateAction?.(action.key, patch);
  const snooze = action => setWorkflow(action, { status: "snoozed", snoozed_until: new Date(Date.now() + 86400000).toISOString() });
  const priorityColor = priority => priority === "urgent" ? C.red : priority === "high" ? C.amb : priority === "low" ? C.dim : C.blue;

  return (
    <>
      <div className="teacher-workspace-bar">
        <button className="workspace-mobile-menu" onClick={onOpenMobileNav} aria-label="Open teacher navigation"><Icon name="menu" size={18}/><span>Menu</span></button>
        <button className="workspace-search-trigger" onClick={() => setSearchOpen(true)}><Icon name="search" size={16}/><span>Search pupils, classes and tools</span><kbd>⌘K</kbd></button>
        <button className="workspace-inbox-trigger" onClick={() => setInboxOpen(true)} aria-label={`Open action centre${unread.length ? `, ${unread.length} unread` : ""}`}><Icon name="bell" size={17}/><span>Action centre</span>{unread.length ? <Badge color={C.red}>{unread.length}</Badge> : null}</button>
      </div>

      <WorkspaceDialog open={searchOpen} onClose={() => { setSearchOpen(false); setQuery(""); }} title="Find anything" eyebrow="Teacher search" wide>
        <div className="workspace-search-box"><Icon name="search" size={18}/><Inp autoFocus value={query} onChange={event => setQuery(event.target.value)} onKeyDown={onSearchKeyDown} placeholder="Search a pupil, class, topic or workspace page…" aria-label="Search teacher workspace" role="combobox" aria-expanded={results.length > 0} aria-controls="teacher-search-results" aria-activedescendant={results[activeIndex] ? `teacher-result-${results[activeIndex].key}` : undefined} /></div>
        <div className="workspace-results" id="teacher-search-results" role="listbox">
          {!query.trim()
            ? <div className="workspace-hint">Start typing, or press Escape to close.</div>
            : results.length
              ? results.map((result, index) => <button id={`teacher-result-${result.key}`} role="option" aria-selected={index === activeIndex} className={index === activeIndex ? "active" : ""} key={result.key} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(result)}><span className="workspace-result-type">{result.type}</span><span><strong>{result.label}</strong><small>{result.detail}</small></span><Icon name="arrow" size={16}/></button>)
              : <EmptyState title="No matches" body="Try a pupil surname, class name, topic or page such as Marking review." style={{ border: 0, boxShadow: "none" }}/>
          }
        </div>
      </WorkspaceDialog>

      <WorkspaceDialog open={inboxOpen} onClose={() => setInboxOpen(false)} title="Action centre" eyebrow={cls?.name || "Teacher workspace"}>
        <div className="workspace-inbox-meta"><span>{unread.length ? `${unread.length} unread item${unread.length === 1 ? "" : "s"}` : "You are up to date"}</span>{unread.length ? <button onClick={() => onMarkAllRead(unread.map(item => item.key))}>Mark all read</button> : null}</div>
        <div className="workspace-inbox-list">
          {actions.length
            ? actions.map(action => {
              const workflow = action.workflow || {};
              const priority = workflow.priority || action.priority || "normal";
              const due = workflow.due_at ? new Date(workflow.due_at) : null;
              return (
                <article key={action.key} className={readIds.has(action.key) ? "read" : ""}>
                  <span className="workspace-inbox-tone" style={{ background: action.tone }}/>
                  <div>
                    <div className="workspace-action-meta"><Badge color={priorityColor(priority)}>{priority}</Badge><span>Assigned to you</span>{due ? <span className={due < new Date() ? "overdue" : ""}>Due {due.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span> : null}</div>
                    <strong>{action.title}</strong><p>{action.detail}</p>
                    <div className="workspace-action-buttons"><button onClick={() => runAction(action)}>{action.label || "Open"} <Icon name="arrow" size={14}/></button><button onClick={() => snooze(action)}>Tomorrow</button><button onClick={() => setWorkflow(action, { status: "resolved", resolved_at: new Date().toISOString() })}>Done</button></div>
                    <div className="workspace-action-controls">
                      <label>Priority<select aria-label={`Priority for ${action.title}`} value={priority} onChange={event => setWorkflow(action, { priority: event.target.value })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
                      <label>Due<input aria-label={`Due date for ${action.title}`} type="date" value={workflow.due_at ? workflow.due_at.slice(0, 10) : ""} onChange={event => setWorkflow(action, { due_at: event.target.value ? new Date(`${event.target.value}T16:00:00`).toISOString() : null })}/></label>
                    </div>
                  </div>
                  {!readIds.has(action.key) ? <span className="workspace-unread-dot" aria-label="Unread"/> : null}
                </article>
              );
            })
            : <EmptyState title="Nothing needs attention" body="New pupil activity and marking reviews will appear here." style={{ border: 0, boxShadow: "none" }}/>
          }
        </div>
      </WorkspaceDialog>
    </>
  );
}
