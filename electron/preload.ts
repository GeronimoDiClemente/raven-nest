import { contextBridge, ipcRenderer, webUtils } from 'electron'

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

contextBridge.exposeInMainWorld('customCLIs', {
  list: () => ipcRenderer.invoke('customcli:list'),
  save: (cli: unknown) => ipcRenderer.invoke('customcli:save', cli),
  delete: (id: string) => ipcRenderer.invoke('customcli:delete', id),
})

contextBridge.exposeInMainWorld('dialog', {
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
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
  pickRepoFolder: () => ipcRenderer.invoke('dialog:pickRepoFolder'),
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
    ipcRenderer.on('github-oauth-code', (_event, code) => cb(code))
  },
  removeOAuthListener: () => ipcRenderer.removeAllListeners('github-oauth-code'),
})

contextBridge.exposeInMainWorld('gitlab', {
  openOAuth: () => ipcRenderer.invoke('gitlab:open-oauth'),
  onOAuthCode: (cb: (code: string) => void) => {
    ipcRenderer.on('gitlab-oauth-code', (_event, code) => cb(code))
  },
  removeOAuthListener: () => ipcRenderer.removeAllListeners('gitlab-oauth-code'),
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
})

contextBridge.exposeInMainWorld('port', {
  scan: (pid: number) => ipcRenderer.invoke('port:scan', pid),
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
    ipcRenderer.removeAllListeners('browser:navigated')
    ipcRenderer.on('browser:navigated', (_e, paneId, url) => cb(paneId, url))
  },
  removeListeners: () => ipcRenderer.removeAllListeners('browser:navigated'),
})

contextBridge.exposeInMainWorld('metrics', {
  snapshot: (panes: Array<{ paneId: string; repoPath: string | undefined; label: string; note?: string; workspaceName?: string; aiColor?: string }>) =>
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
