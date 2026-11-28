# Share a Vite or React app as one link

**Build your app as one HTML file and publish it.** Your client opens the working app from a link, with nothing to install and no hosting to set up.

Source: https://aired.sh/share-vite-app

## How to do it

1. **Add one plugin** It puts every script, style and image in one file.
2. **Build one file** A second build config; your normal build stays as it is.
3. **Send the link** The real app runs in their browser.

## How to share it

1. **Add the single-file plugin.** In your app's folder, run `npm i -D vite-plugin-singlefile`. It puts every script, stylesheet, font and imported image inside `index.html`.
2. **Add a second build config.** Save the file below as `vite.singlefile.config.ts` next to `vite.config.ts`. Your normal build stays as it is.
3. **Build it.** Run `npx vite build -c vite.singlefile.config.ts`. You get one file, `dist-single/index.html`.
4. **Publish it.** Run `npx aired dist-single/index.html --permanent`, or drop the file into the box above.
5. **Open the link yourself first, then send it.** If it's blank or says "Not Found", see [the three usual causes](https://aired.sh/share-vite-app#gotchas).

```
// vite.singlefile.config.ts
import { mergeConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import base from "./vite.config";

// One self-contained index.html: every chunk, font and imported image inlined.
export default mergeConfig(base, {
  plugins: [viteSingleFile()],
  build: { outDir: "dist-single", assetsInlineLimit: 100_000_000 },
});
```

If your `vite.config.ts` exports a function rather than an object, add `viteSingleFile()` to its `plugins` and pass `--outDir dist-single` when you build.

## Or ask your AI agent

[Claude Code](https://aired.sh/publish-from-claude-code), [Cursor](https://aired.sh/publish-from-cursor) and Codex can do all of it. Paste this into the conversation where you built the app:

```
Build this app as one self-contained HTML file so I can send it as a link.
Follow https://aired.sh/share-vite-app: add vite-plugin-singlefile with a
separate vite.singlefile.config.ts, make the app work at any URL path (hash
routing if it has a router), and import large files from public/ so they end
up inside the file. Build it, check dist-single/index.html works, then run
npx aired dist-single/index.html --permanent and give me the link.
```

## Toolcraft apps

[Toolcraft](https://toolcraft.sh) apps need two more changes: it loads parts of the app only when they're needed, which trips a bug in Vite 8's bundler (the step that packs your code into files) when everything goes into one file, and its router expects to live at `/`. This config handles both without editing the app's own code. It's what built the [live example below](https://aired.sh/share-vite-app#example).

```
// vite.singlefile.config.ts for a Toolcraft app
import { mergeConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import base from "./vite.config";

// Load the app up front: inlining import("./app-bootstrap") trips a
// bundler bug ("createSelectorCreator is not defined").
function staticBootstrap(): Plugin {
  return { name: "static-bootstrap", enforce: "pre", transform(code, id) {
    if (!id.endsWith("/src/main.tsx")) return null;
    return `import * as __boot from "./app-bootstrap";\n` +
      code.replace(`() => import("./app-bootstrap")`, `() => Promise.resolve(__boot)`);
  } };
}

// The link lives at aired.sh/p/<id>, not at /: use hash routing.
function hashRouter(): Plugin {
  return { name: "hash-router", enforce: "pre", transform(code, id) {
    if (!id.endsWith("/src/router.tsx")) return null;
    return code
      .replace(`import { createRouter } from "@tanstack/react-router";`,
        `import { createHashHistory, createRouter } from "@tanstack/react-router";`)
      .replace(`basepath: routerBasePath,`, `history: createHashHistory(),`);
  } };
}

export default mergeConfig(base, {
  plugins: [staticBootstrap(), hashRouter(), viteSingleFile()],
  build: { outDir: "dist-single", assetsInlineLimit: 100_000_000 },
});
```

Toolcraft apps are built for desktop. On a phone or a window under 1024 px wide, your client sees a "designed for desktop" message.

## If the page is blank

- **"Not Found" or an empty screen with a router.** React Router, TanStack Router and others read the URL path. Your app is built for `/`, but the link is `/p/<id>`. Switch to hash routing, where the app's own address goes after a `#` (like `/p/abc#/settings`) so it never clashes with the link (`createHashRouter` in React Router, `createHashHistory` in TanStack Router).
- **Missing images or a default file.** Files in `public/` that the app loads by URL aren't put into the single file. Import them in code instead (`import cover from "./cover.jpg"`) and shrink large ones first. A 7 MB PNG becomes 9.6 MB once it's inlined.
- **An error in the console like "X is not defined".** Usually a lazy `import()` (code that loads part of the app later) that broke when everything was put in one file. Load that module normally, as the Toolcraft config above does.

Test it the way your client will see it: publish with a short expiry, open the link, and check the browser console.

## How big it can be

One page can be up to **2 MB on the free plan** and **10 MB on [Pro](https://aired.sh/pricing)**. A small React app usually fits in the free limit. Three.js, a large UI library or inlined images add up fast: the Toolcraft example below is 3.6 MB, most of it JavaScript and one 1 MB image. To see your size, check `dist-single/index.html` after you build.

## A live example

[Dither Lab](https://aired.sh/p/bn4kPOeF8h) is Toolcraft's open-source dither example (MIT, by Pixel Point), built with the Toolcraft config above and published with one command. Open it on a laptop, change the style, then export a PNG. Everything runs in your browser.

## Questions

### Why not just publish the dist folder?

aired serves one page per link. Publishing a folder puts the files the HTML links to directly into the page, but Vite loads most of its code later, from separate files, and those would be missing. A single-file build has everything inside it.

### How big can the app be?

Up to 2 MB on the free plan and 10 MB on Pro. A React app with a few libraries usually fits in 2 MB. Apps with Three.js, a big component library or inlined images often don't: the Toolcraft example on this page is 3.6 MB.

### Does my client need an account or anything installed?

No. They open the link in their browser. The app runs on their computer, and files they load into it stay there.

### Will their changes be saved?

Only until they reload. Shared pages run in a sandbox, so the browser storage an app would normally save to resets on reload. Exports and downloads work, so they can save what they made.

### Can I send an update without a new link?

Yes. Build again and run `npx aired update <id> dist-single/index.html`. The CLI saved the update token when you published, and the link stays the same.

### Can the app call an API?

It can call public APIs that allow requests from any origin. Because the page is sandboxed, requests come from a `null` origin, and APIs that check the origin or need cookies will refuse them. aired is for apps that run in the browser, not for apps with a backend.
