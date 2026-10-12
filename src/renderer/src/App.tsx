import { useEffect } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useStore, leaves, selectLayout, selectFocusedPane, selectActiveGroup, type Layout } from './store'
import { useSettings, initSettings } from './settings'
import { comboOf, actionFor, type ActionId } from './keys'
import { openSession, restoreWorkspace } from './actions'
import Sidebar from './components/Sidebar'
import Chat from './components/Chat'
import Welcome from './components/Welcome'
import WindowControls from './components/WindowControls'
import SettingsModal from './components/SettingsModal'
import OverviewModal from './components/OverviewModal'
import { savedSizes, saveSizes } from './sizes'

const SESSION_DRAG = 'application/x-aimux-session'
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
        // A conversation dragged from the sidebar lands in the pane it is dropped on.
        onDragOver={(e) => { if (e.dataTransfer.types.includes(SESSION_DRAG)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData(SESSION_DRAG)
          if (id) { e.preventDefault(); useStore.getState().moveSession(id, layout.id) }
        }}
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
    <Group orientation={layout.dir} className="h-full min-h-0" defaultLayout={savedSizes(layout.id)} onLayoutChanged={(sizes) => saveSizes(layout.id, sizes)}>
      <Panel id={layout.a.id} minSize="280px" className="min-w-0 min-h-0"><PaneTree layout={layout.a} /></Panel>
      <Separator className={`${sepClass} bg-border hover:bg-accent/60 data-[resize-handle-active]:bg-accent transition-colors`} />
      <Panel id={layout.b.id} minSize="280px" className="min-w-0 min-h-0"><PaneTree layout={layout.b} /></Panel>
    </Group>
  )
}

/** Runs a keyboard shortcut action against the focused pane. */
function runAction(action: ActionId) {
  const s = useStore.getState()
  const pane = selectFocusedPane(s)
  const sessionId = leaves(selectLayout(s)).find((l) => l.id === pane)?.sessionId
  switch (action) {
    case 'newGroup': return s.addGroup()
    case 'nextGroup': case 'prevGroup': {
      const idx = s.groups.findIndex((g) => g.id === s.activeGroup)
      const next = s.groups[(idx + (action === 'prevGroup' ? -1 : 1) + s.groups.length) % s.groups.length]
      return s.switchGroup(next.id)
    }
    case 'closeGroup': return s.removeGroup(s.activeGroup)
    case 'toggleSidebar': return s.toggleSidebar()
    case 'newChat': return s.setPaneSession(pane, null)
    case 'splitRight': return void s.splitPane(pane, 'horizontal')
    case 'splitDown': return void s.splitPane(pane, 'vertical')
    case 'closePane': return s.closePane(pane)
    case 'toggleBrowser': if (sessionId) s.setBrowserOpen(sessionId, !s.sessions[sessionId]?.browserOpen); return
    case 'find': if (sessionId) s.setFindOpen(sessionId, true); return
    case 'settings': return s.setSettingsOpen(!s.settingsOpen)
    case 'overview': return s.setOverviewOpen(!s.overviewOpen)
  }
}

export default function App() {
  const group = useStore(selectActiveGroup)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const overviewOpen = useStore((s) => s.overviewOpen)

  useEffect(() => {
    initSettings()
    const st = useStore.getState()
    const offs = [
      window.aimux.onMessage((sid, msg) => {
        st.applyMessage(sid, msg)
        if (msg.type === 'result' && useSettings.getState().sound) playDone(msg.is_error)
      }),
      window.aimux.onMeta((meta) => st.applyMeta(meta)),
      window.aimux.onPermission((req) => st.addPermission(req)),
      window.aimux.onPermissionResolved((sid, requestId) => st.resolvePermission(sid, requestId)),
      window.aimux.onElicitation((req) => st.addElicitation(req)),
      window.aimux.onElicitationResolved((sid, requestId) => st.resolveElicitation(sid, requestId)),
      window.aimux.onShowSession((sid) => { if (useStore.getState().sessions[sid]) st.showSession(sid) }),
      window.aimux.onError((sid, err) => st.addInfo(sid, err, 'error')),
      window.aimux.browser.onState((state) => st.applyBrowserState(state)),
      window.aimux.browser.onActivity((sid) => st.setBrowserOpen(sid, true)),
      window.aimux.browser.onDownload((d) => {
        // A download whose page is unknown is shown in the focused conversation.
        const s = useStore.getState()
        const fallback = leaves(selectLayout(s)).find((l) => l.id === selectFocusedPane(s))?.sessionId
        const sessionId = s.sessions[d.sessionId] ? d.sessionId : fallback
        if (sessionId) st.applyDownload({ ...d, sessionId })
      }),
      window.aimux.browser.onShortcut((sid, shortcut) => {
        if (shortcut === 'find') st.setBrowserFindOpen(sid, true)
        else if (shortcut === 'newTab') void window.aimux.browser.newTab(sid)
        else if (shortcut === 'closeTab') {
          const tab = useStore.getState().sessions[sid]?.browser?.activeTab
          if (tab) void window.aimux.browser.closeTab(sid, tab)
        }
      }),
      window.aimux.onDevCommand((cmd) => {
        const s = useStore.getState()
        if (cmd.type === 'resume') void openSession(selectFocusedPane(s), { cwd: cmd.cwd, resume: cmd.sdkSessionId })
        else if (cmd.type === 'split') s.splitPane(selectFocusedPane(s), cmd.dir)
        else if (cmd.type === 'toggleSidebar') s.toggleSidebar()
      }),
    ]
    // The tray icon reports how many conversations wait for the user or are working.
    let last = ''
    offs.push(useStore.subscribe((s) => {
      const all = Object.values(s.sessions)
      const waiting = all.filter((x) => x.pending.length > 0 || x.elicitations.length > 0).length
      const running = all.filter((x) => x.meta.running).length
      if (`${waiting},${running}` === last) return
      last = `${waiting},${running}`
      void window.aimux.window.setActivity(waiting, running)
    }))
    void restoreWorkspace()
    return () => offs.forEach((off) => off())
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const s = useStore.getState()
        const g = s.groups[Number(e.key) - 1]
        if (g) { e.preventDefault(); s.switchGroup(g.id) }
        return
      }
      const action = actionFor(comboOf(e), useSettings.getState().keys)
      if (!action) return
      e.preventDefault()
      runAction(action)
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
      {settingsOpen && <SettingsModal onClose={() => useStore.getState().setSettingsOpen(false)} />}
      {overviewOpen && <OverviewModal onClose={() => useStore.getState().setOverviewOpen(false)} />}
    </div>
  )
}
