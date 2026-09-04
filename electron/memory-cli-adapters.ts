// Per-AI-type memory adapter registry (docs/nest-memory-architecture.md §2.5, §9).
//
// Why a separate file from memory-provisioner.ts: that module's header comment documents
// and guards a Claude-specific hazard (the shared {accountDir}/.claude/settings.json
// symlink — never open it for read-modify-write) and its regression test
// (electron/__tests__/memory-provisioner.test.ts) asserts the global settings.json stays
// byte-identical across provision/deprovision. None of that is generic across AI types,
// so it stays put, untouched, exports unchanged. This file is the seam instead: a thin
// `AiMemoryAdapter` wrapper around the existing Claude functions, plus the registry that
// account-store.ts / pty-manager.ts / main.ts dispatch through so a Gemini/Codex adapter
// (Phase 2) is one more entry here — no changes needed at any call site.
import {
  provisionClaudeAccount,
  deprovisionClaudeAccount,
  type ProvisionerPaths,
} from './memory-provisioner'
import { provisionGeminiAccount, deprovisionGeminiAccount } from './memory-provisioner-gemini'
import { provisionCodexAccount, deprovisionCodexAccount } from './memory-provisioner-codex'

export interface AiMemoryAdapter {
  aiType: string
  /** Binary names (cmd.split(' ')[0]) this adapter handles — pty-manager.ts dispatches by this. */
  binNames: string[]
  /** Idempotent. Writes whatever provisioning state it needs and returns extra spawn args/env. */
  provision(accountDir: string, paths: ProvisionerPaths, isWin: boolean): { args?: string[]; env?: Record<string, string> }
  deprovision(accountDir: string): void
}

/**
 * Wraps the existing Claude provisioning functions in the AiMemoryAdapter shape — it does
 * not reimplement or duplicate their logic, only adapts the call/return shape. Callers
 * that need the underlying functions directly (main.ts's migrateClaudeAccounts path,
 * existing tests) keep importing provisionClaudeAccount/deprovisionClaudeAccount from
 * memory-provisioner.ts as before; this adapter is an additional thin layer on top, not a
 * replacement.
 */
const claudeAdapter: AiMemoryAdapter = {
  aiType: 'claude',
  binNames: ['claude'],
  provision(accountDir, paths, isWin) {
    const { settingsFlagPath } = provisionClaudeAccount(accountDir, paths, isWin)
    return { args: ['--settings', settingsFlagPath] }
  },
  deprovision(accountDir) {
    deprovisionClaudeAccount(accountDir)
  },
}

/**
 * Wraps the Gemini provisioning functions (memory-provisioner-gemini.ts) the same thin way
 * claudeAdapter wraps Claude's. See that module's header for why Gemini's provision() reuses
 * the account's existing `{accountDir}/gemini` identity home instead of a second isolated
 * one, why its deprovision() surgically merges instead of deleting the file outright, and
 * the headless-node caveat (GEMINI_CLI_HOME has no additive equivalent of Claude's
 * `--settings`, currently moot because headless Gemini invocation isn't wired up yet).
 */
const geminiAdapter: AiMemoryAdapter = {
  aiType: 'gemini',
  binNames: ['gemini'],
  provision(accountDir, paths, isWin) {
    return provisionGeminiAccount(accountDir, paths, isWin)
  },
  deprovision(accountDir) {
    deprovisionGeminiAccount(accountDir)
  },
}

/**
 * Wraps the Codex provisioning functions (memory-provisioner-codex.ts) the same thin way
 * claudeAdapter/geminiAdapter wrap theirs. See that module's header for why Codex gets a
 * brand-new isolated CODEX_HOME (no pre-existing identity home to collide with, unlike
 * Gemini) and why `--dangerously-bypass-hook-trust` is always included alongside it.
 */
const codexAdapter: AiMemoryAdapter = {
  aiType: 'codex',
  binNames: ['codex'],
  provision(accountDir, paths, isWin) {
    return provisionCodexAccount(accountDir, paths, isWin)
  },
  deprovision(accountDir) {
    deprovisionCodexAccount(accountDir)
  },
}

const ADAPTERS: Record<string, AiMemoryAdapter> = {
  claude: claudeAdapter,
  gemini: geminiAdapter,
  codex: codexAdapter,
}

/** Looked up by pty-manager.ts using `cmd.split(' ')[0]` — the binary actually launched. */
export function adapterForBin(bin: string): AiMemoryAdapter | null {
  for (const adapter of Object.values(ADAPTERS)) {
    if (adapter.binNames.includes(bin)) return adapter
  }
  return null
}

/** Looked up by account-store.ts using the account's aiType (e.g. from `save(aiType, name)`). */
export function adapterForAiType(aiType: string): AiMemoryAdapter | null {
  return ADAPTERS[aiType] ?? null
}
