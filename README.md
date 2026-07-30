<p align="center">
  <img src=".github/hero.jpg" alt="StackiBoost, a visual builder for Astro with built-in AI" width="100%" />
</p>

# StackiBoost

Visual Builder for Astro, boosted with AI.

A fork of [Stacki](https://github.com/flowtricks/stacki) by Timothy Ricks that adds a built-in AI assistant. Edit your Astro site visually, and when you want something bigger (a new section, a whole page, a restyle) just ask.

MIT licensed, like the original.

## AI Mode

- **AI on the left rail** (or `Cmd+J`) opens a floating chat over the canvas. `Esc` closes it. Compact until a conversation starts, then resizable up to the full page.
- **It knows what you're looking at.** The open page, the selected element (breadcrumb, props, text), and the active breakpoint are sent along with every prompt, so "make this heading bigger" just works, per breakpoint too.
- **Your own subscriptions, no API keys.** Prompts run through whichever coding CLI you have installed and logged into: [Claude Code](https://claude.com/claude-code) (claude.ai Pro/Max), [Codex CLI](https://developers.openai.com/codex/cli) (ChatGPT), or [Gemini CLI](https://github.com/google-gemini/gemini-cli) (Google).
- **Edits show up live.** The AI edits the project files directly; Astro's hot reload and the file watcher update the canvas while it works.
- **Connected AI models** in Settings: add only the models you want, switch between them from the chat when more than one is connected.

To use it, install at least one of the CLIs above, log in once from a terminal, and you're set.

## Boost extras on top of Stacki

- **Framer-style canvas selection.** In canvas view (all breakpoints side by side) you can hover and click elements right in the frames. Clicking a frame also targets its breakpoint, so the Style panel and the AI both edit that breakpoint.
- **Double-click opens code.** Double-clicking Frontmatter or a style/script node in the Navigator opens the floating code editor.

## Features

- **Pages**: browse every page in `src/pages`, create new pages (including nested routes like `blog/post-1`), and delete pages.
- **Layouts**: choose which layout from `src/layouts` wraps each page, and edit the layout's props (e.g. `title`).
- **Components**: every component in `src/components` appears in the palette. Drag one into the page structure (or double-click to append), drag to reorder, click the x to remove.
- **Props**: the props panel reads each component's `interface Props` / `Astro.props` destructure and generates typed fields (text, number, checkbox). Defaults are shown as placeholders.
- **Live preview**: the app runs `astro dev` for the opened project and embeds it. Edits are auto-saved (300 ms debounce), so Astro's hot reload updates the preview as you type.
- **Git & GitHub**: the branch chip in the title bar shows the current branch and dirty state. From its dropdown you can switch branches, create branches, commit, push, or publish a brand-new repo to GitHub (via the `gh` CLI).
- **Code fallback**: pages with markup too complex for the visual model open in a code editor instead, still with live preview.
- **New project**: "New Project…" scaffolds a minimal Astro starter (layout + 5 components + home page) and runs `npm install` for you.

## Running in development

```bash
npm install
npm run dev
```

`npm run dev` starts Vite (renderer hot reload) and launches Electron against it.

To run against a production build of the UI:

```bash
npm start
```

## Packaging installers

Use the unsigned build. It needs no Apple Developer account and no certificates:

```bash
npm run dist:mac:unsigned   # .dmg + .zip, no signing (build on macOS)
npm run dist:win            # NSIS installer (build on Windows)
```

Output lands in `release/`. macOS will warn the first time you open an
unsigned build; right-click the app and choose Open to get past Gatekeeper.

For a quick local install on macOS without a dmg:

```bash
npm run build
npx electron-builder --mac dir -c.mac.forceCodeSigning=false -c.mac.notarize=false -c.mac.identity=null
cp -R release/mac-arm64/StackiBoost.app /Applications/
```

Note: unlike upstream Stacki, this fork does not auto-update, so your build
never gets replaced by an upstream release.

## Requirements

- Node.js 18+ and npm (the app shells out to `npm install` / `astro dev` for opened projects)
- `git` for version control features
- [GitHub CLI](https://cli.github.com) (`gh`), authenticated via `gh auth login`, for "Publish to GitHub"
- For AI Mode (optional, everything else works without it): [Claude Code](https://claude.com/claude-code), [Codex CLI](https://developers.openai.com/codex/cli), or [Gemini CLI](https://github.com/google-gemini/gemini-cli), logged in

## How editing works

Pages are parsed into a simple model: optional layout wrapper plus a flat list of
self-closing component instances with props. The editor writes that model back
as clean `.astro` source. Pages containing arbitrary HTML, expressions, or
nested children fall back to the built-in code editor; nothing is ever
rewritten destructively.

## Credits

Stacki is created by [Timothy Ricks](https://www.timothyricks.com). This fork
adds the AI layer on top. If you just want the visual editor, use the
[original](https://github.com/flowtricks/stacki).
