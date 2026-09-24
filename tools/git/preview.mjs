import { build } from "esbuild";
import { createServer } from "node:http";
import path from "node:path";

// Renders the Git settings page alone so layout and diff styling can be tuned
// without launching Desktop. Host actions are deterministic fixtures.
const source = `
import { createGitSettingsPage } from './packages/renderer-extension/src/settings/git-page.ts';
import { rendererSettingsMessages } from './packages/renderer-extension/src/settings/localization.ts';
import gitPageCss from './packages/renderer-extension/src/settings/git-page.css';

const style = document.createElement('style');
style.textContent = gitPageCss;
document.head.append(style);

const status = {
  workspace: '/Users/dev/project',
  branch: 'feature/git-panel',
  detached: false,
  head: '8f31ac2',
  upstream: 'origin/feature/git-panel',
  ahead: 2,
  behind: 1,
  changes: [
    { path: 'src/settings/git-page.ts', indexStatus: 'M', workTreeStatus: ' ', staged: true, unstaged: false, untracked: false, conflicted: false },
    { path: 'src/settings/git-page.css', indexStatus: 'A', workTreeStatus: ' ', staged: true, unstaged: false, untracked: false, conflicted: false },
    { path: 'src/host-runtime.ts', indexStatus: ' ', workTreeStatus: 'M', staged: false, unstaged: true, untracked: false, conflicted: false },
    { path: 'notes/new-idea.md', indexStatus: '?', workTreeStatus: '?', staged: false, unstaged: true, untracked: true, conflicted: false },
    { path: 'src/old-file.ts', originalPath: 'src/legacy-file.ts', indexStatus: 'R', workTreeStatus: ' ', staged: true, unstaged: false, untracked: false, conflicted: false },
  ],
};

const diff = [
  'diff --git a/src/settings/git-page.css b/src/settings/git-page.css',
  'index 1111111..2222222 100644',
  '--- a/src/settings/git-page.css',
  '+++ b/src/settings/git-page.css',
  '@@ -1,6 +1,8 @@',
  ' .settings-git-page {',
  '-  color: #666;',
  '+  color: var(--settings-text);',
  '+  background: var(--git-bg);',
  ' }',
  '+',
  '+.settings-git-diff-line.is-add { background: var(--git-add-bg); }',
].join('\\n');

const client = {
  inspectGitStatus: async () => structuredClone(status),
  inspectGitDiff: async () => ({ path: 'src/settings/git-page.css', diff, truncated: false }),
  stageGitPaths: async () => structuredClone(status),
  unstageGitPaths: async () => structuredClone(status),
  commitGit: async () => ({ commit: 'abc1234', pushed: false, output: '', status }),
  pushGit: async () => structuredClone(status),
  listGitMessageModels: async () => ({ models: [
    { id: 'deepseek-flash', label: 'deepseek-flash', tier: '垃', eligible: true },
    { id: 'gpt-strong', label: 'gpt-strong', tier: '夯', eligible: true },
  ], defaultModel: 'deepseek-flash' }),
  generateGitMessage: async () => ({ message: 'feat: add IDE-style Git panel', model: 'deepseek-flash' }),
};

const page = createGitSettingsPage(rendererSettingsMessages('zh-CN'), () => ({ threadId: 'preview', client }));
const root = document.querySelector('#git-page');
page.mount({
  content: root,
  signal: new AbortController().signal,
  runLatest: async (operation, handlers) => {
    try { handlers.success(await operation(new AbortController().signal)); }
    catch (error) { handlers.failure(error); }
  },
});
`;

const bundle = await build({
  stdin: {
    contents: source,
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  loader: { ".css": "text", ".png": "dataurl", ".svg": "dataurl" },
  write: false,
});
const script = bundle.outputFiles[0].text;
const html = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Git 面板预览</title>
<style>
:root{color-scheme:light dark;--settings-bg:light-dark(#fff,#202020);--settings-panel:light-dark(#fff,#232323);--settings-surface:light-dark(#f6f6f6,#292929);--settings-text:light-dark(#0d0d0d,#ececec);--settings-muted:light-dark(#676767,#a3a3a3);--settings-subtle:light-dark(#8a8a8a,#777);--settings-border:light-dark(rgb(13 13 13/9%),rgb(255 255 255/9%));--settings-divider:light-dark(rgb(13 13 13/7%),rgb(255 255 255/7%));--settings-hover:light-dark(rgb(13 13 13/5%),rgb(255 255 255/7%));--settings-focus:light-dark(#0b75d1,#66aaf9);--settings-danger:light-dark(#b42318,#f87171);--settings-danger-bg:light-dark(#fff1f0,rgb(239 68 68/8%));--settings-danger-border:light-dark(#f3c7c3,rgb(239 68 68/22%));--settings-success:light-dark(#16784a,#4ade80);font:13px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{margin:0;background:var(--settings-bg);color:var(--settings-text)}main{width:min(1100px,calc(100% - 48px));margin:40px auto 120px}.settings-command-button{display:inline-flex;align-items:center;justify-content:center;min-height:34px;gap:7px;padding:0 12px;color:var(--settings-primary-text);background:var(--settings-primary);border:1px solid transparent;border-radius:7px;cursor:pointer}.settings-command-button--secondary{color:var(--settings-text);background:var(--settings-bg);border-color:var(--settings-border)}button:disabled{opacity:.45;cursor:not-allowed}.codexhost-settings-icon{display:block}
</style>
<main><div id="git-page"></div></main>
<script>${script}</script>
</html>`;

const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html;charset=utf-8");
  response.end(html);
});
server.listen(43872, "127.0.0.1", () => {
  console.log("Git preview: http://127.0.0.1:43872");
});
