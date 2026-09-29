# Remote Harnesses over SSH

Use Harnesses that are installed and signed in only on a remote machine — Claude Code included — from your local Codex Desktop, through its native SSH workspace. Your credentials stay on the remote machine and are never sent over SSH.

## Prerequisites

- **Local machine** (macOS, Linux, or Windows): Codex Desktop and codexhost are installed.
- **Remote machine** (macOS or x64/ARM64 Linux; Windows isn't supported yet): Codex CLI is installed, along with **the same codexhost version** as your local machine.
- The Harness you want to use is installed and signed in on the remote machine.
- Codex Desktop's native SSH workspace already works (**Settings → Connections → SSH**).

## Install

On the remote machine, run:

```bash
npm install -g @codexhost/cli
codexhost remote install
codexhost remote start
codexhost remote status
```

`remote install` adds a clearly marked block to your shell profile that only applies to SSH sessions, and backs up the profile first. Your local shells and existing `codex` command are left alone. On macOS, it also installs a per-user LaunchAgent that starts Claude Code in your logged-in session. It never reads the Keychain or any credentials.

## Usage

1. On your local machine, launch Codex Desktop through codexhost.
2. Open the SSH workspace.
3. Pick a Harness from the composer's Agent / Model selector.

## Commands

```bash
codexhost remote status     # Check whether it is running and installed correctly
codexhost remote start      # Start it (safe to run more than once)
codexhost remote stop       # Stop it without touching other Codex processes
codexhost remote uninstall  # Uninstall it but keep your Thread mapping data
```

After you start, stop, or uninstall, reconnect the SSH workspace in Codex Desktop.

## Upgrade

Upgrade both machines to the same version using the same package manager, then rerun `codexhost remote install` on the remote machine. Wait for existing remote tasks to finish before running `codexhost remote stop` followed by `codexhost remote start`, then reconnect the SSH workspace. Running `start` alone reuses a running Host and does not guarantee that it has loaded the new version.

## Troubleshooting

- **`codexhost/harness/inspect is unsupported on this Host connection`**: the SSH connection isn't going through codexhost. Make sure the same codexhost version is installed and running on the remote machine, then reconnect the SSH workspace.
- **Auto Router or conversation recovery is unavailable on this connection**: the connection does not provide that extension API and may still use the official native service or an older Host. Model synchronization does not enable these APIs. Check the remote codexhost version and status, follow the upgrade steps above, and reconnect. Auto Router and recovery are checked independently; either API can be available without the other.
- **`remote status` says degraded or asks you to reinstall**: run `codexhost remote install`, then `codexhost remote start`.
- **A Harness is missing**: make sure it is installed and signed in on the remote machine, then click **Run connection diagnostics** in Settings.
- **Install fails on macOS with a launchd / `gui/$UID` error**: the remote Mac needs someone logged in to the desktop. Log in, then run `codexhost remote install` again.

## SSH feature ownership

Model catalogs and probes, Auto Router, session recommendations, interrupted conversation recovery, Git and file operations, session imports, and loaded sessions use the current SSH Host. Provider, System One, and Harness configuration and authentication remain remote. Imported and recommended conversations retain their originating Host; switching connections cannot submit stale selections to another machine.

Basic Git operations also work with the native SSH service: when the remote explicitly lacks a Git RPC, the local Buddy Host uses Desktop's saved SSH connection to run Git on that remote machine. Status, stage/unstage, manual commits, push, sync, and submodules do not require remote codexhost installation. Git credentials and files remain remote; linked-repository records for this transport are stored locally per connection. AI commit-message generation still requires the remote service. Connection and operation failures never trigger a second execution through another transport. See [Git workspace](../../product/git-workspace.md) for details.

For native Codex conversations, **Open in Terminal** launches the chosen terminal on the Desktop machine, uses its saved SSH connection, then runs `codex resume` with the remote workspace, executable and CODEX_HOME. The remote machine does not need a graphical terminal; the local machine needs an SSH client. **Open in VS Code** opens the remote directory through the local Remote SSH extension. Connections with an explicit identity file need an SSH alias so VS Code uses the same key.

Terminal preferences, Desktop updates, and desktop application launchers belong to the local machine. External Harnesses retain their native capabilities and cannot be resumed with the Codex CLI. Remote Windows remains unsupported.

`npx -y codex-buddy sync` updates model configuration but does not replace a running native server. If the catalog already contains `auto` while the menu or extension methods remain unavailable, start the remote Buddy Host after active tasks finish, then reconnect. Let running tasks finish before switching services.
