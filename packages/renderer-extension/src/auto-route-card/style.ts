export const autoRouteCardStyle = `
[data-codexhost-auto-route] {
  --route-accent: light-dark(#06745e, #63dcbc);
  box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%;
  margin: 12px 0 18px; padding: 14px 16px;
  border: 1px solid light-dark(#b9d7cf, #38594f);
  border-left: 4px solid var(--route-accent); border-radius: 8px;
  background: light-dark(#f2f9f6, #1c2925); color: light-dark(#172b25, #edf7f1);
  font: 13px/1.5 system-ui, sans-serif; letter-spacing: 0;
  box-shadow: 0 2px 6px #00000008; overflow-wrap: anywhere;
}
[data-codexhost-auto-route][data-state="failed"],
[data-codexhost-auto-route][data-state="interrupted"] {
  --route-accent: light-dark(#a34224, #ffb899);
  border-color: light-dark(#dfc2b7, #725142); border-left-color: var(--route-accent);
  background: light-dark(#fff8f4, #302620);
}
[data-codexhost-auto-route] .route-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
[data-codexhost-auto-route] .route-heading { display: flex; align-items: center; gap: 9px; flex: 1; min-width: 130px; font-weight: 650; color: var(--route-accent); }
[data-codexhost-auto-route] .route-symbol { display: grid; place-items: center; width: 28px; height: 28px; flex: none; border-radius: 6px; background: color-mix(in srgb, var(--route-accent) 12%, transparent); }
[data-codexhost-auto-route] .route-state { display: flex; gap: 5px; align-items: center; font-size: 12px; color: var(--route-accent); }
[data-codexhost-auto-route] .route-state svg { flex: none; }
[data-codexhost-auto-route] .route-model { display: block; margin: 9px 0 7px; font-size: 19px; line-height: 1.4; font-weight: 650; overflow-wrap: anywhere; }
[data-codexhost-auto-route] .route-footer { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; color: light-dark(#52685e, #abbfb5); font-size: 12px; }
[data-codexhost-auto-route] .route-count { flex: 1; }
[data-codexhost-auto-route] .route-expand { display: inline-flex; gap: 5px; align-items: center; justify-content: center; flex: none; min-width: 28px; height: 28px; padding: 3px; border: 0; border-radius: 4px; background: transparent; color: inherit; cursor: pointer; }
[data-codexhost-auto-route] .route-expand:hover { background: color-mix(in srgb, var(--route-accent) 12%, transparent); }
[data-codexhost-auto-route] .route-expand:focus-visible { outline: 2px solid var(--route-accent); outline-offset: 2px; }
[data-codexhost-auto-route] .route-expand[aria-expanded="true"] svg { transform: rotate(180deg); }
[data-codexhost-auto-route] .route-details { border-top: 1px solid color-mix(in srgb, var(--route-accent) 20%, transparent); margin: 10px 0 0; padding: 10px 0 0; list-style: none; max-height: 240px; overflow: auto; }
[data-codexhost-auto-route] .route-details[hidden] { display: none; }
[data-codexhost-auto-route] .route-details li { padding: 5px 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: start; }
[data-codexhost-auto-route] .route-path { white-space: pre-wrap; overflow-wrap: anywhere; }
[data-codexhost-auto-route] .route-time { font-variant-numeric: tabular-nums; opacity: .65; font-size: 11px; }
[data-codexhost-auto-route] .route-notice { color: light-dark(#944520, #ffc193); margin-top: 6px; font-size: 12px; }
[data-codexhost-auto-route] .route-attempts { list-style: none; margin: 0; padding: 0; }
[data-codexhost-auto-route] .route-plan { margin-top: 10px; }
[data-codexhost-auto-route] .route-search { display: block; box-sizing: border-box; width: 100%; margin: 8px 0; padding: 6px 8px; border: 1px solid color-mix(in srgb, var(--route-accent) 30%, transparent); border-radius: 4px; background: light-dark(#fff, #18221f); color: inherit; font: inherit; }
[data-codexhost-auto-route] .route-candidates { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 12px; text-align: left; }
[data-codexhost-auto-route] .route-candidates th { font-weight: 600; }
[data-codexhost-auto-route] .route-candidates th:first-child { width: 32px; }
[data-codexhost-auto-route] .route-candidates th:last-child { width: 31%; }
[data-codexhost-auto-route] .route-candidates th, [data-codexhost-auto-route] .route-candidates td { padding: 6px 5px; vertical-align: top; border-bottom: 1px solid color-mix(in srgb, var(--route-accent) 12%, transparent); overflow-wrap: anywhere; }
[data-codexhost-auto-route] .route-candidates tr[data-eligible="true"] td:last-child { color: var(--route-accent); }
[data-codexhost-auto-route] .route-candidates tr[hidden] { display: none; }
`;
