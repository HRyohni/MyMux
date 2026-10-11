import { useEffect } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useStore, leaves, selectLayout, selectFocusedPane, selectActiveGroup, type Layout } from './store'
import Sidebar from './components/Sidebar'
import Chat from './components/Chat'
import Welcome, { openSession } from './components/Welcome'
import WindowControls from './components/WindowControls'
import { playDone } from './sound'

function PaneTree({ layout }: { layout: Layout }) {
  const focusedPane = useStore(selectFocusedPane)
  const focusPane = useStore((s) => s.focusPane)
  const multi = useStore((s) => leaves(selectLayout(s)).length > 1)

  if (layout.kind === 'leaf') {
    const focused = layout.id === focusedPane
    return (
      <div
        onMouseDownCapture={() => focusPane(layout.id)}
        className={`h-full min-h-0 flex flex-col bg-bg ${multi ? `border ${focused ? 'border-accent/50' : 'border-border'}` : ''}`}
      >
        {layout.sessionId
          ? <Chat key={layout.sessionId} sessionId={layout.sessionId} paneId={layout.id} />
          : <Welcome key={layout.id} paneId={layout.id} />}
      </div>
    )
  }

  const sepClass = layout.dir === 'horizontal'
    ? 'w-1 cursor-col-resize'
    : 'h-1 cursor-row-resize'
  return (
    <Group orientation={layout.dir} className="h-full min-h-0">
      <Panel id={layout.a.id} minSize="280px" className="min-w-0 min-h-0"><PaneTree layout={layout.a} /></Panel>
      <Separator className={`${sepClass} bg-border hover:bg-accent/60 data-[resize-handle-active]:bg-accent transition-colors`} />
      <Panel id={layout.b.id} minSize="280px" className="min-w-0 min-h-0"><PaneTree layout={layout.b} /></Panel>
    </Group>
  )
}

export default function App() {
  const group = useStore(selectActiveGroup)

  useEffect(() => {
    const st = useStore.getState()
    const offs = [
      window.aimux.onMessage((sid, msg) => {
        st.applyMessage(sid, msg)
        if (msg.type === 'result' && useStore.getState().soundOn) playDone(msg.is_error)
      }),
      window.aimux.onMeta((meta) => st.applyMeta(meta)),
      window.aimux.onPermission((req) => st.addPermission(req)),
      window.aimux.onError((sid, err) => st.addInfo(sid, err, 'error')),
      window.aimux.browser.onState((state) => st.applyBrowserState(state)),
      window.aimux.browser.onActivity((sid) => st.setBrowserOpen(sid, true)),
      window.aimux.onDevCommand((cmd) => {
        const s = useStore.getState()
        if (cmd.type === 'resume') void openSession(selectFocusedPane(s), { cwd: cmd.cwd, resume: cmd.sdkSessionId })
        else if (cmd.type === 'split') s.splitPane(selectFocusedPane(s), cmd.dir)
        else if (cmd.type === 'toggleSidebar') s.toggleSidebar()
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return
      const s = useStore.getState()
      const pane = selectFocusedPane(s)
      const leaf = leaves(selectLayout(s)).find((l) => l.id === pane)
      const key = e.key.toLowerCase()
      if (/^[1-9]$/.test(e.key)) {
        const g = s.groups[Number(e.key) - 1]
        if (g) { e.preventDefault(); s.switchGroup(g.id) }
      }
      else if (key === 't' && !e.shiftKey) { e.preventDefault(); s.addGroup() }
      else if (key === 'tab') {
        e.preventDefault()
        const idx = s.groups.findIndex((g) => g.id === s.activeGroup)
        const next = s.groups[(idx + (e.shiftKey ? -1 : 1) + s.groups.length) % s.groups.length]
        s.switchGroup(next.id)
      }
      else if (key === 'w' && e.shiftKey) { e.preventDefault(); s.removeGroup(s.activeGroup) }
      else if (key === 'n' && !e.shiftKey) { e.preventDefault(); s.setPaneSession(pane, null) }
      else if (key === '\\' && !e.shiftKey) { e.preventDefault(); s.splitPane(pane, 'horizontal') }
      else if (key === '\\' && e.shiftKey) { e.preventDefault(); s.splitPane(pane, 'vertical') }
      else if (key === 'w') { e.preventDefault(); s.closePane(pane) }
      else if (key === 'b' && e.shiftKey) { e.preventDefault(); s.toggleSidebar() }
      else if (key === 'b' && leaf?.sessionId) {
        e.preventDefault()
        s.setBrowserOpen(leaf.sessionId, !s.sessions[leaf.sessionId]?.browserOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-full">
      <WindowControls />
      <Sidebar />
      <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-bg">
        <PaneTree key={group.id} layout={group.layout} />
      </main>
    </div>
  )
}
