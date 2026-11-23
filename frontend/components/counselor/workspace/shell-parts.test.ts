import { it, expect } from "vitest";
import { SECTIONS, sectionOf } from "./shell-parts";

it("keeps the Mirror in the Vault with About you and Documents", () => {
  expect(sectionOf("mirror").key).toBe("vault");
  expect(SECTIONS.find((s) => s.key === "vault")!.views).toEqual(["files", "profile", "mirror"]);
  expect(SECTIONS.find((s) => s.key === "overview")!.views).toEqual(["overview"]);
});
