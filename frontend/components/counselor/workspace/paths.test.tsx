// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
  within,
} from "@testing-library/react";
import { Paths } from "./paths";
import { workspaceApi } from "@/lib/api";
import { pathComparison, possibilities } from "@/tests/fixtures/counselor";
import type { Possibility } from "@/lib/possibilities";
import copy from "./copy.json";
vi.mock("@/lib/api", () => ({
  workspaceApi: {
    getPossibilities: vi.fn(),
    changePossibility: vi.fn(),
    comparePaths: vi.fn(),
    addOwnPath: vi.fn(),
    getPathAnalysis: vi.fn(),
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
beforeEach(() => {
  vi.mocked(workspaceApi.getPathAnalysis).mockResolvedValue({ job_id: null, done: true, outcome: null });
  vi.mocked(workspaceApi.comparePaths).mockResolvedValue({ education_line: null, paths: [] });
});
const third: Possibility = { ...possibilities[1], id: "path-three", title: "Medicine", status: "suggested" };
const four: Possibility = { ...possibilities[1], id: "path-four", title: "Law", status: "suggested" };

it("has no Explore and no page per path: only Choose, save, not for me and the Compare tick", async () => {
  vi.mocked(workspaceApi.getPossibilities).mockResolvedValue(possibilities);
  render(<Paths />);
  const row = (await screen.findByText("Practical design")).closest("li")!;
  expect(screen.queryByText("Explore")).toBeNull();
  expect(within(row).getByRole("button", { name: "Choose" })).toBeTruthy();
  expect(within(row).getByRole("checkbox", { name: "Compare Practical design" })).toBeTruthy();
  expect(row.querySelector('[role="img"]')?.getAttribute("aria-label"))
    .toBe("1 you have, 1 partly, 0 in the way, 0 need work, 1 not known yet");
});

it("chooses a path only after one confirm, then follows the journey", async () => {
  vi.mocked(workspaceApi.getPossibilities).mockResolvedValue(possibilities);
  vi.mocked(workspaceApi.changePossibility).mockResolvedValue({ ...possibilities[1], status: "chosen" });
  const changed = vi.fn();
  render(<Paths onChanged={changed} />);
  const row = (await screen.findByText("Applied computing")).closest("li")!;
  fireEvent.click(within(row).getByRole("button", { name: "Choose" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("Choose Applied computing?")).toBeTruthy();
  expect(workspaceApi.changePossibility).not.toHaveBeenCalled();
  vi.mocked(workspaceApi.getPossibilities).mockResolvedValue([possibilities[0], { ...possibilities[1], status: "chosen" }]);
  fireEvent.click(within(dialog).getByRole("button", { name: "Yes, choose it" }));
  await waitFor(() => expect(workspaceApi.changePossibility).toHaveBeenCalledExactlyOnceWith("path-two", "choose"));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("Not now closes the confirm without choosing", async () => {
  vi.mocked(workspaceApi.getPossibilities).mockResolvedValue(possibilities);
  render(<Paths />);
  fireEvent.click((await screen.findAllByRole("button", { name: "Choose" }))[0]);
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Not now" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(workspaceApi.changePossibility).not.toHaveBeenCalled();
});

it("a chosen path offers Ask PAI, which opens the chat with a draft about it", async () => {
  vi.mocked(workspaceApi.getPossibilities).mockResolvedValue([{ ...possibilities[0], status: "chosen" }, possibilities[1]]);
  const chat = vi.fn();
  render(<Paths onChat={chat} />);
  const row = (await screen.findByText("Practical design")).closest("li")!;
  expect(within(row).queryByRole("button", { name: "Choose" })).toBeNull();
  fireEvent.click(within(row).getByRole("button", { name: "Ask PAI" }));
  expect(chat).toHaveBeenCalledWith("I chose Practical design. Tell me more about this path.");
  expect(workspaceApi.changePossibility).not.toHaveBeenCalled();
});

it("compares two or three paths with the same rows for each", async () => {
  vi.mocked(workspaceApi.getPossibilities).mockResolvedValue([...possibilities, third, four]);
  vi.mocked(workspaceApi.comparePaths).mockResolvedValue(pathComparison);
  render(<Paths />);
  expect(await screen.findByText(copy.compare.hint)).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: "Compare Practical design" }));
  const bar = screen.getByRole("button", { name: "Pick 1 more to compare" }) as HTMLButtonElement;
  expect(bar.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "Compare Applied computing" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Compare Medicine" }));
  expect((screen.getByRole("checkbox", { name: "Compare Law" }) as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Compare (3)" }));
  const table = within(await screen.findByRole("dialog")).getByRole("table");
  expect(workspaceApi.comparePaths).toHaveBeenLastCalledWith(["path-one", "path-two", "path-three"]);
  expect(within(table).getAllByRole("rowheader").map((th) => th.textContent)).toEqual(Object.values(copy.compare.rows));
  await within(table).findByText("ECAT / NET");
  expect(within(table).getAllByText("60% · you 78%")).toHaveLength(3);
  expect(within(table).getByText("Bridge or extra courses")).toBeTruthy();
  expect(within(table).getByText("Not open from Pre-Engineering")).toBeTruthy();
  expect(within(table).getByText("Needs a step")).toBeTruthy();
  // Every rule fact shows its confidence, its sources and when the rules were checked.
  expect(within(table).getAllByText("Official")).toHaveLength(2);
  expect(within(table).getByText("Uncertain")).toBeTruthy();
  expect(within(table).getByText("Check with the university")).toBeTruthy();
  expect(within(table).getAllByRole("link", { name: "pec.org.pk" })[0].getAttribute("href")).toBe("https://www.pec.org.pk/regulations.pdf");
  expect(screen.getByText("Admission rules last checked October 2026.")).toBeTruthy();
  expect(workspaceApi.changePossibility).not.toHaveBeenCalled();
});

it("offers no Compare tick while there is only one live path", async () => {
  vi.mocked(workspaceApi.getPossibilities).mockResolvedValue([possibilities[0], { ...possibilities[1], status: "dismissed" }]);
  render(<Paths />);
  await screen.findByText("Practical design");
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByText(copy.compare.hint)).toBeNull();
});

it("shows each path's eligibility badge from the Vault, never 'cannot check' on a row", async () => {
  vi.mocked(workspaceApi.getPossibilities).mockResolvedValue([...possibilities, third]);
  vi.mocked(workspaceApi.comparePaths).mockResolvedValue({ ...pathComparison, paths: [
    pathComparison.paths[0], { id: "path-two", verdict: { ...pathComparison.paths[1].verdict, status: "unknown" } }, pathComparison.paths[2]] });
  render(<Paths />);
  const row = (id: string) => screen.getByText(id).closest("li")!;
  await waitFor(() => expect(within(row("Practical design")).getByText("Open")).toBeTruthy());
  expect(workspaceApi.comparePaths).toHaveBeenCalledWith(["path-one", "path-two", "path-three"]);
  expect(within(row("Medicine")).getByText("Not open")).toBeTruthy();
  expect(within(row("Applied computing")).queryByText("Cannot check yet")).toBeNull();
  // Not open never blocks the choice.
  expect(within(row("Medicine")).getByRole("button", { name: "Choose" })).toBeTruthy();
});

it("Clear empties the Compare pick", async () => {
  vi.mocked(workspaceApi.getPossibilities).mockResolvedValue(possibilities);
  render(<Paths />);
  fireEvent.click(await screen.findByRole("checkbox", { name: "Compare Practical design" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(screen.queryByRole("button", { name: /to compare/ })).toBeNull();
  expect((screen.getByRole("checkbox", { name: "Compare Practical design" }) as HTMLInputElement).checked).toBe(false);
});

it("says so calmly when the comparison cannot load", async () => {
  vi.mocked(workspaceApi.getPossibilities).mockResolvedValue(possibilities);
  vi.mocked(workspaceApi.comparePaths).mockRejectedValue(new Error("down"));
  render(<Paths />);
  fireEvent.click(await screen.findByRole("checkbox", { name: "Compare Practical design" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Compare Applied computing" }));
  fireEvent.click(screen.getByRole("button", { name: "Compare (2)" }));
  expect(await within(await screen.findByRole("dialog")).findByRole("alert")).toBeTruthy();
});

it("adds the student's own path and follows PAI's run, with no find button", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(workspaceApi.getPossibilities).mockResolvedValue(possibilities);
  vi.mocked(workspaceApi.addOwnPath).mockResolvedValue({ ...possibilities[1], id: "mine", title: "Nursing" });
  render(<Paths />);
  fireEvent.click(await screen.findByRole("button", { name: "Add your own path" }));
  expect(screen.queryByRole("button", { name: "Find my paths" })).toBeNull();
  const add = screen.getByRole("button", { name: "Add path" }) as HTMLButtonElement;
  expect(add.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Path"), { target: { value: "  Nursing " } });
  fireEvent.change(screen.getByLabelText("Why it interests you (optional)"), { target: { value: "I like caring" } });
  vi.mocked(workspaceApi.getPathAnalysis).mockResolvedValue({ job_id: "job", done: false, outcome: null });
  fireEvent.click(add);
  await waitFor(() => expect(workspaceApi.addOwnPath).toHaveBeenCalledWith("Nursing", "I like caring"));
  expect(await screen.findByText(/PAI is looking at everything/)).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(vi.mocked(workspaceApi.getPossibilities).mock.calls.length).toBeGreaterThan(2);
  vi.mocked(workspaceApi.getPathAnalysis).mockResolvedValue({ job_id: "job", done: true, outcome: "saved" });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  await waitFor(() => expect(screen.queryByText(/PAI is looking at everything/)).toBeNull());
  vi.useRealTimers();
});

it("shows a study field's group notes on the path row, never raw codes", async () => {
  const field = { ...possibilities[0], title: "Electrical Engineering",
    study_field: { key: "electrical_engineering", needs_check: true, needs_group: [{ code: "pre_engineering", label: "Pre-Engineering" }] } };
  const older = { ...possibilities[1], id: "older", title: "Mechanics and metal trades", status: "saved" as const, study_field: { outdated: true } };
  vi.mocked(workspaceApi.getPossibilities).mockResolvedValue([field, older]);
  render(<Paths />);
  const row = (await screen.findByText("Electrical Engineering")).closest("li")!;
  expect(row.textContent).toContain("Needs checking for your group");
  expect(row.textContent).toContain("Needs Pre-Engineering in intermediate");
  expect(row.textContent).not.toContain("pre_engineering");
  expect(screen.getByText("Mechanics and metal trades").closest("li")!.textContent).toContain("Older suggestion");
});

it("marks a kept field outside the current group and lets the student remove an older suggestion", async () => {
  const kept = { ...possibilities[0], title: "Pharm-D", status: "saved" as const,
    study_field: { key: "pharm_d", needs_check: false, needs_group: [], out_of_group: true } };
  const older = { ...possibilities[1], id: "older", title: "Computer use", status: "saved" as const, study_field: { outdated: true } };
  vi.mocked(workspaceApi.getPossibilities).mockResolvedValue([kept, older]);
  vi.mocked(workspaceApi.changePossibility).mockResolvedValue({ ...older, status: "dismissed" });
  render(<Paths />);
  expect((await screen.findByText("Pharm-D")).closest("li")!.textContent).toContain("Not open to your current group");
  const row = screen.getByText("Computer use").closest("li")!;
  expect(row.textContent).toContain("Older suggestion, from before fields of study");
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(workspaceApi.changePossibility).toHaveBeenCalledWith("older", "dismiss"));
});

it("asks for the education when the last run needed it, and shows PAI's own run until it ends", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    vi.mocked(workspaceApi.getPossibilities).mockResolvedValue(possibilities);
    vi.mocked(workspaceApi.getPathAnalysis).mockResolvedValue({ job_id: "job-1", done: true, outcome: "needs_education" });
    render(<Paths />);
    expect(await screen.findByText("PAI needs your group or field to suggest fields of study.")).toBeTruthy();
    cleanup();
    // A run PAI started on its own (e.g. after an education write) shows while it works.
    vi.mocked(workspaceApi.getPathAnalysis).mockResolvedValue({ job_id: "job-2", done: false, outcome: null });
    render(<Paths />);
    expect(await screen.findByText(/PAI is looking at everything/)).toBeTruthy();
    vi.mocked(workspaceApi.getPathAnalysis).mockResolvedValue({ job_id: "job-2", done: true, outcome: "needs_education" });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await waitFor(() => expect(screen.getByText("PAI needs your group or field to suggest fields of study.")).toBeTruthy());
    expect(screen.queryByText(/PAI is looking at everything/)).toBeNull();
  } finally { vi.useRealTimers(); }
});

it("keeps the Compare words in step with the backend eligibility policy", () => {
  const policy = JSON.parse(readFileSync(resolve(__dirname, "../../../../backend/app/pai_c/policy/eligibility.json"), "utf8"));
  expect(copy.compare.templates).toEqual(policy.copy);
  expect(copy.compare.groupJoiner).toBe(policy.group_joiner);
  expect(copy.compare.limits).toEqual(policy.compare);
});
