// Secret scrubber applied to every observation before it touches disk — see
// docs/nest-memory-architecture.md §6.6. Extends the pattern already used in
// electron/setup-runner.ts for output-log redaction.

// Order matters: block/prefix patterns that span or start with a word the generic
// key=value pattern would also match (e.g. "-----BEGIN ... PRIVATE KEY-----" contains
// "KEY-") must run FIRST, otherwise the generic pattern partially consumes the header
// on its first whitespace-delimited token and leaves the rest of the secret intact.
const PATTERNS: RegExp[] = [
  // PEM private keys (single- or multi-line, DOTALL via [\s\S])
  /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
  // JWT shape: header.payload.signature, base64url segments
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  // Provider-specific token prefixes
  /\bsk-[A-Za-z0-9]{10,}\b/g,
  /\bgh[poasu]_[A-Za-z0-9]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{12,}\b/g,
  // Review round 1 (minor): "Authorization: Bearer <token>" style headers were only
  // PARTIALLY redacted — the generic key=value pattern below matches
  // "Authorization: Bearer" (stopping at the space before the actual token, since \S+
  // doesn't cross whitespace) and replaced only that prefix, leaving an opaque
  // (non-JWT — the JWT pattern above already covers the JWT-shaped case) bearer token
  // fully exposed right after it. `bearer <anything>` is redacted as one unit, BEFORE
  // the generic pattern runs, for the same reason PEM/JWT/prefixes run first above.
  /\bbearer\s+\S+/gi,
  // key=value / key: value style secrets
  /(?:^|[\s=:])(?:token|key|password|secret|api[_-]?key|bearer|authorization)\s*[=:]\s*\S+/gi,
]

export interface RedactionResult {
  text: string
  redacted: boolean
}

export function redact(input: string): RedactionResult {
  let text = input
  let redacted = false
  for (const pattern of PATTERNS) {
    if (pattern.test(text)) {
      redacted = true
      text = text.replace(pattern, '<redacted>')
    }
    pattern.lastIndex = 0
  }
  return { text, redacted }
}

// Path deny-list for importers — never read/import these, regardless of source.
const DENY_PATH_PATTERNS = [/\.env(\..+)?$/i, /\.pem$/i, /credentials/i, /\.key$/i, /(^|[\\/])\.git([\\/]|$)/i]

export function isDeniedImportPath(path: string): boolean {
  return DENY_PATH_PATTERNS.some((p) => p.test(path))
}
