import { installRendererBinding } from "./install-renderer-binding.js";
import { installRendererWindowHostRouting } from "@codexhost/desktop-control/renderer-bindings";

const install = (): void => {
  installRendererWindowHostRouting(document, window);
  installRendererBinding();
};

if (document.documentElement && document.body) {
  install();
} else {
  window.addEventListener("DOMContentLoaded", install, { once: true });
}
