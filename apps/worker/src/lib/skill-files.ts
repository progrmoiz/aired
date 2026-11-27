/**
 * The aired skills, bundled as text, for both MCP servers: the hosted one
 * (routes/mcp.ts, through wrangler.toml's [[rules]] for .md) and the stdio
 * one in the npm package (apps/mcp, through esbuild's .md loader). The
 * files live in apps/cli, where npm packs them too, so each skill has one
 * source. `path` is the file's path inside the npm package; mcp-extras.ts
 * turns it into a skill:// URI.
 *
 * Adding a skill file: import it here and list it. A test checks that every
 * .md under apps/cli/skills and apps/cli/references is in this list.
 */

import type { SkillFile } from "./mcp-extras.ts";
import core from "../../../cli/SKILL.md";
import refCli from "../../../cli/references/cli.md";
import refMcp from "../../../cli/references/mcp.md";
import refBundling from "../../../cli/references/bundling.md";
import refTroubleshooting from "../../../cli/references/troubleshooting.md";
import slides from "../../../cli/skills/aired-slides/SKILL.md";
import dashboard from "../../../cli/skills/aired-dashboard/SKILL.md";
import report from "../../../cli/skills/aired-report/SKILL.md";
import forms from "../../../cli/skills/aired-forms/SKILL.md";

export const SKILL_FILES: readonly SkillFile[] = [
  { path: "SKILL.md", text: core },
  { path: "references/cli.md", text: refCli },
  { path: "references/mcp.md", text: refMcp },
  { path: "references/bundling.md", text: refBundling },
  { path: "references/troubleshooting.md", text: refTroubleshooting },
  { path: "skills/aired-slides/SKILL.md", text: slides },
  { path: "skills/aired-dashboard/SKILL.md", text: dashboard },
  { path: "skills/aired-report/SKILL.md", text: report },
  { path: "skills/aired-forms/SKILL.md", text: forms },
];
