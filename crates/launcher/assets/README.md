# Application icons

`codexhost.png` is a 1024px render of the monochrome CodexBuddy B mark in
`packages/renderer-extension/src/assets/codexhost-mark.svg`, on a white rounded tile.

macOS packaging creates its ICNS sizes directly from this PNG. Windows launchers
and the Inno Setup installer use `codexhost.ico`, with 16, 24, 32, 48, 64, 128,
and 256 pixel PNG frames. The uninstall listing uses the launcher icon.

After editing the SVG, regenerate all PNG and ICO assets from the repository root:

```sh
npm run generate:brand --workspace=@codexhost/renderer-extension
```
