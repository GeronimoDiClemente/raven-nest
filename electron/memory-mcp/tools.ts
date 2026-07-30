// Phase 1 MCP tool manifest — memory_save / memory_search / memory_context only, per
// docs/nest-memory-architecture.md §9 Phase 1 scope. memory_update, memory_get and
// memory_suggest_promotion are designed in §2.1 but land in a later phase.
//
// Tool descriptions are the prompt — see §2.1. They are copied close to verbatim from
// the design doc; do not "clean them up" without re-reading why they're phrased this way.

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
      'Full-text search over this project\'s saved memories. Use when the user references ' +
      "past work by keyword ('how did we handle X', 'the Y decision') and memory_context's " +
      'recent list does not cover it.',
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
] as const
