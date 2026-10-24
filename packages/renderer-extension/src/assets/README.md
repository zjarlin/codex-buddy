# Brand assets

`codexhost-mark.svg` is the editable source for the CodexBuddy product mark:
a monochrome **B** formed from two rounded compartments. The settings header
and navigation-rail settings trigger use it as a CSS mask with `currentColor`,
so it follows the actual host theme in both light and dark mode.

Regenerate the raster assets from the repository root with:

```sh
npm run generate:brand --workspace=@codexhost/renderer-extension
```

The generator uses the existing Playwright Chromium installation (install with
`npx playwright install chromium` if needed). It produces:

- `codexhost-icon.png`: a 1024px app icon with a white rounded tile and transparent corners.
- `codexhost-logo.png` / `codexhost-logo-transparent.png`: the 1024px black mark on white / transparent backgrounds.
- `crates/launcher/assets/codexhost.png`: the same app icon used by macOS packaging to generate `CodexBuddy.icns`.
- `crates/launcher/assets/codexhost.ico`: independently rendered 16, 24, 32, 48, 64, 128, and 256px frames embedded in the Windows launcher.

Update the SVG and regenerate these assets together. Product branding does not
use the official Codex mark. The existing `codex-logo*.png` files are legacy
Codex artwork, separate from the Buddy product mark and the Harness icons below.
Only Codex and codexhost artwork is bundled into the Renderer. External Harness
artwork belongs to `packages/adapters/<id>/assets/`, is declared in each plugin's
manifest, and reaches the Renderer as a validated data URL in the Host directory.
The Renderer uses an image element, never inline plugin SVG.

`codex-logo.png` is the Codex X mark source; `codex-logo-transparent.png` removes
its white background, and `codex-logo-bright.png` uses the official bright blue.
`codex-agent.png` is the Codex App GA mark distributed with OpenAI's official
`openai.chatgpt` VS Code extension.

`codexhost-app-icon.svg` is the vector master of the codexhost brand icon,
used in settings. The launcher PNG and Windows ICO are derived from it.

## External artwork provenance

- Pi: official `https://pi.dev/logo-auto.svg`. The original Renderer paths, viewBox
  and `currentColor` SVG rendering are preserved in the plugin Manifest; the original
  standalone image resource is unchanged. No light plate is added.
- Claude Code: Anthropic's official `anthropic.claude-code` VS Code extension.
- DeepSeek Harness: official web favicon / `FishLogo.tsx`, blue `#4D6BFE`.
- OMP: Oh My Pi `packages/collab-web/public/favicon.svg`.
- OpenCode: official square mark with dark outer plate.
- Grok: cropped first-party `grok.com` mark with transparent rounded corners.
- Kiro: official `https://kiro.dev/icon.svg`.
- CodeBuddy and WorkBuddy: captured first-party `10001.svg` assets; original
  backgrounds, marks, viewBoxes and clipping are preserved.
- Cursor: official `https://cursor.com/favicon.svg` Cube with its dark plate.
- Hermes: the original cropped/resized website favicon, unchanged; its existing light plate,
  padding and rounded corners are declared by the plugin rather than baked into the artwork.
- ZCode: upstream codex-host integration snapshot `b66013bb`.

Product names and marks remain trademarks of their respective owners.
