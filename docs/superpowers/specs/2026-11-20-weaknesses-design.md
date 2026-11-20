# Weaknesses in the Vault — design (20 Nov 2026)

## Intent

Placement AI should know the student the way a good counselor does: what they are good at **and** where they
need to put in work. Today the Vault holds strengths (area `strengths`, item `strength`) but has no home for a
weakness. Worse, the extractor prompt tells the model to drop a dislike ("biology acha nahi lagta") and nothing
captures "maths mein kamzor hoon", so what the student says about their weak spots is lost.

Founder decision: approach **C** — weaknesses come from two sources:
1. **Stated**: what the student says they find hard or do poorly in (new Vault item `weakness`).
2. **Shown/derived**: subjects where the student's own marks are low, read from existing `course` records.

Both feed the Mirror/profile, the Path engine ("evidence against" a path) and the Roadmap (steps to work on a
weakness that matters for the chosen route).

## Goals
- A weakness the student states is saved with evidence and shown back to them.
- Weak subjects are found from marks without the student having to say anything.
- A path whose demands hit a weakness says so in its fit (evidence against), honestly.
- The chosen route's roadmap shows what to strengthen when a weakness bears on it.

## Non-goals
- No new database tables or migrations (`vault_items.item_type` is free text).
- No study-abroad work (that is the next, separate project).
- No psychological or personality "weaknesses" ("lazy", "not smart"). Weaknesses are about study: subjects,
  study skills, language, test skills, habits that affect study.
- No onboarding change.

## Anti-goals (a failure even if it works)
- PAI sounds like it is judging or labelling the student. Product voice stays straightforward: no lectures, no
  praise, no pity.
- PAI invents a weakness the student never said and the marks do not show (no inferred weaknesses from chat).
- A weakness blocks a path. It only informs fit and adds work steps; eligibility stays the admission rules' job.
- Any hardcoded subject, threshold, country or wording in Python. All of it lives in data files.

## Constraints (from CLAUDE.md and memory)
- No fact about the student without evidence (stated / shown / confirmed).
- UI copy in English only; chat in the student's language. Roman Urdu never Hindi in any example.
- Prompts live in `.md`; when a prompt changes, sync `docs/counselor/COUNSELOR_V3_PROMPTS.md` (tests compare).
- No live model calls in tests.

## Approaches considered
- **A. New item only (stated).** Simple, but students rarely say their weaknesses aloud.
- **B. Derived only (marks + path "against").** No extraction change, but loses "English bolna mushkil hai".
- **C. Both (chosen).** Marks are the strongest evidence (shown); the student's words catch what marks cannot.
  Built in two parts: part 1 = stated item end to end; part 2 = derived weak subjects + roadmap steps.

## Design

### 1. Vault item `weakness` (stated)
Catalog entry in `memory/catalog/vault_catalog.json`, modelled on `strength`:
- `storage: item`, `shown_on: story`, `inputs: [chat, story]`, `sensitivity: normal`,
  `conflict: latest_wins`, `freshness_days: 180` (weaknesses change faster than strengths).
- Schema: `text` (the weak spot in English, 1–3 words: "Mathematics", "Spoken English", "Time management"),
  `basis` (what the student said or did that shows it, English), optional `kind` code from a new choice list
  `weakness_kinds`: `subject`, `language`, `study_skill`, `test_skill`, `habit`; optional `subject` code when
  `kind` is `subject`.
- **Subject codes (decided):** add one general `subjects` choice list to the catalog covering Matric and
  Intermediate subjects (Mathematics, Physics, Chemistry, Biology, English, Urdu, Computer Science, …) with
  synonyms, codes aligned with the existing O-level/A-level lists. The item's `subject`, matching a `course`
  name to a subject, and merging stated with derived all use this one list (catalog `choice_code` lookup on
  `name`/`normalized_name`), not ad-hoc word terms.
- **Someone else's opinion (decided):** "teacher says I'm weak in physics" is saved as a normal stated weakness
  whose `basis` says who said it ("Teacher says physics is weak"). No `attribution` field (the item branch of the
  extractor does not keep it, `memory/extractor.py:662-677`). It counts like any stated weakness; the basis shows
  the source to the student.
- Also: `reconciler_policy.json` identity (`weakness: "text"`), `vault_view.json` display (`text — basis`).
  (`memory/student_schema.py` holds record specs only; nothing to add there.) The legacy `growth_area` notebook
  concept (`pai_c/deep/migrate_v1.py:46`) is ignored.

### 2. Extraction
`memory/prompts/extractor.md` gains a Weaknesses rule next to the Strengths rule:
- A weakness is something the student says they find hard or do poorly in ("maths mein kamzor hoon",
  "English bolna mushkil lagta hai", "I always run out of time in papers"). Its text names the weak spot; its
  basis is what they said or did, in English, third person.
- **Never inferred.** Only stated weaknesses. The prompt says so, and the extractor's vault-item branch
  (`memory/extractor.py:677+`) also drops any `weakness` proposal carrying `"inferred": true` in code, because the
  general prompt rule (`extractor.md:4`) allows inferred items. A dislike alone ("biology acha nahi lagta") is still **not** a
  weakness (liking and ability differ); the existing dislike rule stays.
- Someone else's opinion ("teacher says I'm weak in physics") is stated with `attribution.claim_owner: external`.
- Sync `docs/counselor/COUNSELOR_V3_PROMPTS.md`; add extraction golden cases in `backend/scripts/eval/vault_golden.py`.

### 3. Derived weak subjects (shown)
New small module (e.g. `pai_c/understanding/weak_subjects.py`), computed **on read**, never stored as items
(so they cannot go stale or duplicate):
- Input: the `course` records of the **latest education that has at least `min_courses` scored courses**
  (decided). A student in FSc year 1 with no FSc marks yet gets their Matric/O-level weak subjects; once FSc marks
  arrive, those replace them. Courses map to subject codes through the catalog `subjects` list (section 1);
  an unmatched course still counts by its own name.
- Rule (all numbers in a data file, e.g. `pai_c/policy/weaknesses.json`): a subject is weak when its percent is
  below `absolute_floor_percent` **or** at least `below_own_average_points` below the student's own average
  across those courses. Needs at least `min_courses` scored courses for the relative rule. Grade letters map to
  percent through a data table (O/A level grades).
- Output entries carry the course row as evidence, so the evidence level is that row's (shown when from a result
  card, stated when the student only said the mark).
- A stated `weakness` for the same subject merges with the derived one in display (one entry, both evidences).

### 4. Areas, Mirror and profile
- `pai_c/understanding/areas.json`: new area `weaknesses` (`min_items: 1`) with sources: vault item `weakness`
  and the derived weak subjects.
- **Not in the completeness meter (decided).** A student with good marks may have no weakness to name, so the
  area must never count as "unknown" or lower completeness. It is excluded from `known/total` and from
  `unknowns`; the Mirror/profile show it only when it has entries.
- `pai_c/policy/areas_policy.json`: add `weaknesses` to `labels` (`"Areas to work on"`), topic text "which subjects
  or study skills feel hard for them", question key, and `only_if_mentioned` (PAI does not push the topic). It is
  not added to `priority`, so the next-question logic never asks for it on its own.
- `pai_c/policy/question_bank.json`: one gentle bank question for the area (e.g. "Which subject takes you the
  most effort?") so a follow-up exists when the student brings it up; never asked unprompted.
- Frontend `profile-layout.json`: `areaMeta.weaknesses` (icon and tone in the existing set), description
  "Where extra work will pay off, and how we know." English only.
- Mirror state card shows the area like the others; derived entries show their mark as the basis.
- The student can confirm, edit or remove a stated weakness through the existing Vault controls. Derived ones
  change only when marks change.

### 5. Path engine
- `pai_c/policy/path_analyzer.json`: add `weakness` to `evidence_item_types`; add `weakness` **and `course`** to
  `vault_trigger_types` (today a marks change does not re-run the analyzer; check the effect on
  `relevance_version` in `memory/completeness.py`); pass the derived weak subjects in the analyzer context.
- **New fit status `work` (decided).** Today's statuses are `have | partial | blocker | unknown`
  (`pai_c/paths/analyzer.py:60`). `partial` counts toward `min_fit_evidence` (would help keep a path) and
  `blocker` reads as "this stops you"; neither fits. Add `work` ("Needs work"): a demand of the path that hits a
  weakness. It is **not** in `fit_evidence_statuses`, never blocks, and renders amber in the frontend. Update the
  analyzer Literal, `path_analyzer.json` statuses, path explain, and frontend colours/labels.
- Analyzer prompt: a demand that hits a weakness gets status `work` with the fit text saying what it would take
  ("needs strong maths; maths is 58% against your 74% average"). The existing line about subjects found hard and
  marks (`pai_c/deep/prompts/path_analyzer.md:11`) is rewritten to this rule, not duplicated.
- Path explain "how it fits you" uses the same evidence (quotes must exist in student evidence, as today).

### 6. Roadmap
- **Demands come from existing admission data (decided):** a route's demanded subjects are the
  `required_subjects` of its field in `admission_rules.json` (e.g. engineering → Physics, Chemistry, Mathematics),
  mapped to subject codes through the catalog list. No separate `route_demands` table. Test and language demands
  (IELTS etc.) are out of v1; they come with the study-abroad project.
- For the chosen route, a current, non-stale weakness (stated or derived) in a demanded subject adds a step
  "Strengthen <subject>" with colour **not** (red) and the weakness as evidence.
- **No green state (decided).** Steps are rebuilt from current Vault rows (`pai_c/roadmap/steps.py:241-279`), so
  when the weakness is gone (better marks, removed by the student, or stale after 180 days) the step simply
  disappears. Showing green would need history and, for a stale item, would claim progress without evidence.
  The step is never tickable.
- Time estimate: from `roadmap.json` timeline data if a matching entry exists, else `unknown` (as other steps).
- The step is informational: it never blocks other steps or eligibility.

### 7. Counselor voice
- When PAI mentions a weakness it pairs it with a concrete next action, no judgement words ("weak student",
  "bad at"). Prompt guidance goes in the counselor prompt `.md` and its COUNSELOR_V3_PROMPTS copy.

## Tests (offline)
- Catalog/schema accepts a `weakness` item; reconciler identity works.
- Extractor rule text present and prompt/doc sync test passes; golden cases for stated, external, and a dislike
  that must not become a weakness.
- Extractor drops an inferred `weakness` in code.
- Weak-subject rule: absolute floor, relative rule, too few courses → nothing, grade mapping, evidence level
  follows the course row, fallback to the latest education with enough scored courses, course→subject matching.
- Completeness `known/total` and `unknowns` unchanged by the new area; Mirror and profile render it when it has
  entries; frontend label English.
- Analyzer: `work` status accepted, excluded from the min-fit count; `course` change triggers a re-run.
- Roadmap: strengthen step appears for a demanded weak subject and disappears when the weakness is gone.

## Left to the builder
- Exact file for the weak-subject function and how it plugs into `coverage_areas` / Vault view.
- Exact icon/tone choice within the existing set.
- Exact threshold defaults (suggested: floor 50 %, 15 points below own average, min 3 courses) and the grade
  table values; all in data.
- Order of commits inside part 1 and part 2.
