import { useEffect } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useStore, leaves, type Layout } from './store'
import Sidebar from './components/Sidebar'
import Chat from './components/Chat'
import Welcome, { openSession } from './components/Welcome'

function PaneTree({ layout }: { layout: Layout }) {
  const focusedPane = useStore((s) => s.focusedPane)
  const focusPane = useStore((s) => s.focusPane)
  const multi = useStore((s) => leaves(s.layout).length > 1)

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
  const layout = useStore((s) => s.layout)

  useEffect(() => {
    const st = useStore.getState()
    const offs = [
      window.aimux.onMessage((sid, msg) => st.applyMessage(sid, msg)),
      window.aimux.onMeta((meta) => st.applyMeta(meta)),
      window.aimux.onPermission((req) => st.addPermission(req)),
      window.aimux.onError((sid, err) => st.addInfo(sid, err, 'error')),
      window.aimux.browser.onState((state) => st.applyBrowserState(state)),
      window.aimux.browser.onActivity((sid) => st.setBrowserOpen(sid, true)),
      window.aimux.onDevCommand((cmd) => {
        const s = useStore.getState()
        if (cmd.type === 'resume') void openSession(s.focusedPane, { cwd: cmd.cwd, resume: cmd.sdkSessionId })
        else if (cmd.type === 'split') s.splitPane(s.focusedPane, cmd.dir)
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return
      const s = useStore.getState()
      const pane = s.focusedPane
      const leaf = leaves(s.layout).find((l) => l.id === pane)
      const key = e.key.toLowerCase()
      if (key === 'n' && !e.shiftKey) { e.preventDefault(); s.setPaneSession(pane, null) }
      else if (key === '\\' && !e.shiftKey) { e.preventDefault(); s.splitPane(pane, 'horizontal') }
      else if (key === '\\' && e.shiftKey) { e.preventDefault(); s.splitPane(pane, 'vertical') }
      else if (key === 'w') { e.preventDefault(); s.closePane(pane) }
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
      <Sidebar />
      <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-bg">
        <PaneTree layout={layout} />
      </main>
    </div>
  )
}
