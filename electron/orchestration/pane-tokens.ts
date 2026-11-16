/*
 * Portado del modelo de McpSessionRegistry.ts de t3code, reescrito sin Effect.
 *
 * MIT License
 * Copyright (c) 2026 T3 Tools Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { createHash, randomBytes } from 'node:crypto'

const sha256 = (token: string): string => createHash('sha256').update(token).digest('hex')

/**
 * Un token por pane para autenticar contra el socket local. Sólo se guarda
 * sha256(token) → paneId: el token en claro vive en el pane que lo recibió.
 */
export class PaneTokenRegistry {
  private readonly byHash = new Map<string, string>()
  private readonly hashByPane = new Map<string, string>()

  /** Emite un token nuevo; si el pane ya tenía uno, ese queda revocado. */
  issue(paneId: string): string {
    this.revoke(paneId)
    const token = randomBytes(32).toString('base64url')
    const hash = sha256(token)
    this.byHash.set(hash, paneId)
    this.hashByPane.set(paneId, hash)
    return token
  }

  resolve(token: string): string | null {
    if (!token) return null
    return this.byHash.get(sha256(token)) ?? null
  }

  revoke(paneId: string): void {
    const hash = this.hashByPane.get(paneId)
    if (hash === undefined) return
    this.byHash.delete(hash)
    this.hashByPane.delete(paneId)
  }

  revokeAll(): void {
    this.byHash.clear()
    this.hashByPane.clear()
  }

  /** Sólo para tests: los hashes guardados (nunca el token en claro). */
  _hashesForTest(): string[] {
    return [...this.byHash.keys()]
  }
}
