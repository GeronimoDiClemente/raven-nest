import { test } from '@playwright/test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { launchHarness, teardown, expect } from './helpers/harness'

// A fairly typical .tmux.conf: prefix change, mouse, history-limit, vim-style
// pane navigation, splits, window management, kill bindings, zoom, and TPM
// plugins (which must be reported as "not imported", never executed).
const TMUX_CONF = `# ~/.tmux.conf — typical setup
set -g prefix C-a
unbind C-b
set -g mouse on
set -g history-limit 50000
setw -g mode-keys vi

# vim-style pane navigation, no prefix
bind -n M-h select-pane -L
bind -n M-j select-pane -D
bind -n M-k select-pane -U
bind -n M-l select-pane -R

# splits
bind | split-window -h
bind - split-window -v

# window management
bind c new-window
bind n next-window
bind p previous-window

# kill without confirmation
bind x kill-pane
bind & kill-window

# zoom the current pane
bind z resize-pane -Z

# plugins via TPM — should be reported as "not imported", never run
set -g @plugin 'tmux-plugins/tpm'
set -g @plugin 'tmux-plugins/tmux-resurrect'
run '~/.tmux/plugins/tpm/tpm'
`

test('tmux import: read conf → preview → apply → binding takes effect live', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page, app, homeDir } = h
  try {
    // Write the conf and make the native "open file" dialog return it, so the
    // whole IPC → read → parse → preview → apply chain runs for real.
    const confPath = join(homeDir, '.tmux.conf')
    writeFileSync(confPath, TMUX_CONF)
    await app.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] })
    }, confPath)

    // Settings → keybinds is the default tab → Import from tmux.
    await page.locator('button.titlebar-btn[title="Settings"]').click()
    await page.getByRole('button', { name: /Import from tmux/i }).click()

    // The preview modal parsed the conf.
    const modal = page.locator('.tmux-modal')
    await expect(modal).toBeVisible({ timeout: 10_000 })
    const rowCount = await modal.locator('.tmux-row').count()
    expect(rowCount).toBeGreaterThanOrEqual(10)
    await expect(modal.locator('.tmux-action', { hasText: 'New pane' }).first()).toBeVisible()
    await expect(modal.locator('.tmux-action', { hasText: 'Close pane' }).first()).toBeVisible()
    // history-limit maps directly to Nest's scrollback setting.
    await expect(modal.locator('.tmux-badge.direct').first()).toContainText('scrollback')
    // TPM plugin lines and run-shell are surfaced as not-imported, never executed.
    await expect(modal.locator('.tmux-unsupported')).toBeVisible()

    // Apply the import.
    await modal.locator('.tmux-apply').click()
    await expect(modal).toBeHidden()

    // Close Settings.
    await page.keyboard.press('Escape')
    await expect(page.locator('.sp-modal')).toHaveCount(0)
    await page.waitForTimeout(250) // let the cross-instance settings sync land

    // `bind c new-window` maps New pane to Ctrl+Alt+c (last of the newPane binds
    // wins). Pressing it now opens the Choose-AI dialog — proving the imported
    // binding is live this session, not just persisted for next launch.
    await page.keyboard.press('Control+Alt+c')
    await expect(page.getByText('Choose AI')).toBeVisible({ timeout: 5_000 })

    // And a terminal opened afterwards bakes in the imported scrollback:
    // `set -g history-limit 50000` → the new xterm's scrollback.
    await page.locator('.ai-card').filter({ hasText: 'Terminal' }).first().click()
    try {
      await page.locator('.ai-card').filter({ hasText: 'Default' }).first().click({ timeout: 5_000 })
    } catch { /* no shell sub-step on this platform */ }
    await expect(page.locator('.terminal-container[data-scrollback="50000"]')).toBeVisible({ timeout: 15_000 })
  } finally {
    await teardown(h)
  }
})
