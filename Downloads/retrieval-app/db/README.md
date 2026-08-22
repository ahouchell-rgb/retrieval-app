# Database migrations

The schema lives in the Supabase project (`uvzukwoxqhcxaxtzrziy`). These files
record schema/security changes so they're reviewable and reproducible. Each file
header states whether it is **APPLIED** or **PENDING**; the table below is the
index. Status was reconciled against the live database on **2026-06-18** (every
migration listed is applied — see "Replaying on a fresh DB" for the out-of-band
steps that are deliberately *not* in these files).

Apply one with:

```bash
psql "$DATABASE_URL" -f db/migrations/<file>.sql
```

| File | Status | What it does |
| --- | --- | --- |
| `20260614_01_profiles_privilege_lockdown.sql` | APPLIED | Stops a pupil self-promoting to `moderator` (and then reading all PII): revokes the table-wide UPDATE on `profiles`, re-grants only `display_name`. |
| `20260614_02_grade_integrity_lockin.sql` | APPLIED | Revokes client INSERT on `responses` so only the `mark-answer` edge function (service role) can record a grade. |
| `20260614_03_hod_resolve_marking_flags.sql` | APPLIED | Adds a HoD branch to `marking_flags_update`, and adds the missing `responses` UPDATE policy — which also fixes "overturn" silently no-op'ing for everyone. |
| `20260614_04_paper_grade_integrity_lockin.sql` | APPLIED | Past-paper equivalent of 02: revokes client write on `paper_responses` + `paper_attempts.awarded_marks` so only `mark-paper-answer` sets exam marks. |
| `20260614_05_questions_mixed_visibility.sql` | APPLIED | Mixed content model: `questions.shared` flag; existing backfilled shared, new default private; `questions_select` scoped via `can_view_question()`. Closes the cross-school question-bank read leak. |
| `20260614_06_scope_classes_close_joincode_leak.sql` | APPLIED | Scopes `classes_select` (teacher/enrolled/HoD/mod) so join codes aren't world-readable; joining moves to `join_class_by_code()`; pupils can't self-insert memberships. |
| `20260614_07_support_tickets.sql` | APPLIED | In-app support: `support_tickets` table + RLS (anyone files as self; only moderators read/resolve). Powers the Admin → Support tab. |
| `20260614_08_parent_report_rpc.sql` | APPLIED | `parent_report(token)` SECURITY DEFINER RPC: one pupil's progress via a revocable, unguessable link — no account needed. Powers `/parent/[token]`. |
| `20260614_09_export_student_data.sql` | APPLIED | GDPR DSAR export of all of one pupil's data; gated to a moderator or the pupil's class teacher. Powers the Admin "Export data" button. |
| `20260614_10_question_shared_guard.sql` | APPLIED | BEFORE trigger so only a moderator/HoD can set `questions.shared = true` (blocks a teacher self-publishing to the central bank). |
| `20260614_11_deletion_offboarding.sql` | APPLIED | `ai_usage.school_id` → ON DELETE SET NULL; adds `delete_class()` + `offboard_school()` RPCs (cascade practice data on a safe, authorised path). |
| `20260615_01_topic_map_crosswalk.sql` | APPLIED | `topic_map` table (retrieval objective-topic → ScienceKit planning unit, cross-DB, no FK); auto-maps the 13 KS4 topics by AQA code prefix. |
| `20260615_02_objective_mastery_views.sql` | APPLIED | `objective_mastery` + `class_weak_objectives` views (live per-class × per-objective mastery; `security_invoker`, so RLS-respecting). |
| `20260615_03_map_ks3_topics_assisted.sql` | APPLIED | Assisted semantic crosswalk: KS3 retrieval topics → ScienceKit Y7/Y8 units (`confidence='assisted'`). |
| `20260615_04_map_ks3_gas_exchange_block.sql` | APPLIED | Patch: maps the omitted Y8.11–20 gas-exchange/respiration block. |
| `20260615_05_class_unit_gaps_rpc.sql` | APPLIED · superseded by `20260615_06` + `20260618_02` | Cross-app aggregate weak-objectives RPC for one ScienceKit unit. |
| `20260615_06_gate_class_unit_gaps_shared_secret.sql` | APPLIED · superseded by `20260618_02` | Gates `class_unit_gaps` behind the `x-sciencekit-key` header. (The literal secret it inlined is removed by `20260618_02`.) |
| `20260615_07_class_link_and_teaching_log.sql` | APPLIED | `class_link` table (formal SK↔retrieval class join, replaces the `retrieval_class_ids[]` pointer) + `teaching_log` view. **Backfill is out-of-band** (env-specific ids, not committed). |
| `20260615_08_topic_preview_questions_rpc.sql` | APPLIED · superseded by `20260618_01` | Anon read-only question preview (no `model_answer`) for the ScienceKit lesson-page embed. |
| `20260615_09_curriculum_correction_ks3.sql` | APPLIED | New Springboard KS3 map: unlinks the retired Y8.x scheme + Year-9-bound strands (KS3 mapped 106 → 61). |
| `20260616_01_classes_insert_staff_secdef.sql` | APPLIED | `is_staff()` SECURITY DEFINER helper; `classes_insert_teacher` routes its role check through it (hardening, no behaviour change). |
| `20260616_02_classes_select_own_teacher.sql` | APPLIED | **Fix:** teachers couldn't create a class — the `RETURNING` row failed `classes_select`. Adds a direct `teacher_id = auth.uid()` predicate. |
| `20260616_03_topic_resources.sql` | APPLIED | `topic_resources` table (objective-topic → interactive-science.com tool/widget/booklet, cross-site, no FK). Powers the pupil "revise your weak spots" panel. |
| `20260616_04_map_topic_resources_interactive_science.sql` | APPLIED | Seeds 73 curated topic→resource links across 41 topics. (All 27 distinct URLs verified HTTP 200 on 2026-06-18.) |
| `20260616_10_class_weak_topics_rpc.sql` | APPLIED · gate updated by `20260618_02` | Class's weakest topics overall, for the half-term feedforward cron. Same shared-secret gate as `class_unit_gaps`. |
| `20260618_01_topic_preview_questions_shared_only.sql` | APPLIED | Adds `shared = true` to the anon preview so a private question's text isn't exposed through the open embed (supersedes `20260615_08`). |
| `20260618_02_sciencekit_key_from_db_setting.sql` | APPLIED | Moves the SK shared secret out of the function body into a locked-down `private.app_config` table; gate is fail-closed. Supersedes the inlined literal in `20260615_06` / `20260616_10`. |
| `20260621_01_topics_objective_id_and_subject_rpcs.sql` | APPLIED (2026-06-21) | Multi-subject + mastery-graph wiring. `topics.objective_id` (FK guarded on `objectives` existing); guarded mirror into `topic_objective_map`; the weakness RPCs return `subject_id` + take optional `p_subject` (filters on `subjects.name`). `class_weak_topics` rebuilt from its live (Phase-3) gate, backward-compatible; `student_weak_topics` + `class_intervention_list` added net-new. `topics.subject_id` was already present/indexed on the anchor, so §1 is idempotent replay-safety only. |
| `20260621_02_objective_mastery_objective_cols.sql` | APPLIED (2026-06-21) | Phase 2: `objective_mastery` view + `class_unit_gaps` RPC gain `objective_id`/`objective_title` (LEFT JOIN `topic_objective_map`→`objectives`), so the feynman planner groups unit gaps by objective. The anon-key client reads objective via the SECURITY DEFINER RPC — no table grants widened. Requires `20260621_01` + the feynman `mastery_graph_objectives` migration first (the objective tables). |
| `20260621_05_blended_objective_mastery.sql` | APPLIED (2026-06-21) | Phase 2 (blend): `pupil_objective_mastery` view (per class×pupil×objective, blends retrieval + past-paper into one mark-weighted %, security_invoker) + `class_objective_breakdown(p_class_id[,p_unit_id[,p_limit]])` RPC (class rollup per objective, blended + retrieval/paper split, identity-gated + secret). The per-pupil × per-objective mastery node. Requires the objective tables (`20260621_01` + feynman `mastery_graph_objectives`). |
| `20260821_01_cost_controls_and_ai_usage_metadata.sql` | APPLIED (2026-08-21) | Adds end-to-end AI telemetry fields; server-only marking idempotency claims; request IDs on response rows; hash caches for question generation, misconception mining, paper parsing and feedforward; model-aware cost summary. |
| `20260821_02_idempotency_stale_claim_recovery.sql` | APPLIED (2026-08-21) | Lets a retry reclaim a marking request abandoned by a terminated worker after five minutes, while preserving normal replay coalescing. |
| `20260822_01_teacher_assignment_intervention_loop.sql` | PENDING | Adds targeted retrieval assignments and measurable pupil outcomes; marking provenance/review audit fields; scheduled paper instructions, deadlines and attempt limits; supporting RLS, grants and integrity triggers. Deploy with the matching web and `mark-answer` changes. |

## Replaying on a fresh database

Apply the files in **filename order** — they are date-prefixed and ordering is
correct alphabetically (later files supersede earlier ones in place via
`create or replace`). Two things are **deliberately not in the SQL** and must be
done out-of-band:

1. **The ScienceKit shared secret** (`20260618_02`): after applying, run
   ```sql
   insert into private.app_config(key, value)
   values ('sciencekit_key', '<the real secret>')
   on conflict (key) do update set value = excluded.value;
   ```
   The value is the `SK_API_KEY` used by the feynman-education client. Until it's
   set, the cross-app gaps RPCs fail **closed** (return no rows) — by design.
2. **The `class_link` backfill** (`20260615_07`): env-specific class ids, run
   manually.

Not-yet-safe migrations (gated on a precondition like a client cutover) live in
`db/migrations/pending/` and are promoted up once applied — see that folder's
README. There are currently none.

After applying, run the RLS regression suite to confirm the gates hold:

```bash
psql "$DATABASE_URL" -f tests/rls_test.sql
```
