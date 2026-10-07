import { build } from "esbuild";
import { createServer } from "node:http";
import path from "node:path";
import { tailwindEsbuildPlugin } from "../../packages/renderer-extension/scripts/tailwind-esbuild-plugin.mjs";

// 独立浏览器夹具只验证组件；真实 App Server 另由 verify-live.mjs 验证。
const source = `
import { createRoutingSettingsPage } from './packages/renderer-extension/src/settings/routing-page.ts';
import { createRendererSettingsPageRegistry } from './packages/renderer-extension/src/settings/core.ts';
import { rendererSettingsMessages } from './packages/renderer-extension/src/settings/localization.ts';
import { mountRendererSettingsShell } from './packages/renderer-extension/src/settings/shell.ts';
const settings = {enabled:true,privateMode:false,bypass:true,jev:true,systemOneModel:'typesafe/jev',role:'auto',executorModel:null};
const snapshot={settings,models:[{id:'gpt-6',tier:'夯',eligible:true},{id:'deepseek-v4.1-flash',tier:'垃',eligible:true}],decisions:[],jevKeyConfigured:false,jevBaseUrl:null};
const client={buddyStatus:async()=>structuredClone(snapshot),buddyModels:async()=>structuredClone(snapshot),buddyConfigure:async(value)=>{snapshot.settings=value;return structuredClone(snapshot);},buddyJevKey:async(value)=>{if(value.apiKey!==undefined)snapshot.jevKeyConfigured=Boolean(value.apiKey);if(value.baseURL!==undefined)snapshot.jevBaseUrl=value.baseURL;return structuredClone(snapshot);}};
window.buddyFixture={snapshot,client};
const messages=rendererSettingsMessages('zh-CN');
const shell=mountRendererSettingsShell(createRendererSettingsPageRegistry([createRoutingSettingsPage(messages,()=>client)]),document,messages);
shell.openSettings();
`;
const bundle = await build({
  stdin: { contents: source, resolveDir: path.resolve(import.meta.dirname, "../.."), loader: "ts" },
  bundle: true,
  loader: { ".css": "text", ".png": "dataurl", ".svg": "dataurl" },
  plugins: [tailwindEsbuildPlugin()],
  format: "iife",
  write: false,
});
const script = bundle.outputFiles[0].text;
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Buddy 路由设置验收</title><style>:root{color-scheme:dark}body{background:#202020;color:#ececec;font:14px system-ui;margin:0}</style><p>界面验收夹具：配置为模拟数据</p><script>${script}</script></html>`;
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html;charset=utf-8");
  res.end(html);
});
server.listen(43871, "127.0.0.1", () => console.log("Buddy preview: http://127.0.0.1:43871"));
