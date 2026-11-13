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
  // Los guiones y guiones bajos van ADENTRO de la clase a propósito. Sin ellos el patrón
  // corta en el primer guión, así que `sk-ant-api03-…` da sólo "ant" —tres caracteres—
  // y no llega al mínimo de 10: la clave entera pasa en claro. Es la que más probablemente
  // aparezca en estas memorias, porque los agentes que las escriben corren con una.
  /\bsk-[A-Za-z0-9_-]{10,}\b/g,
  /\bgh[poasu]_[A-Za-z0-9]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{12,}\b/g,
  // "Authorization: Bearer <token>": the generic key=value pattern below alone would match
  // only "Authorization: Bearer" (\S+ stops at the space before the token) and leave an
  // opaque (non-JWT) bearer token exposed right after it. `bearer <anything>` is redacted
  // as one unit, BEFORE the generic pattern runs, for the same reason PEM/JWT/prefixes
  // run first above.
  /\bbearer\s+\S+/gi,
  // Variables de entorno con forma de secreto: `ANTHROPIC_API_KEY=…`, `GITHUB_TOKEN=…`.
  // El patrón genérico de abajo NO las cubre: exige que la palabra clave empiece al
  // principio o después de un espacio, `=` o `:`, y en `ANTHROPIC_API_KEY` viene pegada a un
  // guión bajo. Pedir MAYÚSCULAS es lo que lo hace seguro — "hay que rotar la API key" no
  // matchea, y esa frase en una memoria es mucho más común que la clave misma.
  /\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|CREDENTIALS)\s*[=:]\s*\S+/g,
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
