import { useState } from "react"
import { List, ListRow } from "@/components/ui/list"
import { StatusBadge } from "@/components/ui/status-badge"
import { Callout } from "@/components/ui/callout"
import { EmptyState } from "@/components/ui/empty-state"
import { Segmented } from "@/components/ui/segmented"
import { NavRow } from "@/components/ui/nav-row"
import { Kbd } from "@/components/ui/kbd"
import { Button } from "@/components/ui/button"

const BTN_SM = "h-auto min-h-[26px] rounded-sm border-border-strong px-[9px] py-[3px] text-fs-xs!"

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section data-testid={`ui-preview-${id}`} className="flex flex-col gap-3">
      <h2 className="text-fs-lg font-medium text-foreground">{title}</h2>
      {children}
    </section>
  )
}

export default function UiPreview() {
  const [mode, setMode] = useState("sessions")
  return (
    <div
      data-testid="ui-preview"
      className="fixed inset-0 z-[9999] flex flex-col gap-8 overflow-y-auto bg-background p-8 text-fs leading-[1.45] text-foreground"
    >
      <Section id="list" title="List">
        <List aria-label="Sessions">
          <ListRow selected onClick={() => {}}>refactor-sidebar</ListRow>
          <ListRow onClick={() => {}}>fix-terminal-resize</ListRow>
          <ListRow>memory-sync (read only)</ListRow>
        </List>
      </Section>

      <Section id="status-badge" title="StatusBadge">
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone="ok">Running</StatusBadge>
          <StatusBadge tone="warn">Needs input</StatusBadge>
          <StatusBadge tone="destructive">Failed</StatusBadge>
          <StatusBadge tone="info">Syncing</StatusBadge>
          <StatusBadge tone="muted">Idle</StatusBadge>
        </div>
      </Section>

      <Section id="callout" title="Callout">
        <div className="flex flex-col gap-2">
          <Callout tone="warn" title="Sync is paused" action={<Button type="button" variant="outline" size="sm" className={BTN_SM}>Resume</Button>}>
            Another device holds the lock for this account.
          </Callout>
          <Callout tone="destructive" title="Push failed">The server rejected the last change.</Callout>
          <Callout tone="info" title="New version available" />
        </div>
      </Section>

      <Section id="empty-state" title="EmptyState">
        <EmptyState
          title="No sessions yet"
          description="Start an agent in this repo to see it here."
          action={<Button type="button" variant="outline" size="sm" className={BTN_SM}>New session</Button>}
        />
      </Section>

      <Section id="segmented" title="Segmented">
        <Segmented
          aria-label="View mode"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: "sessions", label: "Sessions" },
            { value: "terminal", label: "Terminal" },
            { value: "visual", label: "Visual" },
          ]}
        />
      </Section>

      <Section id="nav-row" title="NavRow">
        <div className="flex w-56 flex-col gap-0.5">
          <NavRow selected count={12}>Sessions</NavRow>
          <NavRow count={3} countTone="warn">Needs attention</NavRow>
          <NavRow>Memories</NavRow>
        </div>
      </Section>

      <Section id="kbd" title="Kbd">
        <div className="flex items-center gap-2 text-muted-foreground">
          Open the command palette with <Kbd>Ctrl</Kbd> <Kbd>K</Kbd>
        </div>
      </Section>
    </div>
  )
}
