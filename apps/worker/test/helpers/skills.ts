import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** apps/cli, where the skills live and npm packs them. */
export const CLI_DIR = fileURLToPath(new URL("../../../cli/", import.meta.url));

function mdFiles(dir: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out = out.concat(mdFiles(p));
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

/** The core skill's main file, inside the npm package. */
export const CORE_SKILL = "skills/aired/SKILL.md";

/**
 * Every file of the aired skills, as the servers bundle them
 * (src/lib/skill-files.ts): the core SKILL.md first, then the rest of
 * apps/cli/skills. `path` is the path inside the npm package.
 */
export function skillFiles(): { path: string; text: string }[] {
  const rest = mdFiles(join(CLI_DIR, "skills")).map((p) => relative(CLI_DIR, p)).filter((p) => p !== CORE_SKILL).sort();
  const paths = [CORE_SKILL, ...rest];
  return paths.map((path) => ({ path, text: readFileSync(join(CLI_DIR, path), "utf8") }));
}

/** All the skill files' text, for checks that something is said somewhere in the skills. */
export function skillsText(): string {
  return skillFiles().map((f) => f.text).join("\n\n");
}
