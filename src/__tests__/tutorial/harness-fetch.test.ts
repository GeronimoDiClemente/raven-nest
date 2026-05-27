// src/__tests__/tutorial/harness-fetch.test.ts
import { describe, it, expect } from 'vitest'
import { createDemoHarness } from '../../tutorial/demo/harness'
import { createDemoState } from '../../tutorial/demo/fixtures'

describe('demo harness fetch routing', () => {
  it('serves PR list fixtures for api.github.com and restores fetch', async () => {
    const realFetch = window.fetch
    const harness = createDemoHarness(createDemoState())
    harness.activate()

    const res = await fetch('https://api.github.com/repos/demo-user/nest-web/pulls?state=open')
    expect(res.ok).toBe(true)
    const prs = await res.json()
    expect(Array.isArray(prs)).toBe(true)
    expect(prs[0].number).toBe(42)

    harness.deactivate()
    expect(window.fetch).toBe(realFetch)
  })

  it('marks a PR merged on a PUT .../merge', async () => {
    const harness = createDemoHarness(createDemoState())
    harness.activate()
    const res = await fetch('https://api.github.com/repos/demo-user/nest-web/pulls/42/merge', { method: 'PUT' })
    const body = await res.json()
    expect(body.merged).toBe(true)
    expect(harness.state.prs['demo-user/nest-web'][0].merged).toBe(true)
    harness.deactivate()
  })
})
