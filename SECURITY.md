# Security Policy

`whatsloaded` reads and manages local configuration files for AI coding tools (such as `~/.claude.json`, `~/.codex/config.toml`, and `~/.kiro/settings/mcp.json`) that frequently contain API keys or personal access tokens. Security and local isolation are first-class design constraints.

## Security Model

### 1. Strict Loopback Binding (`127.0.0.1` Only)

The Web UI server (`whatsloaded ui`) binds exclusively to `127.0.0.1`. There is intentionally no `--host` flag to expose it on a network interface. To access it remotely, use an authenticated SSH local port-forward (`ssh -L 4319:127.0.0.1:4319 user@host`).

### 2. DNS Rebinding & CSRF Protections

- **DNS Rebinding Guard**: Every HTTP request to the local server validates the `Host` header against `127.0.0.1` / `localhost` on the active port; foreign `Host` headers are rejected immediately with `421 Misdirected Request`.
- **CSRF Guard**: All state-changing `POST` requests require a same-origin `Origin` header and `Content-Type: application/json`.
- **Server-Side Plan Execution**: The browser UI can never send arbitrary file paths or raw file contents to write. Plans are constructed and held in server memory; the UI can only request execution of a server-generated plan ID.

### 3. Secret Redaction by Default

Environment variable values (`env`) and HTTP headers (`headers`) are masked before leaving the process in `whatsloaded ls`, `whatsloaded show`, diff previews, and all Web UI API responses. Raw values are only shown in the CLI when `--reveal` is explicitly passed.

### 4. Safe MCP Tool Measurement

`whatsloaded measure <server>` starts an MCP server process _only_ after displaying the exact command and receiving user confirmation (or `--yes`). Project-scoped servers are explicitly flagged, execution is bounded by a strict 15-second timeout with process-group cleanup, and only tool names and byte sizes are cached in `~/.whatsloaded/cache/tools/`.

### 5. Extension Permission Verification

User extensions in `~/.whatsloaded/{adapters,providers}/` run with user privileges. `whatsloaded` refuses to load any extension file or directory that is group- or world-writable, and all extensions can be bypassed with `--no-extensions` or `WHATSLOADED_NO_EXTENSIONS=1`.

## Reporting a Vulnerability

If you discover a security issue—particularly involving localhost request forgery, secret exposure, or path traversal—please open a security advisory on GitHub or contact the maintainer directly rather than filing a public issue with exploit details.
