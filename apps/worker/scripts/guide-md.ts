/**
 * Markdown copies of the guides: apps/web/<slug>.html → apps/web/<slug>.md,
 * served at aired.sh/<slug>.md. The agent menu's "Copy page" and "Open
 * Markdown" use them, and AI tools read them more cleanly than the HTML.
 *
 * Run after editing a guide (test/agent-menu.test.ts fails until you do):
 *
 *   node --experimental-strip-types apps/worker/scripts/guide-md.ts
 *
 * The copy holds the title, the lede and the article: steps, lists, tables,
 * code and the FAQ. The publish box, side picture and guide cards stay out.
 */
import { Window } from "happy-dom";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const GUIDES = [
  "html-to-link",
  "share-claude-artifacts",
  "share-chatgpt-html",
  "share-gemini-canvas",
  "publish-from-claude-code",
  "publish-from-cursor",
  "password-protect-html",
  "share-html-privately",
  "share-html-with-client",
  "share-slides",
  "share-vite-app",
  "tiiny-host-alternative",
] as const;

const ORIGIN = "https://aired.sh";

type El = { tagName: string; childNodes: ArrayLike<Node>; getAttribute(n: string): string | null; textContent: string | null };
type Node = { nodeType: number; textContent: string | null } & Partial<El>;

const squash = (s: string) => s.replace(/\s+/g, " ");

/** The guide being converted, so a #section link points back into it. */
let current = "";

function absolute(href: string): string {
  if (/^[a-z]+:/i.test(href)) return href;
  if (href.startsWith("#")) return `${ORIGIN}/${current}${href}`;
  return ORIGIN + (href.startsWith("/") ? href : `/${href}`);
}

/** Inline content as Markdown on one line. */
function inline(node: Node): string {
  if (node.nodeType === 3) return squash(node.textContent ?? "");
  if (node.nodeType !== 1) return "";
  const el = node as El;
  const tag = el.tagName.toLowerCase();
  if (tag === "svg" || tag === "i" && (el.textContent ?? "").trim() === "") return "";
  if (tag === "br") return "\n";
  const inner = Array.from(el.childNodes, inline).join("");
  const t = inner.trim();
  switch (tag) {
    case "strong":
    case "b":
      return t ? `**${t}**${inner.endsWith(" ") ? " " : ""}` : "";
    case "em":
      return t ? `*${t}*` : "";
    case "code":
      return `\`${(el.textContent ?? "").replace(/\s+/g, " ")}\``;
    case "a": {
      const href = el.getAttribute("href");
      return href ? `[${t}](${absolute(href)})` : inner;
    }
    default:
      return inner;
  }
}

const line = (el: Node) => inline(el).replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();

function table(el: El): string {
  const rows = Array.from((el as unknown as Element).querySelectorAll("tr"));
  const cells = rows.map((r) => Array.from(r.querySelectorAll("th,td"), (c) => line(c as unknown as Node).replace(/\|/g, "\\|").replace(/\n/g, " ")));
  if (cells.length === 0) return "";
  const head = cells[0]!;
  const out = [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`];
  for (const r of cells.slice(1)) out.push(`| ${r.join(" | ")} |`);
  return out.join("\n");
}

function list(el: El, ordered: boolean): string {
  const items = Array.from(el.childNodes).filter((n) => n.nodeType === 1 && (n as El).tagName.toLowerCase() === "li");
  return items.map((li, i) => `${ordered ? `${i + 1}.` : "-"} ${line(li).replace(/\n/g, " ")}`).join("\n");
}

/** Block content as Markdown blocks. */
function blocks(node: Node, out: string[]): void {
  if (node.nodeType === 3) {
    const t = squash(node.textContent ?? "").trim();
    if (t) out.push(t);
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as El;
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case "h2":
      out.push(`## ${line(el)}`);
      return;
    case "h3":
    case "h4":
      out.push(`### ${line(el)}`);
      return;
    case "p":
      if (line(el)) out.push(line(el));
      return;
    case "ol":
    case "ul":
      out.push(list(el, tag === "ol"));
      return;
    case "table":
      out.push(table(el));
      return;
    case "pre":
      out.push("```\n" + (el.textContent ?? "").replace(/\n+$/, "") + "\n```");
      return;
    case "details": {
      const summary = Array.from(el.childNodes).find((n) => n.nodeType === 1 && (n as El).tagName.toLowerCase() === "summary");
      if (summary) out.push(`### ${line(summary)}`);
      for (const c of Array.from(el.childNodes)) if (c !== summary) blocks(c, out);
      return;
    }
    case "figure": // explainers are pictures; the article's text says the same
    case "svg":
    case "script":
    case "style":
    case "button":
      return;
    default:
      for (const c of Array.from(el.childNodes)) blocks(c, out);
  }
}

export function guideMarkdown(html: string, slug: string): string {
  current = slug;
  const window = new Window();
  const doc = window.document;
  doc.write(html);
  const h1 = doc.querySelector("h1");
  const lede = doc.querySelector(".g2-lead") ?? doc.querySelector(".hero .lede");
  const article = doc.querySelector("article.prose");
  if (!h1 || !article) throw new Error(`${slug}: no h1 or article`);
  const out: string[] = [`# ${line(h1 as unknown as Node)}`];
  if (lede) out.push(line(lede as unknown as Node));
  out.push(`Source: ${ORIGIN}/${slug}`);
  // v2 guides put the steps above the article as pictured cards (.g2-steps).
  const list = doc.querySelector(".g2-steps");
  const steps = Array.from(doc.querySelectorAll(".g2-steps > li"));
  if (list && steps.length) {
    // Facts (the comparison guide) aren't a sequence, so they're bullets.
    const facts = list.classList.contains("g2-facts");
    out.push(`## ${list.getAttribute("data-md-title") ?? "How to do it"}`);
    out.push(steps.map((li, i) => {
      const title = squash(li.querySelector("b")?.textContent ?? "").trim();
      const text = line(li.querySelector("p") as unknown as Node);
      return `${facts ? "-" : `${i + 1}.`} **${title}** ${text}`;
    }).join("\n"));
  }
  blocks(article as unknown as Node, out);
  window.happyDOM.close();
  return out.filter((b) => b !== "").join("\n\n") + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const slug of GUIDES) {
    const web = new URL(`../../web/`, import.meta.url);
    const md = guideMarkdown(readFileSync(new URL(`${slug}.html`, web), "utf8"), slug);
    writeFileSync(new URL(`${slug}.md`, web), md);
    console.log(`wrote apps/web/${slug}.md (${md.length} bytes)`);
  }
}
