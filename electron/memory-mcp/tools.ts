// MCP tool manifest — memory_save / memory_search / memory_context / memory_promote /
// memory_get / memory_update, per docs/nest-memory-architecture.md §9. memory_promote is
// Team Memory Layer 1 (Parte 7 del plan, lado cliente): promueve una memoria ya guardada a
// scope 'team' — sin cola de aprobacion (decision ya tomada), pero SOLO a pedido explicito
// del usuario, nunca por iniciativa propia del modelo (ver su description abajo).
//
// memory_get y memory_update (spec 2026-09-11, pantalla de Memories legible) completan las
// seis tools que §1.1 especifica — memory_get envuelve MemoryStore.getSummary(),
// memory_update envuelve MemoryStore.update() (mismo mecanismo de replicación que save(),
// ver su doc comment en memory-store.ts). A diferencia de memory_save, no son "llamar sin
// que te pidan": son lookups/correcciones puntuales sobre una memoria que el modelo ya
// identificó por su sync_id, así que sus descriptions dicen CUÁNDO usarlas en vez de
// empujar a un uso proactivo que no aplica acá.
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
  'memory_context, then memory_search with their keywords, BEFORE answering. ' +
  'memory_context returns an INDEX with truncated bodies — call memory_get only for the ' +
  'few that matter, never for all of them.\n' +
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
      "updates replace the old version instead of piling up. " +
      "LINK AS YOU WRITE: mention a related memory inline as [[its title]] or [[its topic_key]]. " +
      "Links are cheap and they are what lets a later search walk straight to the related memory " +
      "instead of hunting for it. Linking to a memory that does not exist yet is fine — it starts " +
      "working by itself the day you write it.",
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: "Verb + object, short and searchable. 'Fixed N+1 query in UserList'" },
        content: { type: 'string', description: 'What / Why / Where (files) / Learned (gotchas). 4 short paragraphs max. Link related memories inline as [[title or topic_key]].' },
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
      'Load the INDEX of what you already know about this project. CALL THIS FIRST, before ' +
      "answering the user's first message in a session, and again whenever the user references " +
      "past work ('remember', 'we decided', 'like last time', 'how did we solve'). Returns recent " +
      'decisions, conventions and open threads for the current working directory — title, type, ' +
      'tags and the OPENING of each one, not the full text. Items marked `contentTruncated: true` ' +
      'have more: call memory_get with the syncId for the ones that actually matter, and only ' +
      'those. Do not answer from a truncated body as if it were complete. Not calling this at all ' +
      'means re-deriving context the user already paid for.',
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
  {
    name: 'memory_graph',
    description:
      'Draw the shape of what is remembered — which memories exist and how they relate — as a text ' +
      'diagram you can print straight into the conversation. CALL THIS when the user asks what you know ' +
      "about an area ('what do we know about auth?', 'show me the memory graph', 'how does this connect'), " +
      'when you are picking up unfamiliar work and want the lay of the land before searching, or when a ' +
      'decision looks like it might already have been made somewhere else. It answers a different question ' +
      'than memory_search: search finds the memories that match words, this shows how the memories relate ' +
      'to each other — including the relationships that cross projects, which is the one thing a ' +
      'single-repo view can never show you. Returns a ready-to-print diagram, not raw data: print it as-is ' +
      'inside a code block. Filter by tag or project when the user named one; leave both empty for ' +
      'everything.',
    inputSchema: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Only memories carrying this tag. A tag crosses projects — use it when the user asks about a theme rather than a repo.' },
        project_key: { type: 'string', description: 'Only memories from this project. Use the key exactly as a prior memory_search/memory_context returned it.' },
        include_similar: {
          type: 'boolean',
          description: 'Include guessed relationships (shared tags). Off by default because they are inferred, not stated by anyone — turn on only when the stated ones are too sparse to be useful.',
        },
      },
      required: [],
    },
  },
  {
    name: 'memory_get',
    description:
      'Fetch one specific saved memory by its sync_id. Use this when you already have a syncId from a ' +
      "prior memory_save, memory_search, or memory_context call and need that memory's exact, current " +
      "content — before calling memory_promote or memory_update, when the user references 'that memory' " +
      "or pastes an id, or to confirm a save actually took what you think it took. Do not use this to " +
      'browse or discover memories — that is what memory_search and memory_context are for. Returns null ' +
      'if the id does not exist or was deleted; never guess or fabricate a memory to fill the gap. ' +
      'Also returns `neighbors`: the memories this one links to ([[...]] written in its text), the ones ' +
      'that link back to it, and any connected by hand. FOLLOW THEM — fetching a neighbor by its syncId ' +
      'is cheaper and more precise than searching again, and the link is there because someone decided ' +
      'these two belong together.',
    inputSchema: {
      type: 'object',
      properties: {
        sync_id: { type: 'string', description: 'The syncId returned by a prior memory_save, memory_search, or memory_context call.' },
      },
      required: ['sync_id'],
    },
  },
  {
    name: 'memory_update',
    description:
      'Correct a memory you already saved — a wrong detail, a typo, an outdated fact — in place, without ' +
      'creating a duplicate. CALL THIS instead of memory_save when the user says something you recorded ' +
      "was wrong or has changed ('actually it was X, not Y', 'that's outdated now') and gives you (or a " +
      'prior turn already gave you) the syncId. Only include the fields that changed — title, content, ' +
      'and/or tags are all optional and anything omitted is left exactly as it was. Requires the sync_id ' +
      "from a prior memory_save/memory_search/memory_context/memory_get call; if you don't have one, use " +
      "memory_search to find it first. For a topic that naturally evolves over time, prefer memory_save " +
      "with the same topic_key instead — memory_update is for fixing a specific fact, not for logging a " +
      "new revision.",
    inputSchema: {
      type: 'object',
      properties: {
        sync_id: { type: 'string', description: 'The syncId of the memory to correct (from memory_save/memory_search/memory_context/memory_get).' },
        title: { type: 'string', description: 'New title. Omit to leave the current title unchanged.' },
        content: { type: 'string', description: 'New content. Omit to leave the current content unchanged.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Replacement tag list. Omit to leave the current tags unchanged.' },
      },
      required: ['sync_id'],
    },
  },
] as const
