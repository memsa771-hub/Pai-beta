"use client";
/** Compare and Choose on the Paths page: the sticky Compare bar, the Compare
 * table (the same rows for every path, read from the backend eligibility
 * check) and the one confirm before a path becomes the student's choice.
 * Words come from copy.json `compare` and the paths keys. */
import { useEffect, useState } from "react";
import { Check, Columns2, ExternalLink, Info, X } from "lucide-react";
import { workspaceApi } from "@/lib/api";
import type { Possibility } from "@/lib/possibilities";
import type { CopyItem, Eligibility, PathComparison, RouteGroup, RouteNeed, Verdict } from "@/lib/path-compare";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/responsive-dialog";
import { Skeletons, StatChip, toneClass, type Tone } from "@/components/pai";
import { FitDots, initials } from "@/components/counselor/path-card";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/i18n/format";
import { DEFAULT_LOCALE } from "@/lib/i18n/locales";
import copy from "./copy.json";

const t = copy.compare;
export const COMPARE_LIMITS = t.limits;
const STATUS_TONE: Record<Eligibility, Tone | "success" | "warning" | "neutral"> = {
  open: "success", step: "warning", not_open: "neutral", unknown: "sky",
};

export const fill = (template: string, values: Record<string, unknown>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replaceAll(`{${key}}`, value == null ? "" : String(value)), template);

/** A group list as a Matric student chooses it: "FSc Pre-Engineering or ICS". */
const groupsText = (groups: unknown) =>
  (Array.isArray(groups) ? (groups as RouteGroup[]) : []).map((g) => g.route_label || g.label).join(t.groupJoiner);

/** One reason: its template with the values filled in. */
export function render(item: CopyItem): string {
  const template = (t.templates as Record<string, string>)[item.key];
  if (!template) return "";
  const { key: _key, ...values } = item;
  return fill(template, { ...values, groups: groupsText(values.groups) }).replace(/\s+/g, " ").trim();
}

/** A short label for the Extra step cell, never the rule's long text. */
export function shortNeed(need: RouteNeed | undefined): string {
  const s = t.step;
  if (!need) return s.none;
  const d = need.detail || {};
  if (need.kind === "marks") return fill(s.marks, { min: d.min });
  if (need.kind === "bridge") return s.bridge;
  if (need.kind === "check") return s.check;
  return Array.isArray(d.groups) && d.groups.length ? fill(s.group, { groups: groupsText(d.groups) }) : s.any_group;
}

function StatusChip({ status }: { status: Eligibility }) {
  return <StatChip size="sm" tone={STATUS_TONE[status]} className="shrink-0">{t.status[status]}</StatChip>;
}

/** The eligibility badge on a path row. "Cannot check yet" stays off the row
 * (it would repeat on every path of a student PAI cannot check yet); the
 * Compare table still says it. */
export function EligibilityBadge({ status }: { status?: Eligibility }) {
  if (!status || status === "unknown") return null;
  return <span title={t.badgeTitle}><StatusChip status={status} /></span>;
}

/** The pick checkbox on a path row: its own 44px target. */
export function ComparePick({ path, picked, disabled, onPick }: {
  path: Possibility;
  picked: boolean;
  disabled: boolean;
  onPick: (on: boolean) => void;
}) {
  return (
    <label title={disabled ? fill(t.max, { n: t.limits.max }) : fill(t.toggle, { title: path.title })}
      className={cn("flex size-11 shrink-0 items-center justify-center rounded-full",
        disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:bg-accent")}>
      <input type="checkbox" checked={picked} disabled={disabled} onChange={(e) => onPick(e.target.checked)}
        aria-label={fill(t.toggle, { title: path.title })} className="size-[18px] cursor-[inherit] accent-[var(--brand)]" />
    </label>
  );
}

/** The floating bar once a path is picked: clear, or open the table. */
export function CompareBar({ count, onClear, onCompare }: { count: number; onClear: () => void; onCompare: () => void }) {
  if (!count) return null;
  const short = count < t.limits.min;
  return (
    <div className="pointer-events-none sticky bottom-4 z-20 mt-8 flex justify-center">
      <div className="pointer-events-auto flex max-w-full items-center gap-1.5 rounded-full bg-card p-1.5 shadow-lift ring-1 ring-border">
        <Button size="tap-icon" variant="ghost" className="rounded-full" aria-label={t.clear} onClick={onClear}>
          <X aria-hidden />
        </Button>
        <Button size="tap" disabled={short} onClick={onCompare} className={cn(short && "opacity-70")}>
          <Columns2 aria-hidden />
          {short ? fill(t.pickMore, { n: t.limits.min - count }) : fill(t.bar, { n: count })}
        </Button>
      </div>
    </div>
  );
}

const marksCell = (v: Verdict) => v.min_percent == null ? t.notKnown : v.student_percent == null
  ? `${v.min_percent}%` : fill(t.facts.marksCompare, { min: v.min_percent, have: v.student_percent });
const stepCell = (v: Verdict) => v.status === "not_open" ? render(v.reasons[0] || { key: "" }) || t.status.not_open
  : v.status === "unknown" ? render(v.reasons[0] || { key: "" }) || t.notKnown
    : (v.needs.length ? v.needs.map(shortNeed).join(", ") : shortNeed(undefined));
const testCell = (v: Verdict) => v.tests.map((test) => test.name).join(", ") || t.facts.noTest;
const yearsCell = (v: Verdict) => (v.years == null ? t.notKnown : fill(t.facts.years, { n: v.years }));
const host = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
};
/** "October 2026" from the rules' "2026-10"; empty when unknown. */
const monthYear = (asOf: string | null | undefined) =>
  asOf ? formatDate(`${asOf}-01`.slice(0, 10), DEFAULT_LOCALE, { month: "long", year: "numeric", timeZone: "UTC" }) : "";

/** Where a path's entry facts come from: the rule's confidence, a calm
 * "check with the university" note when it is not official, and its sources. */
function SourceCell({ verdict }: { verdict: Verdict }) {
  if (!verdict.confidence) return <>{t.notKnown}</>;
  const links = verdict.sources.filter((url) => url.startsWith("https://") && host(url));
  return (
    <div className="space-y-1.5">
      <StatChip size="sm" tone={verdict.confidence === "official" ? "success" : "neutral"}>{t.confidence[verdict.confidence]}</StatChip>
      {verdict.confidence !== "official" && (
        <p className="flex items-start gap-1 text-xs text-info-ink"><Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />{t.checkUniversity}</p>
      )}
      {links.map((url) => (
        <a key={url} href={url} target="_blank" rel="noopener noreferrer"
          className="flex min-h-9 max-w-full items-center gap-1 text-xs font-semibold text-brand-ink underline-offset-4 hover:underline">
          <ExternalLink aria-hidden className="size-3.5 shrink-0" /><span className="truncate">{host(url)}</span>
        </a>
      ))}
    </div>
  );
}

/** Same rows for every path so the eye reads across; on a phone the columns
 * scroll under sticky row labels. The eligibility rows are read when the
 * table opens, so they always follow the Vault as it is now. */
export function CompareDialog({ paths, tones, open, onOpenChange }: {
  paths: Possibility[];
  tones: Record<string, Tone>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [data, setData] = useState<PathComparison | null>(null),
    [error, setError] = useState(false);
  const ids = paths.map((p) => p.id).join(",");
  useEffect(() => {
    if (!open || !ids) return;
    let live = true;
    setData(null);
    setError(false);
    workspaceApi.comparePaths(ids.split(","))
      .then((result) => { if (live) setData(result); })
      .catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [open, ids]);
  const verdictOf = (id: string) => data?.paths.find((p) => p.id === id)?.verdict;
  const rows: [keyof typeof t.rows, (path: Possibility, v: Verdict | undefined) => React.ReactNode][] = [
    ["fit", (path) => path.fit?.length ? <FitDots items={path.fit} summary={copy.overview.fitDots} /> : t.notKnown],
    ["why", (path) => <span className="line-clamp-4 text-muted-foreground">{path.why}</span>],
    ["status", (_, v) => v ? <StatusChip status={v.status} /> : null],
    ["marks", (_, v) => v ? marksCell(v) : null],
    ["step", (_, v) => v ? stepCell(v) : null],
    ["test", (_, v) => v ? testCell(v) : null],
    ["years", (_, v) => v ? yearsCell(v) : null],
    ["source", (_, v) => v ? <SourceCell verdict={v} /> : null],
  ];
  const checked = monthYear(data?.rules_as_of);
  const label = "sticky left-0 z-10 w-28 min-w-28 bg-card py-3 pe-3 text-left align-top text-xs font-semibold text-muted-foreground sm:w-40 sm:min-w-40";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader className="space-y-2 px-7 pb-2 pt-7 max-lg:px-5 max-lg:pt-1">
          <DialogTitle className="text-xl">{t.title}</DialogTitle>
          <DialogDescription>{t.intro}</DialogDescription>
        </DialogHeader>
        <DialogBody className="px-7 pb-7 pt-2 max-lg:px-5">
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className={cn(label, "align-bottom")}><span className="sr-only">{t.corner}</span></th>
                  {paths.map((path) => {
                    const tone = toneClass[tones[path.id] || "blue"];
                    return (
                      <th key={path.id} scope="col" className="min-w-36 border-b border-border/70 px-3 pb-3 text-left align-bottom font-semibold">
                        <span className="flex items-center gap-2">
                          <span aria-hidden className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold", tone.soft, tone.ink)}>
                            {initials(path.title)}
                          </span>
                          <span className="leading-snug">{path.title}</span>
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map(([key, cell]) => (
                  <tr key={key}>
                    <th scope="row" className={cn(label, "border-b border-border/70")}>{t.rows[key]}</th>
                    {paths.map((path) => (
                      <td key={path.id} className="border-b border-border/70 px-3 py-3 align-top">{cell(path, verdictOf(path.id))}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data && !error && <div className="mt-4"><Skeletons variant="list" count={1} label={t.loading} /></div>}
          {checked && <p className="mt-4 text-xs text-muted-foreground">{fill(t.checked, { date: checked })}</p>}
          {error && <p role="alert" className="mt-4 text-sm font-medium text-danger-ink">{t.error}</p>}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/** One confirm before a path becomes the student's choice; choosing another
 * later replaces it. */
export function ChooseDialog({ path, onOpenChange, onChosen }: {
  path: Possibility | null;
  onOpenChange: (open: boolean) => void;
  onChosen: (path: Possibility) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    // The title keeps the last path while the dialog animates closed.
    [shown, setShown] = useState<Possibility | null>(path);
  useEffect(() => { if (path) { setError(false); setShown(path); } }, [path]);
  async function choose() {
    if (!path) return;
    setBusy(true);
    setError(false);
    try {
      await workspaceApi.changePossibility(path.id, "choose");
      onChosen(path);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={!!path} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="space-y-2 px-7 pb-2 pt-7">
          <DialogTitle className="text-xl">{fill(copy.chooseTitle, { title: shown?.title })}</DialogTitle>
          <DialogDescription>{copy.chooseBody}</DialogDescription>
        </DialogHeader>
        {error && <DialogBody className="px-7 py-1"><p role="alert" className="text-sm font-medium text-danger-ink">{copy.error}</p></DialogBody>}
        <DialogFooter className="px-7 pb-7 pt-2">
          <Button type="button" size="tap" variant="ghost" onClick={() => onOpenChange(false)}>{copy.chooseNo}</Button>
          <Button type="button" size="tap" disabled={busy} onClick={choose}><Check aria-hidden />{copy.chooseYes}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
