# Use AI coding tools on a remote computer over SSH

The Web console’s **Remote connections** page (`#remote-connections`) provides the same connection management, installation, update, repair, and uninstall actions as the embedded settings. Codex Desktop must be running through codexhost on the local computer.

Use Claude Code, Pi, and other Harnesses (AI coding tools) installed and signed in on another computer from your local Codex Desktop. Your project and tools run remotely while you read replies, send messages, and manage the conversation locally.

## Before you start

- **Local computer**: install Codex Desktop and codexhost, and make sure you can open **Settings → Connections → SSH** in Codex.
- **Remote computer**: use a Mac or Linux computer with SSH enabled and Node.js, npm, and Codex CLI installed. Windows remote computers are not currently supported.
- **Your coding tool**: install it and sign in on the remote computer—for example, Claude Code.
- **Connection details**: have the SSH address ready, such as `username@computer-address`. If your connection needs a specific port or identity file, have those details ready too.

Update local codexhost to the latest version before installing the remote end below.

## Step 1: Check SSH login

Log in to the remote computer once through SSH from your local terminal and confirm its identity. The page uses your existing SSH key or alias and does not show a password prompt.

The remote computer needs Node.js, npm and Codex CLI, with permission for your user to install npm packages. Use Node.js 22.19 or later in the 22.x series, or Node.js 24.x. Installation loads your interactive login shell, including configured version managers such as nvm. Existing installations prefer the executable Node.js path recorded by codexhost; an unsupported recorded version must be updated before maintenance. On a remote Mac, keep the desktop user logged in when using Claude Code.

## Step 2: Add an SSH connection

1. Launch Codex Desktop through codexhost on your local computer.
2. Open **codexhost settings → Remote connections** and click **Add connection**.
3. Enter the connection details:
   - **Name**: choose a recognizable name, such as “Office computer.”
   - **SSH address**: enter `username@computer-address` or an existing SSH alias.
   - **Port and identity file**: fill these in only if your connection requires them; otherwise, leave them blank.
4. Click **Save**, then connect. Native Codex uses official SSH and app-server without a Buddy installation on the remote. External Harnesses require a compatible remote Host.
   - Buddy and upstream codexhost are separate release lines. Buddy does not pass its local version to the npm `@codexhost/cli` installer.
5. Once it shows **Connected**, open a project on that computer in Codex.

Existing Codex SSH connections appear here automatically; you do not need to add them again. Both pages share the same connection settings, so changes appear in both places.

For connections discovered from your SSH config, you can edit the name here. Edit other details in your local SSH config, or view them in Codex **Settings → Connections → SSH**.

## Step 3: Choose a tool and start working

In the remote project's composer, choose your Harness and model from the **Agent / Model** selector, then send a message as usual.

You can work in local and remote projects at the same time. Each shows the tools and models available on its own computer.

If you only use Codex's built-in remote coding features, you do not need codexhost on the remote computer.

### Image and file attachments

External Harnesses continue to receive text and file paths, not Harness-specific image inputs. Ordinary files use Desktop's native upload and remote path references. Reading files, interpreting images, and parsing their formats depend on the Harness's tools and the selected model.

For ordinary submissions to remote external Threads (including automatic submission from Desktop's local queue), if Desktop supplies inline images without a complete set of image paths in the message, codexhost uses **that same remote connection's native attachment store**, waits for successful storage, then adds remote paths to the text. Complete native image references are reused without another upload. Local Threads and native Codex Threads are unchanged; changing direction retains its existing rejection of non-text input.

Fallback storage uses Desktop's `$CODEX_HOME/attachments/` directory and native management, not a separate SSH transfer channel or Host attachment database. When native paths are only partially available, their correspondence to individual inline images is ambiguous, so all inline images are stored rather than guessing which is missing. Fallback storage allows up to 20 images, 20 MiB per image and 32 MiB total (decoded image data). Invalid data, an unavailable native storage interface, upload failure or replacement of the connection prevents submission. Files are retained when a dispatched Turn's outcome is unknown; the message is not automatically retried.

This binding follows the attachment storage and request interfaces in Desktop 26.930.31730 and requires compatibility review after Desktop updates.

## Manage connections

Use **Remote connections** to edit connection details, disconnect, or remove a connection you no longer use.

- **Disconnect** stops automatic connection to that computer. Tasks already started remotely can continue. Click **Connect** when you want to use it again.
- **Remove** removes the computer from the connection list without deleting remote files or conversations.

## Update the remote end

The page distinguishes installed files from the running version. When installed files have changed, **Restart and connect** starts the installed version. Restart, repair and uninstall require an explicit user action and may interrupt active tasks. Updating Desktop does not automatically restart remote services.

Buddy Desktop updates from its own GitHub Release. Upstream npm `@codexhost/cli` belongs to a separate release line; their version numbers cannot be compared. Buddy disables installation and software upgrades through that npm package, while retaining status inspection, restart of the installed version, repair and uninstall.

Maintain an upstream remote using upstream release instructions and independently selected versions. Never substitute a Buddy Desktop version for an upstream npm version. Changes to a Buddy remote require building and installing the corresponding platform artifact; updating Desktop does not upload remote code.

## Test from source with a specified version

`npm start <version>` changes only the source launch's version label. It does not change release identity, enable upstream npm installation or upload source changes. Native Codex session recovery can use official SSH; external Harness sessions, permissions and execution require their corresponding Harness and Host.

## View the same conversation on both computers

If the remote computer also has Codex Desktop, launch it through codexhost there. Use the same codexhost version on both computers, and use the same user account for the remote desktop login and SSH connection.

External Harness conversations created in an SSH project appear on the other computer automatically. This may take a few seconds initially. Both computers can show messages, replies as they arrive, and tool activity. You can also send messages, interrupt tasks, or answer approvals from either computer.

Keep these points in mind:

- Use the insert-message feature to add input during a running task. Starting a separate task may return a busy message.
- If both computers answer the same approval or question, the first processed answer applies.
- After disconnecting, reopen the conversation to see what happened while you were away. If you are unsure whether a message was sent, check the conversation before resending it.

This applies to external Harness conversations created in SSH projects. Other local conversations and built-in Codex conversations continue to work as before.

## Troubleshooting

| What happened | What to try |
| --- | --- |
| A specific tool (Node.js, npm or Codex CLI) is not detected over SSH | Install the named tool on the remote computer, or add its existing installation to the login shell PATH, then retry. This message does not prove the tool is uninstalled. Codex CLI is the command-line tool; remote Codex Desktop is not required. |
| The connection fails or disconnects shortly afterward | Check that SSH login works, then choose **Check again**. Native Codex needs no remote Host; for external Harnesses, verify the installed Host source and compatibility. |
| A Harness is missing | Confirm the tool is installed and signed in on the remote computer, then click **Run connection diagnostics** on codexhost's **Connections** page. |
| Remote version information is missing or the service is outdated | Verify the remote release source. Do not use a Buddy version with upstream npm. |
| An update fails | Verify the release source and installed version. Buddy does not upgrade upstream npm packages. |
| The other computer does not show the same conversation | Check that both computers launched Desktop through codexhost, use the same version, and use the same remote user account. If you use a custom data directory, use the same directory for both launch methods. |
| Installation fails on a Mac | Make sure the remote Mac's desktop user is logged in, then run `codexhost remote install` again. |

## Stop or uninstall

Choose **Uninstall remote service** on the connection card. After confirmation, auto-connect is disabled for this connection, the remote service stops and its connection setup is removed. On Mac, the associated Harness background service is also uninstalled. The SSH connection entry, project files and chat data are kept, so the service can be installed again later. Active remote sessions are interrupted.

The codexhost package is kept by default. Select **Also uninstall the codexhost package** to remove the remote computer's global npm `@codexhost/cli` after service removal succeeds. Codex CLI, Node.js and other Harnesses are kept. Only select this if the remote Desktop no longer needs that package to launch. A mismatch between the active CLI and npm's global installation rejects package removal before stopping the service; choose service-only removal or uninstall the package manually on the remote computer. If package removal fails after service removal, the page explains the partial result and allows retrying.

When you no longer need the remote installation, run these commands on the remote computer:

```bash
codexhost remote stop
codexhost remote uninstall
```

Stopping the service interrupts active conversations. To disconnect temporarily, use **Disconnect** on the page; you do not need to uninstall.

## SSH feature ownership

Model catalogs and probes, Auto Router, session recommendations, interrupted conversation recovery, Git and file operations, session imports, and loaded sessions use the current SSH Host. Provider, System One, and Harness configuration and authentication remain remote. Imported and recommended conversations retain their originating Host; switching connections cannot submit stale selections to another machine.

Basic Git operations also work with the native SSH service: when the remote explicitly lacks a Git RPC, the local Buddy Host uses Desktop's saved SSH connection to run Git on that remote machine. Status, stage/unstage, manual commits, push, sync, submodules, linked-repository directory browsing, and AI commit-message generation do not require remote codexhost installation; directory selection returns paths on that SSH host. The AI worker reads the remote Codex configuration and authentication, calls the remote Provider, and reads the remote Git diff; credentials, files, and upstream error details remain remote. Linked-repository records for this transport are stored locally per connection. Connection and operation failures never trigger a second execution through another transport. See [Git workspace](../../product/git-workspace.md) for details.

For native Codex conversations, **Open in Terminal** launches the chosen terminal on the Desktop machine, uses its saved SSH connection, then runs `codex resume` with the remote workspace, executable and CODEX_HOME. The remote machine does not need a graphical terminal; the local machine needs an SSH client. **Open in VS Code** opens the remote directory through the local Remote SSH extension. Connections with an explicit identity file need an SSH alias so VS Code uses the same key.

Terminal preferences, Desktop updates, and desktop application launchers belong to the local machine. External Harnesses retain their native capabilities and cannot be resumed with the Codex CLI. Remote Windows remains unsupported.

`npx -y codex-buddy sync` updates model configuration but does not replace a running native server. If the catalog already contains `auto` while the menu or extension methods remain unavailable, start the remote Buddy Host after active tasks finish, then reconnect. Let running tasks finish before switching services.

If you only need local projects to survive a Desktop restart, you do not need to move the workspace to an SSH host. Use the [persistent local Host](../../product/persistent-local-host.md) instead.
