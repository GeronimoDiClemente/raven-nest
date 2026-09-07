// Phase 1 MCP tool manifest — memory_save / memory_search / memory_context, per
// docs/nest-memory-architecture.md §9 Phase 1 scope. memory_update and memory_get are
// designed in §2.1 but land in a later phase. memory_promote is Team Memory Layer 1
// (Parte 7 del plan, lado cliente): promueve una memoria ya guardada a scope 'team' — sin
// cola de aprobacion (decision ya tomada), pero SOLO a pedido explicito del usuario, nunca
// por iniciativa propia del modelo (ver su description abajo).
//
// Tool descriptions are the prompt — see §2.1. They are copied close to verbatim from
// the design doc; do not "clean them up" without re-reading why they're phrased this way.

// M27: field-validated gap — sync works end-to-end, but agents only used memory when a
// user explicitly asked, because nothing told a connected model WHEN to call these tools
// on its own. Tool descriptions alone are a per-tool lever; this is the server-wide one —
// the MCP `initialize` result's optional `instructions` field (2024-11-05 spec: "can be
// thought of like a hint to the model... MAY be added to the system prompt"), wired in
// index.ts's `initialize` handler. Kept compact and imperative on purpose: a model pays
// tokens for this every single session. Mirrors the same trigger-based, mandatory framing
// as memory_save's own description below rather than descriptive prose.
export const MCP_INSTRUCTIONS =
  'Nest Memory protocol — mandatory, not optional:\n' +
  '1. Session start, or whenever the user references past work (any language: ' +
  '"remember", "what did we do", "cómo resolvimos", "like last time"): call ' +
  'memory_context, then memory_search with their keywords, BEFORE answering.\n' +
  '2. Immediately after any decision, bug fix, convention, or non-obvious discovery: ' +
  'call memory_save without being asked. Include what, why, and where (files).\n' +
  '3. If memory_context/memory_search return nothing for something the user insists ' +
  'happened, say so explicitly. Never invent or guess prior work.'

export const TOOL_MANIFEST = [
  {
    name: 'memory_save',
    description:
      "Save a durable memory. CALL THIS WITHOUT BEING ASKED, immediately after any of: " +
      "an architecture or design decision; a bug fixed (include the root cause); a convention or " +
      "naming pattern established; a non-obvious discovery about this codebase; a gotcha or edge " +
      "case; a tool/library choice with tradeoffs; a user preference or constraint you learned. " +
      "Do not wait for the user to say 'remember this' — they will not. Self-check before every " +
      "reply: did I decide something, fix something, or learn something non-obvious? If yes, call " +
      "memory_save NOW. Saving is cheap; forgetting is not. Use topic_key for evolving topics so " +
      "updates replace the old version instead of piling up.",
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: "Verb + object, short and searchable. 'Fixed N+1 query in UserList'" },
        content: { type: 'string', description: 'What / Why / Where (files) / Learned (gotchas). 4 short paragraphs max.' },
        type: {
          type: 'string',
          enum: ['decision', 'bugfix', 'architecture', 'discovery', 'pattern', 'config', 'preference'],
        },
        topic_key: { type: 'string', description: "Stable slug for evolving topics, e.g. 'architecture/auth-model'. Omit for one-off facts." },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'content', 'type'],
    },
  },
  {
    name: 'memory_search',
    description:
      'Full-text search over this project\'s saved memories. CALL THIS BEFORE ANSWERING ' +
      "when the user references past work ('remember', 'how did we handle X', 'cómo " +
      "resolvimos', in any language) and memory_context's recent list does not cover it. " +
      'If it returns nothing for something the user insists happened, say so explicitly — ' +
      'do not guess or invent past work.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_context',
    description:
      'Load what you already know about this project. CALL THIS FIRST, before answering the ' +
      "user's first message in a session, and again whenever the user references past work " +
      "('remember', 'we decided', 'like last time', 'how did we solve'). Returns recent decisions, " +
      'conventions and open threads for the current working directory. Cheap. Not calling it means ' +
      're-deriving context the user already paid for.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'memory_promote',
    description:
      "Share a saved memory with the whole team, so every teammate connected to this project " +
      "sees it too. CALL THIS ONLY when the user explicitly asks to share/promote a memory " +
      "with the team, or says something is 'team-wide', 'for everyone', 'todo el equipo' — " +
      "never on your own initiative, and never speculatively. Requires the sync_id returned " +
      "by a prior memory_save call for the memory being promoted. Promotion is immediate, not " +
      "queued for approval — confirm with the user what is being shared before calling this.",
    inputSchema: {
      type: 'object',
      properties: {
        sync_id: { type: 'string', description: 'The syncId returned by memory_save for the memory to promote.' },
        reason: { type: 'string', description: 'Optional short note on why this is being shared with the team.' },
      },
      required: ['sync_id'],
    },
  },
] as const
