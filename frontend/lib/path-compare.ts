/** The Paths Compare table payload (GET /v1/counselor/possibilities/compare),
 * computed by the backend eligibility check (backend/app/pai_c/paths/eligibility.py)
 * from the student's education in the Vault. Reasons and needs are copy keys
 * with values; the table renders them from copy.json `compare`. */

export type Eligibility = "open" | "step" | "not_open" | "unknown";

export type RouteGroup = { code: string; label: string; route_label?: string };

/** A copy key with its values, e.g. {key: "needs_percent", min: 60, have: 55}. */
export type CopyItem = { key: string; [value: string]: unknown };

export type RouteNeed = { kind: "marks" | "bridge" | "check" | "group"; detail: Record<string, unknown> };

export type EntryTest = { name: string; body?: string; pass_percent: number | null; source?: string };

export type Verdict = {
  status: Eligibility;
  reasons: CopyItem[];
  needs: RouteNeed[];
  tests: EntryTest[];
  years: number | null;
  min_percent: number | null;
  student_percent: number | null;
  /** How sure the admission rule is, and where it comes from. */
  confidence: "official" | "secondary" | "uncertain" | null;
  sources: string[];
};

/** The student's education as data: "From FSc Pre-Engineering, 78%". */
export type EducationLine = {
  level: string;
  level_label: string;
  groups: { code: string; label: string }[];
  percent: number | null;
};

export type PathComparison = {
  education_line: EducationLine | null;
  /** When the admission rules were last checked, "YYYY-MM". */
  rules_as_of?: string | null;
  paths: { id: string; verdict: Verdict }[];
};
