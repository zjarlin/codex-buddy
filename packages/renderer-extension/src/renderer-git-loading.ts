// 保留按钮原来的尺寸与可访问名称，用旋转指示器覆盖视觉内容。
export const gitButtonLoadingStyles = `
  button[aria-busy="true"] { position:relative; color:transparent !important; opacity:.8 !important; cursor:wait !important; }
  button[aria-busy="true"] > * { visibility:hidden; }
  button[aria-busy="true"]::after { content:""; position:absolute; top:50%; left:50%; width:12px; height:12px; margin:-7px; border:2px solid var(--text-link,#339cff); border-right-color:transparent; border-radius:50%; animation:codexhost-git-spin .7s linear infinite; }
  @keyframes codexhost-git-spin { to { transform:rotate(360deg); } }
  @media (prefers-reduced-motion:reduce) { button[aria-busy="true"]::after { animation-duration:1.8s; } }
`;
