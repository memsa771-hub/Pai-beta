/** Section names land on the section's first view; the removed Roadmap page
 * (roadmap, roadmaps, and its old Compare and Plan tabs) lands on Paths, where
 * paths are compared and chosen. Shared by the shell's URL reader and chat
 * place links. */
export const VIEW_ALIASES: Record<string, string> = {
  roadmap: "paths", roadmaps: "paths", compare: "paths", plan: "paths", vault: "files", pai: "threads", home: "overview",
};

/** Opens a workspace view from anywhere, chat included. The shell reads the
 * view from the URL on popstate, so links need no access to its state. */
export function openWorkspaceView(view: string, params: Record<string, string> = {}) {
  const base = "/" + window.location.pathname.split("/").filter(Boolean)[0];
  window.history.pushState({}, "", `${base}?${new URLSearchParams({ view, ...params })}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
