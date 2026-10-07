export const threadFoldersStyle = `
[data-codexhost-thread-folders]{padding:2px 8px 2px 24px;color:var(--color-token-text-secondary,inherit);font:13px/20px system-ui,sans-serif}
[data-codexhost-thread-folders] [role=group]{padding-left:20px}
[data-codexhost-thread-folders] [hidden]{display:none!important}
[data-codexhost-thread-folders] button{display:flex;align-items:center;gap:6px;width:100%;min-height:28px;padding:3px 6px;border:0;border-radius:5px;background:transparent;color:inherit;font:inherit;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
[data-codexhost-thread-folders] button:hover,[data-codexhost-thread-folders] [aria-selected=true]{background:color-mix(in srgb,currentColor 10%,transparent)}
[data-codexhost-thread-folders] button:focus-visible{outline:2px solid #508df2;outline-offset:1px}
[data-codexhost-folder-context-menu]{position:fixed;z-index:2147483647;min-width:180px;padding:4px;border:1px solid #8884;border-radius:8px;background:var(--color-token-dropdown-background,light-dark(#fff,#24262c));color:var(--color-token-text-primary,light-dark(#202020,#eee));box-shadow:0 8px 30px #0004}
[data-codexhost-folder-context-menu] button{display:block;width:100%;padding:7px 10px;border:0;border-radius:4px;background:transparent;color:inherit;text-align:left;font:13px system-ui;cursor:pointer}
[data-codexhost-folder-context-menu] button:hover,[data-codexhost-folder-context-menu] button:focus{background:color-mix(in srgb,currentColor 12%,transparent)}
[data-codexhost-thread-folder-hidden]{display:none!important}
[data-codexhost-thread-folder-dialog]{box-sizing:border-box;width:min(440px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;padding:18px;border:1px solid var(--color-border,#8884);border-radius:10px;background:var(--color-token-dropdown-background,light-dark(#fff,#24262c));color:var(--color-token-text-primary,light-dark(#202020,#eee));box-shadow:0 12px 48px #0004;font:13px/1.5 system-ui,sans-serif;color-scheme:inherit}
[data-codexhost-thread-folder-dialog]::backdrop{background:#0005}
[data-codexhost-thread-folder-dialog] h2{font-size:15px;margin:0 0 8px}
[data-codexhost-thread-folder-dialog] p{margin:6px 0 12px;overflow-wrap:anywhere}
[data-codexhost-thread-folder-dialog] fieldset{min-width:0;margin:0 0 8px;padding:8px;border:1px solid #8884;border-radius:7px}
[data-codexhost-thread-folder-dialog] legend{font-size:12px;color:GrayText}
[data-codexhost-thread-folder-dialog] label{display:block}
[data-codexhost-thread-folder-dialog] input{box-sizing:border-box;width:100%;display:block;margin-top:3px;padding:5px 7px;border:1px solid #8886;border-radius:5px;background:transparent;color:inherit;font:inherit}
[data-codexhost-thread-folder-dialog] button{padding:4px 8px;border:1px solid #8884;border-radius:5px;background:transparent;color:inherit;font:inherit;cursor:pointer;overflow-wrap:anywhere}
[data-codexhost-thread-folder-dialog] button:hover{background:color-mix(in srgb,currentColor 8%,transparent)}
[data-codexhost-thread-folder-dialog] button:disabled{opacity:.4;cursor:default}
[data-codexhost-thread-folder-dialog] .thread-folder-actions{display:flex;gap:5px;justify-content:flex-end;flex-wrap:wrap;margin-top:8px}
[data-codexhost-thread-folder-dialog] .thread-folder-destinations{display:flex;flex-direction:column;gap:4px}
[data-codexhost-thread-folder-dialog] .thread-folder-destinations button{text-align:left}
`;
