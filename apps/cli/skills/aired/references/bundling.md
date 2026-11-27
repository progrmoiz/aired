# Folders, images and app builds

aired serves one HTML file per page. Everything the page needs has to be inside it, or at a full `https://` URL.

## Publishing a folder

```bash
npx aired ./my-project/
```

- The folder needs an `index.html` at its root. No other entry point is used.
- The CLI puts the CSS, JS and images it links to inside the page. Images become base64, which adds about a third to their size.
- The result still has to fit the page limit: 2 MB on Free, 10 MB on Pro. The CLI warns when the bundle is over 2 MB.
- Over MCP, the local server's `publish_html` takes the folder as `file_path`. The remote server only takes `html` or `markdown`, so inline everything first.

## Markdown images

`aired notes.md` puts local images (`![](./chart.png)`, up to 1 MB each) into the page. Over MCP, use full `https://` image URLs or `data:` URLs instead.

## Vite, React and other code-split builds

These builds load code later with `import()`, and those chunks aren't inlined, so `npx aired ./dist` gives a blank page. Instead:

1. Build one file with `vite-plugin-singlefile`, with `build.assetsInlineLimit` set high, into `dist-single/`.
2. Switch any router to hash routing: the page lives at `/p/<id>`, not `/`.
3. Import large `public/` files from code so they get inlined.
4. Publish `dist-single/index.html`, then run `aired check <id>`.

Toolcraft apps also need their lazy `import("./app-bootstrap")` made static. Full recipe: https://aired.sh/share-vite-app

## Scripts, fonts and charts from a CDN

They load: the page's content policy allows any `https://` source. Pin a version in the URL so the page doesn't change under you, and run `aired check` to catch a blocked or missing file.
