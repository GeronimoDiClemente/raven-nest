import { describe, it, expect } from 'vitest'
import { _internals } from '../diff-engine'

const SAMPLE = `diff --git a/src/foo.ts b/src/foo.ts
index 1111111..2222222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,5 +1,6 @@
 const x = 1
-const y = 2
+const y = 3
+const z = 4
 const w = 5
 const v = 6
diff --git a/src/bar.ts b/src/bar.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/bar.ts
@@ -0,0 +1,1 @@
+export const NEW = true
diff --git a/img.png b/img.png
index 4444444..5555555 100644
Binary files a/img.png and b/img.png differ
`

describe('diff-engine.parseUnifiedDiff', () => {
  it('parses multiple files with adds/dels/context', () => {
    const files = _internals.parseUnifiedDiff(SAMPLE)
    expect(files.length).toBe(3)
    const foo = files[0]
    expect(foo.path).toBe('src/foo.ts')
    expect(foo.additions).toBe(2)
    expect(foo.deletions).toBe(1)
    expect(foo.hunks.length).toBe(1)
    expect(foo.hunks[0].lines.find((l) => l.type === 'add' && l.text === 'const z = 4')).toBeDefined()
  })

  it('detects new files', () => {
    const files = _internals.parseUnifiedDiff(SAMPLE)
    const bar = files[1]
    expect(bar.path).toBe('src/bar.ts')
    expect(bar.additions).toBe(1)
    expect(bar.deletions).toBe(0)
  })

  it('marks binary files', () => {
    const files = _internals.parseUnifiedDiff(SAMPLE)
    const img = files[2]
    expect(img.binary).toBe(true)
    expect(img.additions).toBe(0)
    expect(img.deletions).toBe(0)
  })

  it('returns empty array for empty input', () => {
    expect(_internals.parseUnifiedDiff('')).toEqual([])
  })
})
