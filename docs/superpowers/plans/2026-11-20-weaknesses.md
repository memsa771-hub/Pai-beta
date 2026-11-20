# Weaknesses in the Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Vault knows where a student needs to put in work: weaknesses the student states, plus weak subjects read from their marks, shown in the Mirror/profile, used by the Path engine (status `work`) and the Roadmap ("Strengthen <subject>" step).

**Architecture:** A new catalog item type `weakness` (no migration; `vault_items.item_type` is free text). Derived weak subjects are a pure function over the Vault view rows, computed on read and never stored. A new area `weaknesses` sits outside the completeness meter. All thresholds, subject names and copy live in data files.

**Tech Stack:** FastAPI + SQLAlchemy + pytest (backend), Next.js + vitest (frontend), JSON policy files, Markdown prompts.

**Spec:** `docs/superpowers/specs/2026-11-20-weaknesses-design.md`

## Global Constraints

- No migration, no new table. No `.env` edits. No live model/API calls in tests.
- No hardcoded subject, threshold, wording or country in Python; data files only.
- Prompts are `.md`; any prompt change is mirrored in `docs/counselor/COUNSELOR_V3_PROMPTS.md` (sync tests compare).
- UI copy English only. Examples of student speech in Roman Urdu, never Hindi words or Devanagari.
- Weaknesses are study-only: kinds `subject`, `language`, `study_skill`, `test_skill`, `habit`.
- A weakness is never inferred from chat, never blocks a path, never removes eligibility.
- Default thresholds: `absolute_floor_percent` 50, `below_own_average_points` 15, `min_courses` 3.
- Item `freshness_days` 180, `conflict` `latest_wins`. Area label "Areas to work on".
- Backend tests: from `backend/`, `env -u PAI_API_KEY python -m pytest -q -p no:cacheprovider`. Frontend: `npm test` in `frontend/` (run inside the frontend Docker image or after `npm ci` if `node_modules` is absent).
- Branch: `backup-main` (founder's instruction for this work). Commit after each task.

## Review Focus

1. A course row with grade letters only (O-level "B", "C") and no percent — must map through the grade table or be skipped, never crash or count as 0 %.
2. A student with only 1–2 scored courses — no relative-rule weakness; only the absolute floor applies to those courses.
3. Stated weakness "Maths" and derived weak subject Mathematics at once — one Mirror entry, both evidences, not two.
4. A student with good marks and no stated weakness — Mirror "known X of Y" and completeness `known/total` identical to before this change.
5. The analyzer returns `work` for a path with only one `have` item — the path is dropped (work never counts toward `min_fit_evidence`).

Each line has its pinning test in the owning task (Tasks 4, 4, 5, 3/6, 7).

---

### Task 1: Catalog — `weakness` item, `weakness_kinds`, general `subjects` list

**Files:**
- Modify: `backend/app/memory/catalog/vault_catalog.json` (`choices`, `types` after `strength` ~line 3240)
- Modify: `backend/app/memory/reconciler_policy.json:7` (identity), `backend/app/memory/vault_view.json` (~line 177, display)
- Test: `backend/tests/test_vault_catalog.py`

**Interfaces:**
- Produces: catalog type `weakness` with schema `{text: str (1–500, required), basis: str (1–500), kind: enum weakness_kinds, subject: str}`, `additionalProperties: false`, `identity: ["text"]`, `choice_fields: {"kind": "weakness_kinds", "subject": "subjects"}`, `inputs: ["chat","story"]`, `storage: "item"`, `shown_on: "story"`, `sensitivity: "normal"`, `freshness_days: 180`.
- Produces: choice list `subjects` (codes aligned with `o_level_subjects` codes: `mathematics`, `physics`, `chemistry`, `biology`, `english`, `urdu`, `computer_science`, `islamiyat`, `pakistan_studies`, `general_science`, `statistics`, `economics`, `accounting`, …) each with English synonyms ("maths", "math", "riazi" is Urdu-in-Latin and allowed). `vault_catalog().choice_code("subjects", "Maths")` → `"mathematics"`.

- [ ] **Step 1: Write failing tests** in `test_vault_catalog.py`:
  - `test_weakness_item_type`: `spec = vault_catalog().type("weakness")`; assert `spec.storage == "item"`, `"chat" in spec.inputs`, freshness 180; `validate_schema_instance(spec.schema, {"text": "Mathematics", "basis": "Says maths is hard", "kind": "subject", "subject": "mathematics"})` passes; `{"text": "Lazy", "mood": "x"}` raises.
  - `test_subjects_choice_list_matches_synonyms`: `choice_code("subjects", "Maths") == "mathematics"`, `choice_code("subjects", "Physics") == "physics"`, `choice_code("subjects", "Computer") == "computer_science"`.
- [ ] **Step 2: Run** `env -u PAI_API_KEY python -m pytest -q -p no:cacheprovider tests/test_vault_catalog.py -k "weakness or subjects_choice"` → FAIL.
- [ ] **Step 3: Add the catalog entries**; reconciler identity `"weakness": "text"`; vault_view display `"weakness": {"fields": ["text", "basis"], "join": " — "}`.
- [ ] **Step 4: Run** the whole `tests/test_vault_catalog.py` → PASS (catalog self-validation included).
- [ ] **Step 5: Commit** `feat(vault): weakness item type and general subjects list`.

### Task 2: Extraction of stated weaknesses

**Files:**
- Modify: `backend/app/memory/prompts/extractor.md` (new Weaknesses paragraph after the Strengths rule, line 19)
- Modify: `backend/app/memory/extractor.py` (vault-item branch, after schema validation ~line 690)
- Modify: `docs/counselor/COUNSELOR_V3_PROMPTS.md` ("Memory extractor" section)
- Modify: `backend/scripts/eval/vault_golden.py` (golden cases)
- Test: `backend/tests/test_extractor_rules.py`

**Interfaces:**
- Consumes: Task 1 `weakness` type.
- Produces: extractor emits `vault_item` candidates with `key == "weakness"`; never with `evidence.inferred`.

Prompt rule content (exact meaning, wording the builder's): a weakness is what the student says they find hard or do poorly in ("maths mein kamzor hoon", "English bolna mushkil lagta hai", "paper mein hamesha time khatam ho jata hai"); `text` names the weak spot in 1–3 English words, `basis` says in English, third person, what they said; `kind` and, for a subject, `subject` code. Someone else's opinion goes in `basis` ("Teacher says physics is weak"). Never inferred. A dislike alone ("biology acha nahi lagta") is not a weakness (the existing dislike rule at line 16 stays). Personality labels ("lazy", "not smart") are never weaknesses.

- [ ] **Step 1: Write failing tests**:
  - `test_inferred_weakness_is_dropped`: feed the vault-item validator a raw candidate `{"candidate_type": "vault_item", "key": "weakness", "proposed_value": {"text": "Mathematics"}, "evidence": {"inferred": true}, ...}` (use the file's existing helper for building a turn/candidate); assert it is dropped with a reason containing `"inferred weakness"`.
  - `test_stated_weakness_is_kept`: same without `inferred`; assert an `ExtractedCandidate` with `key == "weakness"`.
  - `test_extractor_prompt_has_weakness_rule`: `extractor.md` contains `"Weaknesses:"` and `"Never inferred"`; and the existing doc-sync assertion still holds (extend it if it compares paragraph lists).
- [ ] **Step 2: Run** `pytest tests/test_extractor_rules.py -k weakness` → FAIL.
- [ ] **Step 3: Implement**: in the vault-item branch, `if key == "weakness" and evidence.get("inferred"): return drop("inferred weakness")`. Add the prompt paragraph; copy it into COUNSELOR_V3_PROMPTS.md. Add 3 golden cases (stated subject, teacher's opinion, dislike → no weakness).
- [ ] **Step 4: Run** `pytest tests/test_extractor_rules.py` → PASS.
- [ ] **Step 5: Commit** `feat(memory): extract stated weaknesses, never inferred`.

### Task 3: Area `weaknesses` outside the completeness meter

**Files:**
- Modify: `backend/app/pai_c/understanding/areas.json` (new area after `strengths`)
- Modify: `backend/app/pai_c/policy/areas_policy.json` (`outside_meter`, `labels`, `topic_text`, `questions`, `only_if_mentioned`; NOT `priority`)
- Modify: `backend/app/pai_c/completeness.py:21-41`
- Modify: `backend/app/pai_c/policy/question_bank.json` (one entry, area `weaknesses`)
- Test: `backend/tests/test_vault_completeness.py`, `backend/tests/test_spine_areas.py`

**Interfaces:**
- Produces: `areas.json` area `"weaknesses": {"min_items": 1, "sources": [{"vault_items": ["weakness"], "group": "weakness"}]}`.
- Produces: `areas_policy.json["outside_meter"] == ["weaknesses"]`; `completeness_from` and `unknown_areas` ignore every area in `outside_meter` (not in `known`, `total`, `areas`, `unknowns`).
- Produces: label `"weaknesses": "Areas to work on"`; topic text `"which subjects or study skills feel hard for them"`.

- [ ] **Step 1: Write failing tests**:
  - `test_weaknesses_area_outside_meter`: completeness for an onboarding-only student has the same `known`/`total` as `completeness_from` over the coverage without the `weaknesses` key; `"weaknesses"` absent from `areas` and `unknowns`.
  - `test_stated_weakness_covers_area`: `_item(db, ws, "weakness", {"text": "Mathematics"})`; `MemoryService(db).coverage_areas(ws)["weaknesses"]["covered"] is True`.
  - `test_next_question_never_asks_weaknesses` (in the file's next-question section): state with every priority area known → next question is not area `weaknesses`.
- [ ] **Step 2: Run** those tests → FAIL.
- [ ] **Step 3: Implement** the data entries and the `outside_meter` filter in `completeness_from`/`unknown_areas` (read the list from the policy, default `[]`). Bank question: id `effort`, area `weaknesses`, vault_types `["weakness"]`, prompt "Which subject takes you the most effort?", followup "What makes it hard?".
- [ ] **Step 4: Run** `pytest tests/test_vault_completeness.py tests/test_spine_areas.py` plus the question-bank/guided-table tests that load `question_bank.json` → PASS.
- [ ] **Step 5: Commit** `feat(vault): weaknesses area outside the completeness meter`.

### Task 4: Derived weak subjects

**Files:**
- Create: `backend/app/pai_c/policy/weaknesses.json`
- Create: `backend/app/pai_c/understanding/weak_subjects.py`
- Test: `backend/tests/test_weak_subjects.py`

**Interfaces:**
- Consumes: Task 1 `subjects` list; `marks_percent` from `app/pai_c/roadmap/engine.py:87`; `entry_ref` and Vault view rows (`MemoryService.vault_rows`).
- Produces: `weak_subjects(rows: list) -> list[dict]`, each `{"ref": "course:<id>", "subject": str | None, "name": str, "percent": float, "average": float, "rule": "floor" | "below_average", "evidence": <the course row's level>}` sorted lowest percent first.
- Produces: `weaknesses.json` = `{"absolute_floor_percent": 50, "below_own_average_points": 15, "min_courses": 3, "grade_percent": {"A*": 90, "A": 80, "B": 70, "C": 60, "D": 50, "E": 40, "U": 0}}`.

Algorithm: group `course` rows by `education_id`; take education records newest first (current, then by end/start date, as `current_education` orders them) and pick the first whose scored courses number ≥ `min_courses`; if none has enough, use the education with the most scored courses (floor rule only). Course percent = `marks_percent({"result": score})`, else `grade_percent[grade.upper()]`, else skip. Average over that education's scored courses. Weak when `percent < floor` or (`count ≥ min_courses` and `average - percent ≥ points`). Skip restricted and stale rows.

- [ ] **Step 1: Write failing tests** (build rows with the same helpers `test_mirror_engine.py` uses):
  - `test_below_floor_is_weak`: courses Maths 45, Physics 70, Chemistry 72 → Maths weak, rule `floor`, subject `mathematics`.
  - `test_far_below_own_average_is_weak`: Maths 58, Physics 80, Chemistry 84, English 80 → Maths weak, rule `below_average`.
  - `test_too_few_courses_only_floor`: two courses 58, 90 → nothing; two courses 40, 90 → the 40 one.
  - `test_grade_letters_map`: O-level grades A, A, D, A → the D one weak; a grade "X" is skipped, no error.
  - `test_falls_back_to_education_with_marks`: current FSc record with no courses + completed Matric with 4 scored courses → Matric's weak subject returned.
  - `test_evidence_follows_course_row`: course row with level `shown` → entry `evidence == "shown"`.
  - `test_no_courses_returns_empty`.
- [ ] **Step 2: Run** `pytest tests/test_weak_subjects.py` → FAIL (module missing).
- [ ] **Step 3: Implement** `weak_subjects(rows)` in `weak_subjects.py`, loading `weaknesses.json` with the existing `load_data` helper.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(vault): weak subjects from the student's own marks`.

### Task 5: Mirror shows "Areas to work on"

**Files:**
- Modify: `backend/app/pai_c/mirror/engine.py:146-160`
- Test: `backend/tests/test_mirror_engine.py`

**Interfaces:**
- Consumes: Task 3 `outside_meter`; Task 4 `weak_subjects(rows)`.
- Produces: card areas keep the `priority` areas as today, then each `outside_meter` area **only when it has entries**, with an extra key `"meter": False` (priority areas get `"meter": True`). Weaknesses entries: stated items as today's `_entry`, then derived ones `{"id": ref, "text": "<name>: <percent>% (your average <average>%)", "evidence": ..., "source_label": source_label(row), "observed_at": ...}`. A stated weakness whose `subject` equals a derived entry's `subject` is merged: one entry with the stated text, `"also": [derived ref]` and the stronger evidence level.
- The `version` hash must include the new area (it does, via `card_version`).

- [ ] **Step 1: Write failing tests**:
  - `test_weaknesses_area_absent_without_entries`: card for `_education` only → no area with key `weaknesses`.
  - `test_weaknesses_area_from_stated_item`: `_item(db, ws, "weakness", {"text": "Spoken English", "kind": "language"})` → area present, `meter is False`, one entry with that text.
  - `test_weaknesses_area_from_marks`: four courses (Maths 45 shown) → entry text starts `"Mathematics: 45%"`, evidence `shown`.
  - `test_stated_and_derived_same_subject_merge`: stated `{"text": "Maths", "kind": "subject", "subject": "mathematics"}` + Maths 45 course → exactly one weaknesses entry.
  - `test_priority_areas_carry_meter_true`.
- [ ] **Step 2: Run** `pytest tests/test_mirror_engine.py -k "weakness or meter"` → FAIL.
- [ ] **Step 3: Implement** in `MirrorEngine.build`.
- [ ] **Step 4: Run** the full `tests/test_mirror_engine.py` and `tests/test_mirror_text_job.py` → PASS.
- [ ] **Step 5: Commit** `feat(mirror): areas to work on`.

### Task 6: Frontend — area meta, profile story, Mirror count

**Files:**
- Modify: `frontend/components/counselor/workspace/profile-layout.json` (`areaMeta.weaknesses` {icon from the existing icon set, e.g. `"target"` or `"gauge"`, tone `"amber"` or another existing tone}, `story.weaknesses` "Where extra work will pay off, and how we know.", `storyAreas.weaknesses: ["weakness"]`)
- Modify: `frontend/components/counselor/workspace/mirror-parts.tsx:68` (count only areas with `meter !== false`) and the Mirror card type (`meter?: boolean`) wherever the card type is declared (`frontend/lib`).
- Test: `frontend/components/counselor/workspace/mirror.test.tsx`, `profile.test.tsx`

**Interfaces:**
- Consumes: Task 5 card shape (`meter`).
- Profile story shows **stated** weaknesses (editable through existing Vault controls); derived weak subjects appear on the Mirror only (their marks are already on the profile's education section).

- [ ] **Step 1: Write failing tests**:
  - mirror: a card fixture with 10 meter areas (3 known) plus `{key: "weaknesses", meter: false, level: 1, entries: [...]}` → the known chip reads "3 of 10" (whatever `t.known` renders with known 3, total 10), and an "Areas to work on" section renders.
  - profile: a Vault fixture with a `weakness` item → it appears under the "Areas to work on" story heading, not under `storyFallbackArea`.
- [ ] **Step 2: Run** `npm test -- mirror profile` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` and `npm run build` → PASS.
- [ ] **Step 5: Commit** `feat(frontend): areas to work on in Mirror and profile`.

### Task 7: Path engine — status `work`

**Files:**
- Modify: `backend/app/pai_c/paths/analyzer.py:60` (Literal), and where the analyzer context is built (`analyzer.py` ~142-145, `profile_cards`) to add a `<weak_subjects>` block
- Modify: `backend/app/pai_c/policy/path_analyzer.json` (`statuses`, `evidence_item_types` + `weakness`, `vault_trigger_types` + `weakness`, `course`; `evidenced_statuses` + `work`; `fit_evidence_statuses` unchanged)
- Modify: `backend/app/pai_c/deep/prompts/path_analyzer.md:11` (rewrite the "found hard, their marks" sentence into the `work` rule) and `docs/counselor/COUNSELOR_V3_PROMPTS.md` ("360-degree path analyzer")
- Modify: path explain if it enumerates statuses (`backend/app/pai_c/paths/explain.py`)
- Check: `backend/app/memory/completeness.py` `relevance_version` still behaves with `course` added (it reads `vault_trigger_types`)
- Test: `backend/tests/test_path_analyzer.py`

**Interfaces:**
- Consumes: Task 4 `weak_subjects(rows)`; Task 1 `weakness` items.
- Produces: `FitItem.status: Literal["have", "partial", "blocker", "unknown", "work"]`. `work` = a demand of the path that hits a weakness; never in `fit_evidence_statuses`; never blocks.

Prompt rule meaning: when a field demands something the student is weak in (stated weakness or a line in `<weak_subjects>`), that fit item is `work`, citing the evidence, its note says what it takes in numbers when known ("needs strong maths; maths 58% against your 74% average"). A weakness alone never removes a field.

- [ ] **Step 1: Write failing tests**:
  - `test_work_status_accepted`: a fake model response with a fit item `status: "work"` parses into `FitItem`.
  - `test_work_never_counts_toward_min_fit`: a path with one `have` + one `work` is dropped (min_fit_evidence 2); with two `have` + one `work` it is kept.
  - `test_course_change_triggers_reanalysis`: `"course" in policy()["vault_trigger_types"]` and a course write changes `relevance_version` (use the existing trigger test pattern in the file).
  - `test_context_has_weak_subjects`: context built for a student with Maths 45 contains a `<weak_subjects>` block naming Mathematics.
  - The existing prompt/doc sync test passes with the edited prompt.
- [ ] **Step 2: Run** `pytest tests/test_path_analyzer.py -k "work or weak or course_change"` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pytest tests/test_path_analyzer.py tests/test_field_research.py` → PASS.
- [ ] **Step 5: Commit** `feat(paths): needs-work fit status from weaknesses`.

### Task 8: Frontend — `work` fit status

**Files:**
- Modify: `frontend/lib/possibilities.ts:7` (status union + doc comment), `frontend/components/counselor/path-card.tsx:73,110,118` (icon, `bg-warning` amber dot, count), `frontend/components/counselor/workspace/copy.json:66,557` (`"work": "Needs work"`, `fitDots` gains `{work} need work`)
- Test: `frontend/components/counselor/possibilities.test.tsx` or `workspace/paths.test.tsx`

**Interfaces:** Consumes Task 7 status `work`.

- [ ] **Step 1: Write failing test**: a possibility with fit `[have, work]` renders the label "Needs work" and an amber dot; fitDots text includes "1 need work".
- [ ] **Step 2: Run** `npm test -- possibilities paths` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` and `npm run build` → PASS.
- [ ] **Step 5: Commit** `feat(frontend): needs-work fit status`.

### Task 9: Roadmap — "Strengthen <subject>" step

**Files:**
- Modify: `backend/app/pai_c/roadmap/steps.py` (`route_steps`, new `_strengthen`)
- Modify: `backend/app/pai_c/policy/roadmap.json` (`order` gets `strengthen` after `marks`; copy `"step_strengthen": "Strengthen {subject}"`; `tickable_kinds` unchanged — strengthen is not tickable)
- Modify: `frontend/components/counselor/workspace/copy.json` (same copy key) if step copy is rendered from the frontend copy
- Test: `backend/tests/test_roadmap_steps.py`, `frontend/components/counselor/workspace/roadmap.test.tsx`

**Interfaces:**
- Consumes: Task 4 `weak_subjects(rows)`; Task 1 `subjects` list; `Rule.required_subjects` (`app/pai_c/roadmap/rules.py:39`).
- Produces: `_strengthen(rule: Rule | None, rows: list) -> list[dict]` — for each subject in `rule.required_subjects` (mapped with `choice_code("subjects", name)`), one step `_step(f"strengthen:{code}", "step_strengthen", {"subject": <label>}, "not", <weakness row>)` when a current non-stale stated `weakness` item with that `subject` or a derived weak subject with that code exists. Stated item wins as evidence row when both. Inserted after the marks step.

- [ ] **Step 1: Write failing tests**:
  - `test_strengthen_step_for_required_weak_subject`: engineering card, courses with Maths 45 → a step key `strengthen:mathematics`, colour red, evidence present.
  - `test_no_strengthen_step_for_unrelated_weakness`: engineering card, stated weakness `{"text": "Biology", "kind": "subject", "subject": "biology"}` → no strengthen step.
  - `test_strengthen_step_disappears_when_marks_improve`: Maths course 75 → no strengthen step.
  - `test_strengthen_step_not_tickable`.
  - frontend: a step `{key: "strengthen:mathematics", label_key: "step_strengthen", values: {subject: "Mathematics"}}` renders "Strengthen Mathematics".
- [ ] **Step 2: Run** `pytest tests/test_roadmap_steps.py -k strengthen` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pytest tests/test_roadmap_steps.py tests/test_roadmap_engine.py tests/test_roadmap_api.py tests/test_roadmap_timeline.py`, `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(roadmap): strengthen step for a weak required subject`.

### Task 10: Counselor voice and final check

**Files:**
- Modify: `backend/app/pai_c/voice/prompts/voice.md` (one rule) and `docs/counselor/COUNSELOR_V3_PROMPTS.md` section 1
- Modify: `docs/counselor/VAULT_SPEC.md` and `docs/counselor/DECISIONS.md` (one dated entry each: weakness item, outside-meter area, `work` status, strengthen step)

Rule meaning: when PAI speaks about a weakness it names it plainly with its evidence and pairs it with one concrete next action; never judgement words ("weak student", "bad at", "kamzor bachay"), never pity, never praise.

- [ ] **Step 1:** Add the rule and its doc copy; run the voice prompt sync test (`pytest tests -k "prompt and sync"` or the test file that compares `voice.md`) → PASS.
- [ ] **Step 2:** Full backend suite `env -u PAI_API_KEY python -m pytest -q -p no:cacheprovider` → PASS; frontend `npm test && npm run build` → PASS.
- [ ] **Step 3: Commit** `docs(counselor): weaknesses in voice, Vault spec and decisions`.
