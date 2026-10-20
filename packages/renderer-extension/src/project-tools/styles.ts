export const projectToolsStyle = `
[data-codexhost-project-tools]{display:inline-flex;align-items:center;gap:1px;margin-left:2px;flex:none;vertical-align:middle}
[data-codexhost-project-tools] button{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:5px;background:transparent;color:inherit;opacity:.62;cursor:pointer}
[data-codexhost-project-tools] button:hover{background:color-mix(in srgb,currentColor 12%,transparent);opacity:1}
[data-codexhost-project-tools] button:focus-visible{outline:2px solid #508df2;outline-offset:1px;opacity:1}
[data-codexhost-project-tools] button:disabled{opacity:.45;cursor:progress}
[data-codexhost-project-tools] svg{width:14px;height:14px;flex:none}
[data-codexhost-project-tool-spin]{animation:codexhost-project-tool-spin .8s linear infinite}
@keyframes codexhost-project-tool-spin{to{transform:rotate(360deg)}}
[data-codexhost-project-tool-picker]{position:fixed;z-index:10030;box-sizing:border-box;width:min(320px,calc(100vw - 16px));padding:6px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:8px;background:var(--color-token-dropdown-background,Canvas);color:CanvasText;box-shadow:0 12px 36px #0003;font:13px/18px system-ui,sans-serif;color-scheme:inherit}
[data-codexhost-project-tool-picker] a,[data-codexhost-project-tool-picker] button{display:flex;align-items:center;gap:9px;width:100%;box-sizing:border-box;padding:7px 8px;border:0;border-radius:6px;background:transparent;color:inherit;text-align:left;text-decoration:none;font:inherit;cursor:pointer}
[data-codexhost-project-tool-picker] a:hover,[data-codexhost-project-tool-picker] button:hover{background:color-mix(in srgb,currentColor 9%,transparent)}
[data-codexhost-project-tool-picker] a:focus-visible,[data-codexhost-project-tool-picker] button:focus-visible{outline:2px solid #508df2;outline-offset:-2px}
[data-codexhost-project-tool-picker] svg{width:16px;height:16px;flex:none}
[data-codexhost-project-tool-picker] span{display:grid;min-width:0;gap:1px}
[data-codexhost-project-tool-picker] small{overflow:hidden;color:GrayText;font-size:11px;line-height:15px;text-overflow:ellipsis;white-space:nowrap}
[data-codexhost-project-tools-dialog]{box-sizing:border-box;width:min(560px,calc(100vw - 24px));max-height:calc(100vh - 32px);overflow:auto;padding:20px;border:1px solid var(--color-border,#8884);border-radius:10px;background:var(--color-token-dropdown-background,light-dark(#fff,#24262c));color:var(--color-token-text-primary,light-dark(#202020,#eee));box-shadow:0 16px 52px #0004;font:13px/1.5 system-ui,sans-serif;color-scheme:inherit}
[data-codexhost-project-tools-dialog]::backdrop{background:#0005}
[data-codexhost-project-tools-dialog] h2{margin:0 0 4px;font-size:16px;line-height:22px}
[data-codexhost-project-tools-dialog] p{margin:0 0 14px;overflow-wrap:anywhere}
[data-codexhost-project-tools-dialog] fieldset{min-width:0;margin:12px 0;padding:12px;border:1px solid #8884;border-radius:8px}
[data-codexhost-project-tools-dialog] legend{padding:0 4px;font-weight:600}
[data-codexhost-project-tools-dialog] label{display:grid;gap:4px;margin:0 0 10px}
[data-codexhost-project-tools-dialog] label:last-child{margin-bottom:0}
[data-codexhost-project-tools-dialog] input{box-sizing:border-box;width:100%;min-height:34px;padding:6px 8px;border:1px solid #8886;border-radius:6px;background:transparent;color:inherit;font:inherit}
[data-codexhost-project-tools-dialog] input:focus-visible{outline:2px solid #508df2;outline-offset:1px}
[data-codexhost-project-tools-dialog] textarea{box-sizing:border-box;width:100%;min-height:88px;resize:vertical;padding:7px 8px;border:1px solid #8886;border-radius:6px;background:transparent;color:inherit;font:inherit}
[data-codexhost-project-tools-dialog] textarea:focus-visible{outline:2px solid #508df2;outline-offset:1px}
[data-codexhost-project-tools-dialog] .codexhost-project-tool-copy-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
[data-codexhost-project-tools-dialog] .codexhost-project-tool-copy-row input{flex:1 1 280px}
[data-codexhost-project-tools-dialog] .codexhost-project-tool-hint{color:GrayText;font-size:12px;line-height:18px}
[data-codexhost-project-tools-dialog] .codexhost-project-tool-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin-top:16px}
[data-codexhost-project-tools-dialog] .codexhost-project-tool-actions button{min-height:32px;padding:5px 11px;border:1px solid #8884;border-radius:6px;background:transparent;color:inherit;font:inherit;cursor:pointer}
[data-codexhost-project-tools-dialog] .codexhost-project-tool-actions button[type=submit]{border-color:#1677d2;background:#1677d2;color:#fff}
[data-codexhost-project-tools-dialog] button:hover{filter:brightness(1.08)}
[data-codexhost-project-tools-dialog] button:disabled{opacity:.5;cursor:default}
[data-codexhost-project-tool-toast]{position:fixed;right:16px;bottom:16px;z-index:10040;box-sizing:border-box;max-width:min(460px,calc(100vw - 32px));padding:10px 12px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:8px;background:var(--color-token-dropdown-background,Canvas);color:CanvasText;box-shadow:0 10px 30px #0003;font:13px/18px system-ui,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere}
[data-codexhost-project-tool-toast][data-state=failed]{border-color:#d14343}
@media (max-width:520px){
[data-codexhost-project-tools-dialog]{width:calc(100vw - 16px);padding:16px}
[data-codexhost-project-tools] button{width:24px;height:24px}
}
@media (prefers-reduced-motion:reduce){[data-codexhost-project-tool-spin]{animation:none}}
`;
