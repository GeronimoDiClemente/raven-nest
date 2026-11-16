export interface ActionDeps {
  getToken(pluginId: string): string | null
  fetch: typeof fetch
}
export interface ActionResult { ok: boolean; error?: string }

export async function runPluginAction(
  pluginId: string,
  actionId: string,
  params: Record<string, unknown>,
  deps: ActionDeps,
): Promise<ActionResult> {
  if (pluginId === 'slack' && actionId === 'notify') {
    const token = deps.getToken('slack')
    if (!token) return { ok: false, error: 'NOT_CONNECTED' }
    const res = await deps.fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel: params.channel, text: params.text }),
    })
    const json = (await res.json()) as { ok: boolean; error?: string }
    return json.ok ? { ok: true } : { ok: false, error: json.error ?? 'slack_error' }
  }
  return { ok: false, error: 'UNKNOWN_ACTION' }
}
