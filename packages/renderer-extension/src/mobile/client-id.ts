/** Opaque mobile identity kept across reconnects; the Host stores the matching token digest. */
export function mobileClientId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}
