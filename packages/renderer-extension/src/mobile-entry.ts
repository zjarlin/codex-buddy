import { mobileClientId } from "./mobile/client-id.js";
import { startMobileControl } from "./mobile/control.js";

startMobileControl(document, {
  createClientId: mobileClientId,
  createSocket: (url) => new WebSocket(url),
  fetch: (url, init) => fetch(url, init),
  location: window.location,
  storage: window.localStorage,
});
