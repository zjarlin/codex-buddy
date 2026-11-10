import type { MobilePairingStatus } from "@codexhost/shared-contracts";

/** Console-facing control over one Host's LAN phone listener. */
export interface MobileControlAdmin {
  status(): Promise<MobilePairingStatus>;
  /**
   * Rotates any previous invite and returns the QR URL the console renders. The first call also
   * starts the LAN listener, so a Host that was never asked to pair keeps its port closed.
   */
  invite(): Promise<{ url: string; expiresAt: number }>;
  revoke(clientId: string): Promise<boolean>;
  close(): Promise<void>;
}
