"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Bookmark, Check, Columns2, Compass, Info, Loader2, MessageCircle, Plus, X } from "lucide-react";
import { workspaceApi } from "@/lib/api";
import type { Possibility } from "@/lib/possibilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/responsive-dialog";
import { EmptyState, StatChip, toneClass, toneFor, tonesByOrder, type Tone } from "@/components/pai";
import { FieldNotes, FitDots, initials } from "@/components/counselor/path-card";
import { cn } from "@/lib/utils";
import { Heading, LoadState, useResource, human } from "./resource";
import { COMPARE_LIMITS, ChooseDialog, CompareBar, CompareDialog, ComparePick, EligibilityBadge, fill } from "./path-compare";
import type { Eligibility } from "@/lib/path-compare";
import copy from "./copy.json";

const list = () => workspaceApi.getPossibilities();
// async, so a failing call becomes a load error rather than a throw.
const analysisStatus = async () => workspaceApi.getPathAnalysis();
/** The workspace card surface (as on the Overview). */
const CARD = "rounded-[22px] bg-card shadow-card ring-1 ring-border/70";
const statusTone = { suggested: "blue", exploring: "blue", saved: "success", dismissed: "neutral", chosen: "success" } as const;

/** One path as a list row: the field, why it fits in a line, how it fits at a
 * glance, and the student's controls: Choose (or, once chosen, Ask PAI about
 * it in the chat), save, not for me, and the Compare tick. */
export function PathRow({
  path,
  onChange,
  onChoose,
  onAsk,
  pick,
  eligibility,
  tone,
}: {
  path: Possibility;
  tone?: Tone;
  /** Whether the student's education opens this path's field. */
  eligibility?: Eligibility;
  onChange: () => void;
  onChoose?: () => void;
  onAsk?: () => void;
  pick?: { picked: boolean; disabled: boolean; onPick: (on: boolean) => void };
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  async function act(action: "save" | "dismiss") {
    setBusy(true);
    try {
      await workspaceApi.changePossibility(path.id, action);
      onChange();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  const accent = toneClass[tone || toneFor(path.id)];
  return (
    <li className="relative flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-5 sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <span aria-hidden className={cn("flex size-10 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold", accent.soft, accent.ink)}>
          {initials(path.title)}
        </span>
        <div className="min-w-0 flex-1">
          <div className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-1", pick && "max-sm:pe-9")}>
            <h2 className="font-semibold leading-snug">{path.title}</h2>
            <FitDots items={path.fit || []} summary={copy.overview.fitDots} />
            <EligibilityBadge status={eligibility} />
            <FieldNotes field={path.study_field} />
          </div>
          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground sm:line-clamp-1">{path.why}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 ps-[3.375rem] sm:ps-0">
        <StatChip size="sm" tone={statusTone[path.status]}>
          {path.source === "student" && path.status === "saved" ? copy.ownPath : human(path.status)}
        </StatChip>
        {path.status === "chosen" ? (
          onAsk && <Button size="md" variant="soft" className="ms-1.5" onClick={onAsk}><MessageCircle aria-hidden />{copy.askAbout}</Button>
        ) : path.status !== "dismissed" && onChoose && (
          <Button size="md" variant="soft" className="ms-1.5" disabled={busy} onClick={onChoose}><Check aria-hidden />{copy.choose}</Button>
        )}
        {["suggested", "dismissed"].includes(path.status) && (
          <Button size="icon" variant="ghost" disabled={busy} aria-label={copy.save} title={copy.save} onClick={() => act("save")}><Bookmark aria-hidden /></Button>
        )}
        {!["dismissed", "chosen"].includes(path.status) && (path.study_field?.outdated ? (
          <Button size="md" variant="ghost" disabled={busy} onClick={() => act("dismiss")}><X aria-hidden />{copy.pathRemove}</Button>
        ) : (
          <Button size="icon" variant="ghost" disabled={busy} aria-label={copy.notForMe} title={copy.notForMe} onClick={() => act("dismiss")}><X aria-hidden /></Button>
        ))}
        {/* Phones: the Compare tick sits in the row's top corner so the controls stay on one line. */}
        {pick && <span className="max-sm:absolute max-sm:end-1.5 max-sm:top-1.5"><ComparePick path={path} {...pick} /></span>}
      </div>
      {error && <p role="alert" className="text-sm font-medium text-danger-ink sm:basis-full">{copy.error}</p>}
    </li>
  );
}

/** The student's own direction, in their words. PAI then checks it against
 * them like any other path. */
function AddOwnPath({ open, onOpenChange, onAdded }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}) {
  const [title, setTitle] = useState(""),
    [why, setWhy] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  useEffect(() => {
    if (open) { setTitle(""); setWhy(""); setError(false); }
  }, [open]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(false);
    try {
      await workspaceApi.addOwnPath(title.trim(), why.trim());
      onOpenChange(false);
      onAdded();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader className="space-y-2 px-7 pb-2 pt-7">
            <DialogTitle className="text-xl">{copy.addOwnTitle}</DialogTitle>
            <DialogDescription>{copy.addOwnIntro}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 px-7 py-3">
            <div className="space-y-2">
              <Label htmlFor="own-path-title">{copy.addOwnName}</Label>
              <Input id="own-path-title" required maxLength={120} value={title} autoFocus
                placeholder={copy.addOwnPlaceholder} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="own-path-why">{copy.addOwnWhy}</Label>
              <Textarea id="own-path-why" maxLength={600} rows={3} value={why} onChange={(e) => setWhy(e.target.value)} />
            </div>
            {error && <p role="alert" className="text-sm font-medium text-danger-ink">{copy.error}</p>}
          </DialogBody>
          <DialogFooter className="px-7 pb-7 pt-2">
            <Button type="button" size="tap" variant="ghost" onClick={() => onOpenChange(false)}>{copy.addOwnCancel}</Button>
            <Button type="submit" size="tap" disabled={busy || !title.trim()}><Plus aria-hidden />{copy.addOwnSave}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const LIST = cn(CARD, "divide-y divide-border/70 overflow-hidden");

/** How often the page looks again while PAI works out the paths. */
const FINDING_EVERY_MS = 5000;

export function Paths({ onChat, onChanged }: {
  onChat?: (topic?: string) => void;
  /** After a choose, so the shell's journey stage follows. */
  onChanged?: () => void;
}) {
  const resource = useResource(list);
  const analysis = useResource(analysisStatus);
  const [adding, setAdding] = useState(false),
    [polls, setPolls] = useState(0),
    [picked, setPicked] = useState<string[]>([]),
    [comparing, setComparing] = useState(false),
    [choosing, setChoosing] = useState<Possibility | null>(null);
  const live = resource.data?.filter((p) => p.status !== "dismissed") || [];
  const dismissed = resource.data?.filter((p) => p.status === "dismissed") || [];
  const tones = tonesByOrder((resource.data || []).map((p) => p.id));
  const { refresh } = resource;
  const refreshAnalysis = analysis.refresh;
  // PAI works the paths out on its own (education, Mirror, chat); the page
  // only shows a run in progress and picks up its paths when it ends.
  const finding = analysis.data ? !analysis.data.done : false;
  const needsEducation = analysis.data?.done && analysis.data.outcome === "needs_education";
  useEffect(() => {
    if (!finding) return;
    // Counted, not keyed on the response, so an unchanged answer still looks again.
    const timer = setTimeout(() => {
      void Promise.all([refresh(), refreshAnalysis()]).then(() => setPolls((n) => n + 1));
    }, FINDING_EVERY_MS);
    return () => clearTimeout(timer);
  }, [finding, polls, refresh, refreshAnalysis]);
  const added = () => { void refresh(); void refreshAnalysis(); };
  // A path that leaves the live list (not for me) leaves the Compare pick too.
  const liveIds = live.map((p) => p.id).join(",");
  // The badges follow each path's study field too: the analyzer may set or change it.
  const badgeKey = live.map((p) => `${p.id}:${p.study_field?.key || ""}`).join(",");
  useEffect(() => {
    setPicked((ids) => ids.filter((id) => liveIds.split(",").includes(id)));
  }, [liveIds]);
  // Each live path's eligibility badge, read again whenever the paths change.
  // A failed read only leaves the badges off.
  const [eligibility, setEligibility] = useState<Record<string, Eligibility>>({});
  useEffect(() => {
    if (!liveIds) { setEligibility({}); return; }
    let current = true;
    workspaceApi.comparePaths(liveIds.split(","))
      .then((result) => {
        if (current) setEligibility(Object.fromEntries(result.paths.map((p) => [p.id, p.verdict.status])));
      })
      .catch(() => { if (current) setEligibility({}); });
    return () => { current = false; };
  }, [badgeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const { max } = COMPARE_LIMITS;
  const pickFor = (path: Possibility) => ({
    picked: picked.includes(path.id),
    disabled: picked.length >= max && !picked.includes(path.id),
    onPick: (on: boolean) => setPicked((ids) =>
      on ? (ids.length < max && !ids.includes(path.id) ? [...ids, path.id] : ids) : ids.filter((id) => id !== path.id)),
  });
  const ask = (path: Possibility) => onChat?.(fill(copy.askTopic, { title: path.title }));
  const chosen = async () => {
    setChoosing(null);
    await refresh();
    onChanged?.();
  };
  const actions = (
    <Button size="tap" variant="outline" onClick={() => setAdding(true)}><Plus aria-hidden />{copy.addOwn}</Button>
  );
  return (
    <>
      <Heading title={copy.pathsTitle} description={copy.pathsIntro} icon={Compass} tone="teal"
        action={resource.data?.length ? actions : undefined} />
      <AddOwnPath open={adding} onOpenChange={setAdding} onAdded={added} />
      {finding && (
        <p role="status" className="mb-5 flex items-start gap-2.5 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info-ink">
          <Loader2 aria-hidden className="mt-0.5 size-4 shrink-0 animate-spin" />{copy.findingPaths}
        </p>
      )}
      {needsEducation && !finding && (
        <p role="status" className="mb-5 flex items-start gap-2.5 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info-ink">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />{copy.pathsNeedEducation}
        </p>
      )}
      {!resource.data || resource.error ? (
        <LoadState error={resource.error} busy={resource.busy} retry={resource.refresh} />
      ) : !resource.data.length ? (
        <EmptyState icon={Compass} tone="teal" title={copy.pathsEmptyTitle} description={copy.pathsEmptyBody}
          action={<div className="flex flex-wrap justify-center gap-2">
            {actions}
            {onChat && <Button size="tap" variant="ghost" onClick={() => onChat()}><MessageCircle aria-hidden />{copy.openChat}</Button>}
          </div>} />
      ) : (
        <>
          {live.length >= COMPARE_LIMITS.min && (
            <p className="mb-3 flex items-center gap-1.5 text-[13px] text-muted-foreground"><Columns2 aria-hidden className="size-3.5" />{copy.compare.hint}</p>
          )}
          <ul className={LIST}>
            {live.map((path) => (
              <PathRow path={path} tone={tones[path.id]} key={path.id} onChange={resource.refresh} eligibility={eligibility[path.id]}
                onChoose={() => setChoosing(path)} onAsk={onChat && (() => ask(path))}
                pick={live.length >= COMPARE_LIMITS.min ? pickFor(path) : undefined} />
            ))}
          </ul>
          {dismissed.length > 0 && (
            <details className="group mt-8">
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-1 font-semibold text-muted-foreground">
                <ArrowRight aria-hidden className="size-4 transition-transform group-open:rotate-90" />
                {fill(copy.dismissedTitle, { count: dismissed.length })}
              </summary>
              <ul className={cn(LIST, "mt-4 opacity-80")}>
                {dismissed.map((path) => (
                  <PathRow path={path} tone={tones[path.id]} key={path.id} onChange={resource.refresh} />
                ))}
              </ul>
            </details>
          )}
          <CompareBar count={picked.length} onClear={() => setPicked([])} onCompare={() => setComparing(true)} />
          <CompareDialog open={comparing} onOpenChange={setComparing} tones={tones}
            paths={picked.map((id) => live.find((p) => p.id === id)).filter((p): p is Possibility => !!p)} />
          <ChooseDialog path={choosing} onOpenChange={(open) => { if (!open) setChoosing(null); }} onChosen={chosen} />
        </>
      )}
    </>
  );
}
