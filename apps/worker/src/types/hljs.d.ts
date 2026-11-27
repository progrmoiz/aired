/**
 * Just the highlight.js API lib/doc-render.ts uses. tsconfig.json points
 * "highlight.js/lib/*" here because the package's own types pull in the DOM
 * lib, which clashes with the Workers types.
 */
type Language = (hljs: unknown) => unknown;
interface Highlighter {
  highlight(code: string, options: { language: string; ignoreIllegals?: boolean }): { value: string };
  getLanguage(name: string): unknown;
  registerLanguage(name: string, language: Language): void;
  registerAliases(alias: string | string[], options: { languageName: string }): void;
}
declare const mod: Highlighter & Language;
export default mod;
