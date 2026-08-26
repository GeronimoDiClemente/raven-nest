import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'

contextBridge.exposeInMainWorld('conversations', {
  list: () => ipcRenderer.invoke('conversations:list'),
  save: (aiType: string, accountName: string, content: string) =>
    ipcRenderer.invoke('conversations:save', aiType, accountName, content),
  get: (id: string) => ipcRenderer.invoke('conversations:get', id),
  delete: (id: string) => ipcRenderer.invoke('conversations:delete', id),
  export: (id: string) => ipcRenderer.invoke('conversations:export', id),
  rename: (id: string, displayName: string) =>
    ipcRenderer.invoke('conversations:rename', id, displayName),
  updateIcon: (id: string, iconEmoji: string | null) =>
    ipcRenderer.invoke('conversations:updateIcon', id, iconEmoji),
})

contextBridge.exposeInMainWorld('snippets', {
  list: () => ipcRenderer.invoke('snippets:list'),
  save: (snippet: unknown) => ipcRenderer.invoke('snippets:save', snippet),
  delete: (id: string) => ipcRenderer.invoke('snippets:delete', id),
})

contextBridge.exposeInMainWorld('localPaths', {
  get: (repoId: string) => ipcRenderer.invoke('localPaths:get', repoId),
  set: (repoId: string, path: string) => ipcRenderer.invoke('localPaths:set', repoId, path),
  delete: (repoId: string) => ipcRenderer.invoke('localPaths:delete', repoId),
  getAll: () => ipcRenderer.invoke('localPaths:getAll'),
  getMigrationFlag: (key: string) => ipcRenderer.invoke('localPaths:getMigrationFlag', key),
  setMigrationFlag: (key: string, value: string) => ipcRenderer.invoke('localPaths:setMigrationFlag', key, value),
})

contextBridge.exposeInMainWorld('customCLIs', {
  list: () => ipcRenderer.invoke('customcli:list'),
  save: (cli: unknown) => ipcRenderer.invoke('customcli:save', cli),
  delete: (id: string) => ipcRenderer.invoke('customcli:delete', id),
})

contextBridge.exposeInMainWorld('workerSpecs', {
  list: () => ipcRenderer.invoke('workerspec:list'),
  save: (input: unknown) => ipcRenderer.invoke('workerspec:save', input),
  delete: (id: string) => ipcRenderer.invoke('workerspec:delete', id),
})

contextBridge.exposeInMainWorld('handoff', {
  read: (worktreePath: string) => ipcRenderer.invoke('handoff:read', worktreePath),
  write: (worktreePath: string, content: string) => ipcRenderer.invoke('handoff:write', worktreePath, content),
})

contextBridge.exposeInMainWorld('graphTemplates', {
  list: () => ipcRenderer.invoke('graph:templates:list'),
  save: (input: unknown) => ipcRenderer.invoke('graph:templates:save', input),
  delete: (id: string) => ipcRenderer.invoke('graph:templates:delete', id),
})

contextBridge.exposeInMainWorld('graphRuns', {
  list: () => ipcRenderer.invoke('graph:runs:list'),
  start: (input: unknown) => ipcRenderer.invoke('graph:run:start', input),
  attach: (runId: string, nodeId: string) => ipcRenderer.invoke('graph:node:attach', runId, nodeId),
})

contextBridge.exposeInMainWorld('dialog', {
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
})

// Nest Memory (docs/nest-memory-architecture.md §8.1). `connect` takes the plaintext
// token the renderer already obtained from supabase.functions.invoke('memory-token',
// {action:'issue', device}) — see §5.1 step 1-2. Main never calls that function itself;
// it only ever receives the token here, once, and encrypts it immediately.
contextBridge.exposeInMainWorld('memory', {
  ensureDeviceId: () => ipcRenderer.invoke('memory:ensureDeviceId'),
  connect: (token: string, deviceId: string) => ipcRenderer.invoke('memory:connect', token, deviceId),
  disconnect: (opts?: { deleteCloud?: boolean }) => ipcRenderer.invoke('memory:disconnect', opts),
  status: () => ipcRenderer.invoke('memory:status'),
  onStatus: (cb: (status: 'idle' | 'syncing' | 'paused' | 'error') => void) => {
    ipcRenderer.removeAllListeners('memory:status')
    ipcRenderer.on('memory:status', (_event, status) => cb(status))
  },
  removeStatusListener: () => {
    ipcRenderer.removeAllListeners('memory:status')
  },
})

contextBridge.exposeInMainWorld('pty', {
  create: (paneId: string, cmd: string, accountDir: string, repoPath?: string, shellId?: string) =>
    ipcRenderer.invoke('pty:create', paneId, cmd, accountDir, repoPath, shellId),
  write: (paneId: string, data: string) =>
    ipcRenderer.send('pty:write', paneId, data),
  resize: (paneId: string, cols: number, rows: number) =>
    ipcRenderer.send('pty:resize', paneId, cols, rows),
  kill: (paneId: string) =>
    ipcRenderer.invoke('pty:kill', paneId),
  exists: (paneId: string) =>
    ipcRenderer.invoke('pty:exists', paneId),
  getBuffer: (paneId: string) =>
    ipcRenderer.invoke('pty:getBuffer', paneId),
  getPid: (paneId: string) =>
    ipcRenderer.invoke('pty:pid', paneId),
  onData: (callback: (paneId: string, data: string) => void) => {
    ipcRenderer.removeAllListeners('pty:data')
    ipcRenderer.on('pty:data', (_event, paneId, data) => callback(paneId, data))
  },
  onExit: (callback: (paneId: string) => void) => {
    ipcRenderer.removeAllListeners('pty:exit')
    ipcRenderer.on('pty:exit', (_event, paneId) => callback(paneId))
  },
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('pty:data')
    ipcRenderer.removeAllListeners('pty:exit')
  }
})

contextBridge.exposeInMainWorld('session', {
  load: () => ipcRenderer.invoke('session:load'),
  save: (data: unknown) => ipcRenderer.invoke('session:save', data)
})

contextBridge.exposeInMainWorld('accounts', {
  list: (aiType: string) => ipcRenderer.invoke('accounts:list', aiType),
  save: (aiType: string, name: string) => ipcRenderer.invoke('accounts:save', aiType, name),
  delete: (aiType: string, name: string) => ipcRenderer.invoke('accounts:delete', aiType, name),
  getDir: (aiType: string, name: string) => ipcRenderer.invoke('accounts:getDir', aiType, name),
  detachConfig: (aiType: string, name: string) => ipcRenderer.invoke('accounts:detachConfig', aiType, name)
})

contextBridge.exposeInMainWorld('workspaces', {
  list: () => ipcRenderer.invoke('workspace:list'),
  save: (ws: unknown) => ipcRenderer.invoke('workspace:save', ws),
  delete: (id: string) => ipcRenderer.invoke('workspace:delete', id),
  exportToFile: (ws: unknown) => ipcRenderer.invoke('workspace:export', ws),
  importFromFile: () => ipcRenderer.invoke('workspace:import'),
})

contextBridge.exposeInMainWorld('platform', {
  isWin: process.platform === 'win32',
  isMac: process.platform === 'darwin',
  isLinux: process.platform === 'linux',
})

contextBridge.exposeInMainWorld('appFlags', {
  e2eBypass: process.env.RAVEN_E2E === '1',
})

contextBridge.exposeInMainWorld('windowControls', {
  send: (action: 'minimize' | 'maximize' | 'close') =>
    ipcRenderer.send(`window:${action}`),
  onShown: (callback: () => void) => {
    ipcRenderer.removeAllListeners('window:shown')
    ipcRenderer.on('window:shown', () => callback())
  },
})

contextBridge.exposeInMainWorld('updater', {
  onStatus: (cb: (status: 'downloading' | 'ready' | 'error', msg?: string) => void) => {
    ipcRenderer.removeAllListeners('updater:status')
    ipcRenderer.on('updater:status', (_event, status, msg) => cb(status, msg))
  },
  install: () => ipcRenderer.send('updater:install'),
  checkForUpdates: () => ipcRenderer.invoke('updater:checkForUpdates'),
})

contextBridge.exposeInMainWorld('mcp', {
  read: (filePath: string) => ipcRenderer.invoke('mcp:read', filePath),
  write: (filePath: string, servers: unknown) => ipcRenderer.invoke('mcp:write', filePath, servers),
  globalPath: () => ipcRenderer.invoke('mcp:globalPath'),
})

contextBridge.exposeInMainWorld('git', {
  info: (repoPath: string) => ipcRenderer.invoke('git:info', repoPath),
  status: (repoPath: string) => ipcRenderer.invoke('git:status', repoPath),
  clone: (
    cloneUrl: string,
    repoName: string,
    parentDir?: string,
    auth?: { provider: 'github' | 'gitlab'; token: string | null },
  ) => ipcRenderer.invoke('git:clone', cloneUrl, repoName, parentDir, auth),
  pushBranch: (worktreePath: string) => ipcRenderer.invoke('git:pushBranch', worktreePath),
  listBranches: (repoPath: string) => ipcRenderer.invoke('git:listBranches', repoPath),
  pickRepoFolder: (expectedRemote?: string) => ipcRenderer.invoke('dialog:pickRepoFolder', expectedRemote),
  getRemoteUrl: (folder: string) => ipcRenderer.invoke('git:getRemoteUrl', folder),
  shortstat: (worktreePath: string, base?: string) =>
    ipcRenderer.invoke('git:shortstat', worktreePath, base),
  findPRForBranch: (
    repoPath: string,
    branch: string,
    tokens?: { github?: string | null; gitlab?: string | null },
  ) => ipcRenderer.invoke('git:findPRForBranch', repoPath, branch, tokens),
  listUntrackedEnvFiles: (repoPath: string) =>
    ipcRenderer.invoke('git:listUntrackedEnvFiles', repoPath),
})

contextBridge.exposeInMainWorld('pathUtils', {
  exists: (p: string) => ipcRenderer.invoke('path:exists', p),
})

contextBridge.exposeInMainWorld('cli', {
  check: (cmd: string) => ipcRenderer.invoke('cli:check', cmd),
  install: (aiType: string) => ipcRenderer.invoke('cli:install', aiType),
  cancelInstall: (aiType: string) => ipcRenderer.invoke('cli:install:cancel', aiType),
  onInstallProgress: (cb: (data: { aiType: string; line: string }) => void) => {
    const handler = (_event: unknown, data: { aiType: string; line: string }) => cb(data)
    ipcRenderer.on('cli:install:progress', handler)
    return () => ipcRenderer.removeListener('cli:install:progress', handler)
  },
})

contextBridge.exposeInMainWorld('shells', {
  detect: () => ipcRenderer.invoke('shells:detect'),
})

contextBridge.exposeInMainWorld('settings', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (data: unknown) => ipcRenderer.invoke('settings:set', data),
})

contextBridge.exposeInMainWorld('speech', {
  check: () => ipcRenderer.invoke('speech:check'),
  transcribe: (audio: Uint8Array, language?: string) => ipcRenderer.invoke('speech:transcribe', audio, language),
  onStatus: (cb: (status: 'loading' | 'ready') => void) => {
    ipcRenderer.removeAllListeners('speech:status')
    ipcRenderer.on('speech:status', (_event, status) => cb(status))
  },
  removeStatusListener: () => {
    ipcRenderer.removeAllListeners('speech:status')
  },
})

contextBridge.exposeInMainWorld('nestUtils', {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
})

contextBridge.exposeInMainWorld('tempImages', {
  save: (base64: string) => ipcRenderer.invoke('tempImages:save', base64),
  copyToTemp: (srcPath: string, index: number) => ipcRenderer.invoke('tempImages:copyToTemp', srcPath, index),
  writeImageToClipboard: (filePath: string) => ipcRenderer.invoke('clipboard:writeImage', filePath),
  cleanup: (paths: string[]) => ipcRenderer.invoke('tempImages:cleanup', paths),
})

contextBridge.exposeInMainWorld('electronShell', {
  openExternal: (url: string) => ipcRenderer.send('shell:openExternal', url),
  onDeepLink: (cb: (url: string) => void) => {
    ipcRenderer.removeAllListeners('auth:deeplink')
    ipcRenderer.on('auth:deeplink', (_event, url) => cb(url))
  },
  consumePendingDeepLink: (): Promise<string | null> => ipcRenderer.invoke('deeplink:consume'),
})

contextBridge.exposeInMainWorld('safeStorage', {
  encrypt: (key: string, value: string) => ipcRenderer.invoke('safeStorage:encrypt', value).then((encrypted: string | null) => {
    if (encrypted) localStorage.setItem(key, encrypted)
  }),
  decrypt: (key: string) => {
    const encrypted = localStorage.getItem(key)
    if (!encrypted) return Promise.resolve(null)
    return ipcRenderer.invoke('safeStorage:decrypt', encrypted)
  },
})

contextBridge.exposeInMainWorld('keybinds', {
  onTabCycle: (cb: (shift: boolean) => void) => {
    ipcRenderer.removeAllListeners('keybind:tab-cycle')
    ipcRenderer.on('keybind:tab-cycle', (_event, payload: { shift: boolean }) => cb(payload.shift))
  },
  removeTabCycleListener: () => {
    ipcRenderer.removeAllListeners('keybind:tab-cycle')
  },
})

contextBridge.exposeInMainWorld('github', {
  openOAuth: () => ipcRenderer.invoke('github:open-oauth'),
  onOAuthCode: (cb: (code: string) => void) => {
    const handler = (_e: IpcRendererEvent, code: string) => cb(code)
    ipcRenderer.on('github-oauth-code', handler)
    return () => ipcRenderer.removeListener('github-oauth-code', handler)
  },
  removeOAuthListener: () => ipcRenderer.removeAllListeners('github-oauth-code'),
})

contextBridge.exposeInMainWorld('gitlab', {
  openOAuth: () => ipcRenderer.invoke('gitlab:open-oauth'),
  onOAuthCode: (cb: (code: string) => void) => {
    const handler = (_e: IpcRendererEvent, code: string) => cb(code)
    ipcRenderer.on('gitlab-oauth-code', handler)
    return () => ipcRenderer.removeListener('gitlab-oauth-code', handler)
  },
  removeOAuthListener: () => ipcRenderer.removeAllListeners('gitlab-oauth-code'),
})

contextBridge.exposeInMainWorld('plugins', {
  list: () => ipcRenderer.invoke('plugins:list'),
  save: (p: unknown) => ipcRenderer.invoke('plugins:save', p),
  delete: (id: string) => ipcRenderer.invoke('plugins:delete', id),
})
contextBridge.exposeInMainWorld('pluginCreds', {
  set: (id: string, token: string) => ipcRenderer.invoke('pluginCreds:set', id, token),
  has: (id: string) => ipcRenderer.invoke('pluginCreds:has', id),
  delete: (id: string) => ipcRenderer.invoke('pluginCreds:delete', id),
})
contextBridge.exposeInMainWorld('pluginActions', {
  run: (id: string, actionId: string, params: unknown) =>
    ipcRenderer.invoke('pluginActions:run', id, actionId, params),
})
contextBridge.exposeInMainWorld('slack', {
  openOAuth: () => ipcRenderer.invoke('slack:open-oauth'),
  // Antes no devolvía unsubscribe y por eso apilaba listeners entre reintentos
  // de Connect (mismo bug que había en github/gitlab). Mirror del patrón de
  // arriba: devuelve la función de unsubscribe.
  onOAuthCode: (cb: (code: string) => void) => {
    const handler = (_e: IpcRendererEvent, code: string) => cb(code)
    ipcRenderer.on('slack-oauth-code', handler)
    return () => ipcRenderer.removeListener('slack-oauth-code', handler)
  },
  removeOAuthListener: () => ipcRenderer.removeAllListeners('slack-oauth-code'),
  exchangeCode: (code: string) => ipcRenderer.invoke('slack:exchange-code', code),
})
contextBridge.exposeInMainWorld('pluginPanels', {
  call: (pluginId: string, method: string, args: unknown[]) =>
    ipcRenderer.invoke('plugins:panel:call', pluginId, method, args),
})
contextBridge.exposeInMainWorld('tickets', {
  list: (pluginId: string) => ipcRenderer.invoke('tickets:list', pluginId),
  branchName: (user: string, key: string, title: string) =>
    ipcRenderer.invoke('tickets:branchName', user, key, title),
  startWork: (args: { pluginId: string; ticket: unknown; branch: string; worktreePath: string }) =>
    ipcRenderer.invoke('tickets:startWork', args),
  tracked: () => ipcRenderer.invoke('tickets:tracked'),
})

contextBridge.exposeInMainWorld('recipes', {
  list: () => ipcRenderer.invoke('recipes:list'),
})

contextBridge.exposeInMainWorld('automations', {
  list: () => ipcRenderer.invoke('automations:list'),
  create: (input: unknown) => ipcRenderer.invoke('automations:create', input),
  update: (id: string, patch: unknown) => ipcRenderer.invoke('automations:update', id, patch),
  delete: (id: string) => ipcRenderer.invoke('automations:delete', id),
})

contextBridge.exposeInMainWorld('signals', {
  list: () => ipcRenderer.invoke('signals:list'),
  fixCiPrompt: (repoPath: string) => ipcRenderer.invoke('signals:fixCiPrompt', repoPath),
  onUpdate: (cb: () => void) => {
    const h = () => cb()
    ipcRenderer.on('signals:update', h)
    return () => ipcRenderer.removeListener('signals:update', h)
  },
})

// Hub Activity rail: `list()` reads the ring buffer for the initial paint;
// `onAppend` is the live push, one call per DomainEvent emitted on the bus
// (same push pattern as `signals:update`/`slack:mention`).
contextBridge.exposeInMainWorld('activity', {
  list: () => ipcRenderer.invoke('activity:list'),
  onAppend: (cb: (entry: { ev: unknown; ts: number }) => void) => {
    const h = (_e: IpcRendererEvent, entry: { ev: unknown; ts: number }) => cb(entry)
    ipcRenderer.on('activity:append', h)
    return () => ipcRenderer.removeListener('activity:append', h)
  },
})

// H7 — @Nest desde Slack (Socket Mode). El main empuja menciones/acciones por
// IPC push (patrón `signals:update`); postThread invoca el bot token main-side.
contextBridge.exposeInMainWorld('slackMentions', {
  onMention: (cb: (m: { channel: string; threadTs: string; user: string; text: string }) => void) => {
    const h = (_e: IpcRendererEvent, m: { channel: string; threadTs: string; user: string; text: string }) => cb(m)
    ipcRenderer.on('slack:mention', h)
    return () => ipcRenderer.removeListener('slack:mention', h)
  },
  onAction: (cb: (a: { actionId: string; value?: string; channel: string; threadTs?: string; user: string }) => void) => {
    const h = (_e: IpcRendererEvent, a: { actionId: string; value?: string; channel: string; threadTs?: string; user: string }) => cb(a)
    ipcRenderer.on('slack:action', h)
    return () => ipcRenderer.removeListener('slack:action', h)
  },
  postThread: (args: { channel: string; threadTs: string; text: string }) =>
    ipcRenderer.invoke('slack:postThread', args),
})

contextBridge.exposeInMainWorld('notion', {
  specToWorktree: (pageId: string, worktreePath: string) =>
    ipcRenderer.invoke('notion:specToWorktree', { pageId, worktreePath }),
})

contextBridge.exposeInMainWorld('gcal', {
  openOAuth: () => ipcRenderer.invoke('gcal:openOAuth'),
  listEvents: (timeMin: string, timeMax: string) =>
    ipcRenderer.invoke('gcal:listEvents', timeMin, timeMax),
  startSession: (args: { title: string; context: string; worktreePath: string }) =>
    ipcRenderer.invoke('gcal:startSession', args),
})

contextBridge.exposeInMainWorld('worktree', {
  list: (repoPath: string) => ipcRenderer.invoke('worktree:list', repoPath),
  create: (opts: unknown) => ipcRenderer.invoke('worktree:create', opts),
  remove: (worktreePath: string) => ipcRenderer.invoke('worktree:remove', worktreePath),
  get: (worktreePath: string) => ipcRenderer.invoke('worktree:get', worktreePath),
  setPreset: (worktreePath: string, presetId: string | null) =>
    ipcRenderer.invoke('worktree:setPreset', worktreePath, presetId),
  copyFiles: (srcRepoPath: string, dstWorktreePath: string, files: string[]) =>
    ipcRenderer.invoke('worktree:copyFiles', srcRepoPath, dstWorktreePath, files),
  listAll: () => ipcRenderer.invoke('worktree:listAll'),
})

contextBridge.exposeInMainWorld('port', {
  scan: (pid: number) => ipcRenderer.invoke('port:scan', pid),
  listAll: () => ipcRenderer.invoke('ports:listAll'),
  listForWorkspace: (opts: { repoPath?: string; repoPaths?: string[]; paneIds?: string[] }) =>
    ipcRenderer.invoke('ports:listForWorkspace', opts),
  byPane: (opts: { panes: { paneId: string; repoPath?: string | null }[] }) =>
    ipcRenderer.invoke('ports:byPane', opts),
})

contextBridge.exposeInMainWorld('diff', {
  get: (worktreePath: string, base?: string) => ipcRenderer.invoke('diff:get', worktreePath, base),
})

contextBridge.exposeInMainWorld('ide', {
  detect: (force?: boolean) => ipcRenderer.invoke('ide:detect', force),
  open: (binPath: string, worktreePath: string) => ipcRenderer.invoke('ide:open', binPath, worktreePath),
  clearCache: () => ipcRenderer.invoke('ide:clearCache'),
})

contextBridge.exposeInMainWorld('spotlight', {
  start: (worktreePath: string) => ipcRenderer.invoke('spotlight:start', worktreePath),
  stop: () => ipcRenderer.invoke('spotlight:stop'),
  status: () => ipcRenderer.invoke('spotlight:status'),
  onStatus: (cb: (status: { active: boolean; worktreePath?: string; events?: number }) => void) => {
    ipcRenderer.removeAllListeners('spotlight:status')
    ipcRenderer.on('spotlight:status', (_e, s) => cb(s))
  },
  onWarning: (cb: (msg: string) => void) => {
    ipcRenderer.removeAllListeners('spotlight:warning')
    ipcRenderer.on('spotlight:warning', (_e, msg) => cb(msg))
  },
  removeListeners: () => {
    ipcRenderer.removeAllListeners('spotlight:status')
    ipcRenderer.removeAllListeners('spotlight:warning')
  },
})

contextBridge.exposeInMainWorld('benchmark', {
  start: (cellId: string, pid: number, mode: string) => ipcRenderer.invoke('benchmark:start', cellId, pid, mode),
  stop: (cellId: string) => ipcRenderer.invoke('benchmark:stop', cellId),
  get: (cellId: string) => ipcRenderer.invoke('benchmark:get', cellId),
  list: () => ipcRenderer.invoke('benchmark:list'),
  setMode: (cellId: string, mode: string) => ipcRenderer.invoke('benchmark:setMode', cellId, mode),
})

contextBridge.exposeInMainWorld('browser', {
  create: (paneId: string, url: string, partition: string) =>
    ipcRenderer.invoke('browser:create', paneId, url, partition),
  reposition: (paneId: string, bounds: unknown) =>
    ipcRenderer.invoke('browser:reposition', paneId, bounds),
  navigate: (paneId: string, url: string) =>
    ipcRenderer.invoke('browser:navigate', paneId, url),
  back: (paneId: string) => ipcRenderer.invoke('browser:back', paneId),
  forward: (paneId: string) => ipcRenderer.invoke('browser:forward', paneId),
  reload: (paneId: string) => ipcRenderer.invoke('browser:reload', paneId),
  destroy: (paneId: string) => ipcRenderer.invoke('browser:destroy', paneId),
  onNavigated: (cb: (paneId: string, url: string) => void) => {
    const handler = (_e: IpcRendererEvent, paneId: string, url: string) => cb(paneId, url)
    ipcRenderer.on('browser:navigated', handler)
    return () => ipcRenderer.removeListener('browser:navigated', handler)
  },
  removeListeners: () => ipcRenderer.removeAllListeners('browser:navigated'),
})

contextBridge.exposeInMainWorld('metrics', {
  snapshot: (panes: Array<{ paneId: string; repoPath: string | undefined; label: string; note?: string; workspaceName?: string; aiColor?: string; aiType?: string }>) =>
    ipcRenderer.invoke('metrics:snapshot', panes),
  refreshDisk: (worktreePaths: string[]) =>
    ipcRenderer.invoke('metrics:refreshDisk', worktreePaths),
  killPid: (pid: number) => ipcRenderer.invoke('metrics:killPid', pid),
  portsByPids: (pids: number[]) => ipcRenderer.invoke('metrics:portsByPids', pids),
})

contextBridge.exposeInMainWorld('preset', {
  list: (repoPath: string) => ipcRenderer.invoke('preset:list', repoPath),
  save: (repoPath: string, preset: unknown) => ipcRenderer.invoke('preset:save', repoPath, preset),
  delete: (repoPath: string, presetId: string) =>
    ipcRenderer.invoke('preset:delete', repoPath, presetId),
  apply: (worktreePath: string, presetId: string) =>
    ipcRenderer.invoke('preset:apply', worktreePath, presetId),
  cancel: (worktreePath: string) => ipcRenderer.invoke('preset:cancel', worktreePath),
  onSetupProgress: (cb: (worktreePath: string, line: string) => void) => {
    ipcRenderer.removeAllListeners('preset:setupProgress')
    ipcRenderer.on('preset:setupProgress', (_e, wt, line) => cb(wt, line))
  },
  onSetupState: (cb: (worktreePath: string, state: string) => void) => {
    ipcRenderer.removeAllListeners('preset:setupState')
    ipcRenderer.on('preset:setupState', (_e, wt, state) => cb(wt, state))
  },
  removeListeners: () => {
    ipcRenderer.removeAllListeners('preset:setupProgress')
    ipcRenderer.removeAllListeners('preset:setupState')
  },
})
