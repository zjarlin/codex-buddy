export const projectTabsStyle = `
[data-codexhost-project-tab-hidden]{display:none!important}
[data-codexhost-project-tabs]{display:flex;align-items:center;gap:4px;min-width:0;flex:0 0 auto;margin:6px 8px 10px;font:12px/18px system-ui,sans-serif;color:var(--color-token-text-primary,inherit)}
[data-codexhost-project-tabs] [role=group]{display:flex;gap:3px;overflow-x:auto;min-width:0;scrollbar-width:thin}
[data-codexhost-project-tabs] button{flex-shrink:0;white-space:nowrap;border:0;border-radius:6px;padding:4px 8px;background:transparent;color:inherit;cursor:pointer;font:inherit}
[data-codexhost-project-tabs] button[aria-pressed=true]{background:color-mix(in srgb,currentColor 12%,transparent)}
[data-codexhost-project-tabs] button:hover{background:color-mix(in srgb,currentColor 8%,transparent)}
[data-codexhost-project-tabs] button:focus-visible,[data-codexhost-project-tabs-dialog] :focus-visible{outline:2px solid #508df2;outline-offset:2px}
[data-codexhost-project-tabs] > button{margin-left:auto;padding:4px;display:flex}
[data-codexhost-project-tabs-empty]{margin:8px 16px;font:12px/18px system-ui,sans-serif;opacity:.65}
[data-codexhost-project-tabs-error]{margin:8px 16px;font:12px/18px system-ui,sans-serif;color:var(--color-token-text-primary,inherit);overflow-wrap:anywhere}
[data-codexhost-project-tabs-dialog]{box-sizing:border-box;width:min(480px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;padding:20px;border:1px solid var(--color-border,#8884);border-radius:12px;background:var(--color-token-dropdown-background,light-dark(#fff,#24262c));color:var(--color-token-text-primary,light-dark(#202020,#eee));box-shadow:0 12px 48px #0004;font:13px/1.5 system-ui,sans-serif;color-scheme:inherit}
[data-codexhost-project-tabs-dialog]::backdrop{background:#0005}
[data-codexhost-project-tabs-dialog] h2{font-size:16px;margin:0 0 10px}
[data-codexhost-project-tabs-dialog] p{margin:8px 0 14px;overflow-wrap:anywhere}
[data-codexhost-project-tabs-dialog] fieldset{min-width:0;margin:0 0 12px;padding:10px;border:1px solid #8884;border-radius:8px}
[data-codexhost-project-tabs-dialog] label{display:block;margin-bottom:8px}
[data-codexhost-project-tabs-dialog] input,[data-codexhost-project-tabs-dialog] textarea{box-sizing:border-box;width:100%;display:block;margin-top:4px;padding:6px 8px;border:1px solid #8886;border-radius:5px;background:transparent;color:inherit;font:inherit}
[data-codexhost-project-tabs-dialog] textarea{resize:vertical}
[data-codexhost-project-tabs-dialog] button{padding:5px 10px;border:1px solid #8884;border-radius:6px;background:transparent;color:inherit;font:inherit;cursor:pointer;overflow-wrap:anywhere}
[data-codexhost-project-tabs-dialog] button:hover{background:color-mix(in srgb,currentColor 8%,transparent)}
[data-codexhost-project-tabs-dialog] button:disabled{opacity:.4;cursor:default}
[data-codexhost-project-tabs-dialog] .project-tab-actions{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;margin-top:10px}
[data-codexhost-project-tabs-dialog] .project-tab-destinations{display:flex;flex-direction:column;gap:6px}
[data-codexhost-project-tabs-dialog] .project-tab-destinations button{text-align:left}
[data-codexhost-project-tab-move]{cursor:pointer}
[data-codexhost-project-tab-move]:hover,[data-codexhost-project-tab-move]:focus{background:color-mix(in srgb,currentColor 12%,transparent);outline:none}
`;
