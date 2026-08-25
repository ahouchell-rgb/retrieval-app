"use client";
import { C } from "../lib/theme";
import { dueLabel } from "../lib/studentExperience";
import { Badge, Bar, Btn, Card, Deck, Headline, Inp, Kicker, Skeleton } from "./ui";

const firstName = user => (user?.profile?.display_name || user?.user_metadata?.display_name || "there").trim().split(/\s+/)[0];

function TaskRow({ task, onOpen }) {
  const overdue = task.dueAt && new Date(task.dueAt) < new Date();
  return (
    <button className="student-task-row" onClick={() => onOpen(task)}>
      <span className="student-task-icon" aria-hidden="true">{task.kind === "paper" ? "P" : "A"}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", color: C.txt, fontWeight: 750, fontSize: 14 }}>{task.title}</span>
        <span style={{ display: "block", color: overdue ? C.red : C.mid, fontSize: 12, marginTop: 4 }}>
          {task.className} · {dueLabel(task.dueAt)}{task.total ? ` · ${task.answered || 0}/${task.total} answered` : ""}
        </span>
      </span>
      <Badge color={overdue ? C.red : task.inProgress ? C.amb : C.pri}>{task.inProgress ? "Resume" : "Start"} →</Badge>
    </button>
  );
}

function DisplaySettings({ prefs, onChange }) {
  const choices = [
    { key: "largeText", title: "Larger text", body: "Make pupil text and controls easier to read." },
    { key: "readingMode", title: "Reading-friendly", body: "Use wider spacing and a simpler reading face." },
    { key: "reduceMotion", title: "Reduce motion", body: "Turn off decorative movement and transitions." },
  ];
  return (
    <div className="student-settings-grid">
      {choices.map(choice => (
        <button key={choice.key} type="button" className={`student-setting ${prefs[choice.key] ? "active" : ""}`} aria-pressed={prefs[choice.key]} onClick={() => onChange({ ...prefs, [choice.key]: !prefs[choice.key] })}>
          <span><strong>{choice.title}</strong><small>{choice.body}</small></span>
          <span className="student-switch" aria-hidden="true"><span /></span>
        </button>
      ))}
    </div>
  );
}

export function StudentHome({
  user,
  classes,
  home,
  onRetry,
  onPickClass,
  onOpenTask,
  joinCode,
  onJoinCode,
  onJoin,
  joining,
  joinErr,
  showStart,
  onShowStart,
  schoolName,
  onSchoolName,
  onStartSchool,
  creatingSchool,
  createErr,
  prefs,
  onPrefs,
  showPrefs,
  onShowPrefs,
  seenReviewIds,
  onMarkReviewRead,
}) {
  const summaries = home.classSummaries || [];
  const tasks = home.tasks || [];
  const reviews = home.reviews || [];
  const unreadReviews = reviews.filter(review => !seenReviewIds.has(review.id));
  const nextClass = [...summaries].filter(item => item.remaining > 0).sort((a, b) => b.remaining - a.remaining)[0] || summaries[0];

  return (
    <main className="student-shell student-home" aria-labelledby="student-home-title">
      <div className="student-home-topline">
        <div><Kicker>Your learning</Kicker><Headline size={30} id="student-home-title">Hello, {firstName(user)}.</Headline></div>
        <Btn v="ghost" onClick={() => onShowPrefs(!showPrefs)} aria-expanded={showPrefs} style={{ minHeight: 44 }}>Display settings</Btn>
      </div>

      {showPrefs ? <Card style={{ padding: 16, marginBottom: 16 }}><Kicker>Make it comfortable</Kicker><Headline size={19} style={{ marginBottom: 12 }}>Display preferences</Headline><DisplaySettings prefs={prefs} onChange={onPrefs} /></Card> : null}

      {home.loading ? (
        <Card style={{ padding: 22, marginBottom: 16 }} aria-label="Loading your learning plan"><Skeleton width="34%" height={12} /><Skeleton width="75%" height={30} style={{ marginTop: 13 }} /><Skeleton height={46} style={{ marginTop: 18 }} /></Card>
      ) : home.error ? (
        <Card style={{ padding: 22, marginBottom: 16, borderLeft: `4px solid ${C.red}` }}>
          <Kicker color={C.red}>Could not load your plan</Kicker><Deck style={{ marginBottom: 14 }}>{home.error}</Deck><Btn onClick={onRetry}>Try again</Btn>
        </Card>
      ) : classes.length > 0 ? (
        <Card className="student-next-card" style={{ padding: 22, marginBottom: 16, background: C.panel, borderColor: C.panel, color: "#fff" }}>
          <Kicker color="#93a1b2">Weekly homework quiz</Kicker>
          <Headline size={28} style={{ color: "#fff", marginBottom: 7 }}>{nextClass?.remaining ? `${nextClass.name} weekly quiz` : "Weekly homework complete"}</Headline>
          <Deck style={{ color: "#cbd5e1", marginBottom: 18 }}>
            {nextClass?.remaining
              ? `${nextClass.remaining} of ${nextClass.target} questions left this week. Your quiz mixes due reviews, weaker areas and new questions.`
              : "You have finished this week's required questions. You can still open a class for an optional review."}
          </Deck>
          <Btn onClick={() => onPickClass(nextClass)} style={{ width: "100%", minHeight: 48, background: "#fff", color: C.panel, borderColor: "#fff" }}>
            {nextClass?.remaining ? "Start weekly quiz" : "Open optional review"} →
          </Btn>
        </Card>
      ) : null}

      {summaries.length > 0 ? (
        <section aria-labelledby="student-classes-title" style={{ marginBottom: 20 }}>
          <div className="student-section-heading"><div><Kicker>Weekly homework</Kicker><Headline id="student-classes-title" size={20}>Your quizzes</Headline></div><span style={{ color: C.mid, fontSize: 12 }}>This week</span></div>
          <div className="student-class-grid">
            {summaries.map(item => (
              <button key={item.id} className="student-class-card" onClick={() => onPickClass(item)}>
                <span style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}><span><strong>{item.name}</strong><small>{item.subjects?.name || "Science"}{item.year_group ? ` · Year ${item.year_group}` : ""}</small></span><Badge color={item.metTarget ? C.grn : C.pri}>{item.valid}/{item.target}</Badge></span>
                <Bar pct={item.target ? item.valid / item.target * 100 : 0} label={`${item.name} weekly quiz progress`} />
                <span className="student-class-action">{item.metTarget ? "Homework complete · optional review" : `${item.remaining} questions left · start quiz`} →</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {unreadReviews.length > 0 ? (
        <section aria-labelledby="review-updates-title" style={{ marginBottom: 18 }}>
          <div className="student-section-heading"><div><Kicker color={C.grn}>Teacher updates</Kicker><Headline id="review-updates-title" size={20}>Your reviewed marks</Headline></div><Badge color={C.grn}>{unreadReviews.length} new</Badge></div>
          <div style={{ display: "grid", gap: 9 }}>
            {unreadReviews.map(review => (
              <Card key={review.id} style={{ padding: 16, borderLeft: `4px solid ${review.overturned ? C.grn : C.blue}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                  <div><div style={{ fontSize: 14, fontWeight: 750 }}>{review.overturned ? "Your mark was updated" : "Your teacher checked this mark"}</div><div style={{ color: C.mid, fontSize: 12, marginTop: 4 }}>{review.className} · {review.question}</div></div>
                  <Badge color={review.overturned ? C.grn : C.blue}>{review.overturned ? "Changed" : "Checked"}</Badge>
                </div>
                {review.note ? <div style={{ marginTop: 11, padding: "10px 12px", borderRadius: 8, background: C.card2, color: C.txt, fontSize: 13, lineHeight: 1.55 }}>{review.note}</div> : null}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 11 }}>
                  <Btn onClick={() => { const target = classes.find(item => item.id === review.classId); onMarkReviewRead(review.id); if (target) onPickClass(target); }} style={{ minHeight: 44 }}>Practise this class</Btn>
                  <Btn v="ghost" onClick={() => onMarkReviewRead(review.id)} style={{ minHeight: 44 }}>Mark as read</Btn>
                </div>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {tasks.length > 0 ? (
        <section aria-labelledby="student-work-title" style={{ marginBottom: 20 }}>
          <div className="student-section-heading"><div><Kicker>Teacher-set work</Kicker><Headline id="student-work-title" size={20}>Extra practice</Headline><Deck style={{ marginTop: 4 }}>Complete your weekly quiz first, then use these assignments and tests for extra practice.</Deck></div><Badge color={C.mid}>{tasks.length} open</Badge></div>
          <Card style={{ overflow: "hidden" }}>{tasks.map(task => <TaskRow key={`${task.kind}-${task.id}`} task={task} onOpen={onOpenTask} />)}</Card>
        </section>
      ) : null}

      <section aria-labelledby="join-class-title">
        <Card style={{ padding: 17, marginBottom: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 10 }}><div><Kicker>Class access</Kicker><Headline id="join-class-title" size={18}>Join another class</Headline></div></div>
          <div className="student-join-row">
            <Inp aria-label="Six-character class code" placeholder="e.g. X7K3NP" value={joinCode} onChange={event => onJoinCode(event.target.value.toUpperCase())} maxLength={6} onKeyDown={event => event.key === "Enter" && onJoin()} style={{ letterSpacing: 3, fontWeight: 700, fontSize: 17, textAlign: "center", textTransform: "uppercase", minHeight: 46 }} />
            <Btn onClick={onJoin} disabled={!joinCode.trim() || joining} style={{ minHeight: 46 }}>{joining ? "Joining…" : "Join"}</Btn>
          </div>
          {joinErr ? <div role="alert" style={{ color: C.red, fontSize: 13, marginTop: 9, padding: "9px 11px", background: C.redS, borderRadius: 8 }}>{joinErr}</div> : null}
        </Card>
      </section>

      {classes.length === 0 ? (
        <Card style={{ padding: "28px 20px", textAlign: "center", marginBottom: 13 }}><Headline size={20}>No classes yet</Headline><Deck style={{ marginTop: 6 }}>Use the code from your teacher to join your first class.</Deck></Card>
      ) : null}

      {classes.length === 0 && !user?.profile?.school_id ? (
        <Card style={{ padding: 16, background: C.card2 }}>
          {!showStart ? <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}><span style={{ fontSize: 13, color: C.mid }}>Are you a teacher setting up a school?</span><Btn v="ghost" onClick={() => onShowStart(true)}>Start a school</Btn></div> : <div><Headline size={18} style={{ marginBottom: 7 }}>Set up your school</Headline><Deck style={{ marginBottom: 10 }}>You will become the school lead and can then create classes.</Deck><div className="student-join-row"><Inp placeholder="School name" value={schoolName} onChange={event => onSchoolName(event.target.value)} onKeyDown={event => event.key === "Enter" && onStartSchool()} /><Btn onClick={onStartSchool} disabled={!schoolName.trim() || creatingSchool}>{creatingSchool ? "Creating…" : "Create"}</Btn></div>{createErr ? <div role="alert" style={{ color: C.red, fontSize: 13, marginTop: 9 }}>{createErr}</div> : null}</div>}
        </Card>
      ) : null}
    </main>
  );
}
