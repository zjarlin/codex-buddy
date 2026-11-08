# Spec Delta

## ADDED Requirements

### Requirement: Host prepares a newer Release without the update UI

The local Desktop Host SHALL check for a newer Release on its own and SHALL begin preparation when the Release has a verified installer for this installation, without requiring the update panel or settings page to be open. A failed automatic preparation or automatic restart SHALL NOT be retried on a timer for the same version; the explicit Renderer retry and restart actions SHALL remain available.

#### Scenario: The update panel was never opened

- **WHEN** the Host finds a newer installable Release after startup
- **THEN** it SHALL begin preparation and download without a Renderer request

#### Scenario: An automatic restart failed

- **WHEN** confirming the restart for a version fails
- **THEN** the Host SHALL record the failure and SHALL NOT retry that version on its next check
- **AND** the Renderer SHALL keep offering the manual restart action

### Requirement: The ready update panel does not offer to postpone

While an update is `ready-to-restart`, the Renderer SHALL state that it installs after an automatic restart, and its secondary action SHALL close the panel instead of postponing the restart.

#### Scenario: The user closes the ready update panel

- **WHEN** the panel shows `ready-to-restart` and the user activates its secondary action
- **THEN** the panel SHALL close without cancelling the automatic restart

### Requirement: Downloaded updates restart only when the Desktop is idle

After preparation reaches `ready-to-restart`, the Host SHALL confirm the restart once the whole Desktop is proven idle. Idle means every Host reports no running work and at least one Host that reads the native Thread list completed the whole list without an `active` Thread. The Host SHALL observe a grace period without work activity and re-check immediately before confirming. A Host that cannot prove idleness SHALL keep waiting.

#### Scenario: A running Turn blocks the automatic restart

- **WHEN** a downloaded update is `ready-to-restart` and any native, external Harness, Subagent, Delegation, queued-message, approval, question, Git workflow, background command, or Harness version operation is still running
- **THEN** the Host SHALL NOT confirm the restart
- **AND** it SHALL keep waiting until every Host reports no running work

#### Scenario: The update panel started the download
- **WHEN** preparation started from the Renderer reaches `ready-to-restart` before the Host's own check interval fires
- **THEN** the Host SHALL begin the idle check immediately

#### Scenario: The Desktop stays idle through the grace period

- **WHEN** all Hosts report no work and the native Thread list contains no `active` Thread
- **AND** no work activity is observed during the grace period
- **AND** a final check immediately before restarting still proves idleness
- **THEN** the Host SHALL confirm the restart exactly once through the existing update restart request

#### Scenario: Idleness cannot be proven

- **WHEN** the native Thread list read fails, returns a malformed page, repeats its cursor, exceeds the pagination bound, or no registered Host can read the native Thread list
- **THEN** the Host SHALL treat the Desktop as not proven idle
- **AND** it SHALL NOT confirm the restart

#### Scenario: Work starts during the grace period

- **WHEN** a Turn starts or another kind of work appears while a downloaded update waits in its grace period
- **THEN** the Host SHALL restart the grace period and wait for work to finish again

#### Scenario: A managed SSH Host finds an update

- **WHEN** the Host runs with `CODEXHOST_REMOTE_SSH_MANAGED=1`
- **THEN** it SHALL NOT start an automatic restart
- **AND** it SHALL NOT terminate the Desktop on the machine that launched it
