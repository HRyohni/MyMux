import { useState } from 'react'
import { Plus, MessageSquare, X, Folder, Columns2, Rows2, LayoutGrid, PanelLeftClose, PanelLeftOpen, Volume2, VolumeX } from 'lucide-react'
import { useStore, leaves, selectActiveGroup, groupOfSession } from '../store'

function basename(p: string) {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || p
}

function GroupTab({ id, name, index, active, closable }: { id: string; name: string; index: number; active: boolean; closable: boolean }) {
  const switchGroup = useStore((s) => s.switchGroup)
  const removeGroup = useStore((s) => s.removeGroup)
  const renameGroup = useStore((s) => s.renameGroup)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)

  const commit = () => { setEditing(false); renameGroup(id, draft) }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(name); setEditing(false) } }}
        className="h-7 w-24 px-2 rounded-md bg-bg border border-accent text-[12px] outline-none"
      />
    )
  }
  return (
    <div
      onClick={() => switchGroup(id)}
      onDoubleClick={() => { setDraft(name); setEditing(true) }}
      title={`${name} (Ctrl+${index + 1}) · dvoklik za preimenovanje`}
      className={`group/tab relative flex items-center gap-1 h-7 pl-2 pr-1.5 rounded-md text-[12px] cursor-pointer select-none whitespace-nowrap transition
        ${active ? 'bg-bg-elev2 text-fg border border-border-strong' : 'text-fg-muted hover:text-fg hover:bg-bg-elev2/60 border border-transparent'}`}
    >
      <span className="text-[10px] text-fg-faint">{index + 1}</span>
      <span className="max-w-[88px] truncate">{name}</span>
      {closable && (
        <button
          onClick={(e) => { e.stopPropagation(); removeGroup(id) }}
          title="Zatvori grupu (Ctrl+Shift+W)"
          className="w-4 h-4 rounded flex items-center justify-center text-fg-faint hover:text-danger opacity-0 group-hover/tab:opacity-100"
        >
          <X size={11} />
        </button>
      )}
    </div>
  )
}

export default function Sidebar() {
  const order = useStore((s) => s.order)
  const sessions = useStore((s) => s.sessions)
  const groups = useStore((s) => s.groups)
  const activeGroup = useStore((s) => s.activeGroup)
  const group = useStore(selectActiveGroup)
  const addGroup = useStore((s) => s.addGroup)
  const showSession = useStore((s) => s.showSession)
  const setPaneSession = useStore((s) => s.setPaneSession)
  const splitPane = useStore((s) => s.splitPane)
  const removeSession = useStore((s) => s.removeSession)
  const collapsed = useStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const switchGroup = useStore((s) => s.switchGroup)
  const soundOn = useStore((s) => s.soundOn)
  const toggleSound = useStore((s) => s.toggleSound)
  const soundTitle = soundOn ? 'Zvuk kad Claude završi: uključen' : 'Zvuk kad Claude završi: isključen'

  const focusedPane = group.focusedPane
  const visible = new Map(leaves(group.layout).filter((l) => l.sessionId).map((l) => [l.sessionId as string, l.id]))
  const focusedLeaf = leaves(group.layout).find((l) => l.id === focusedPane)
  const welcomeActive = !!focusedLeaf && !focusedLeaf.sessionId

  const close = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    await window.aimux.closeSession(id)
    removeSession(id)
  }

  const iconBtn = 'w-7 h-7 rounded-md flex items-center justify-center text-fg-muted hover:text-fg hover:bg-bg-elev2'

  if (collapsed) {
    const waiting = Object.values(sessions).some((s) => s.pending.length > 0)
    const running = Object.values(sessions).some((s) => s.meta.running)
    return (
      <aside className="w-11 shrink-0 flex flex-col items-center bg-bg-elev border-r border-border">
        <div className="h-10 flex items-center">
          <button onClick={toggleSidebar} title="Prikaži bočnu traku (Ctrl+Shift+B)" className={iconBtn}><PanelLeftOpen size={16} /></button>
        </div>
        <div className="flex flex-col items-center gap-1 pt-1">
          {groups.map((g, i) => (
            <button key={g.id} onClick={() => switchGroup(g.id)} title={`${g.name} (Ctrl+${i + 1})`}
              className={`w-7 h-7 rounded-md text-[12px] flex items-center justify-center border transition
                ${g.id === activeGroup ? 'bg-bg-elev2 text-fg border-border-strong' : 'text-fg-muted hover:text-fg hover:bg-bg-elev2/60 border-transparent'}`}>
              {i + 1}
            </button>
          ))}
          <button onClick={addGroup} title="Nova grupa (Ctrl+T)" className={iconBtn}><Plus size={14} /></button>
        </div>
        <div className="drag flex-1 w-full" />
        <div className="pb-3 flex flex-col items-center gap-2">
          <button onClick={toggleSound} title={soundTitle} className={iconBtn}>{soundOn ? <Volume2 size={15} /> : <VolumeX size={15} />}</button>
          {waiting && <span title="Razgovor čeka odobrenje" className="w-2 h-2 rounded-full bg-warn pulse" />}
          {running && <span title="Claude radi" className="w-3.5 h-3.5 rounded-full border-2 border-accent border-t-transparent animate-spin" />}
        </div>
      </aside>
    )
  }

  return (
    <aside className="w-64 shrink-0 flex flex-col bg-bg-elev border-r border-border">
      <div className="drag h-10 flex items-center pl-4 pr-2 text-[13px] font-semibold tracking-wide text-fg-muted select-none">
        <span className="text-accent mr-1.5">●</span> aimux
        <button onClick={toggleSound} title={soundTitle} className={`no-drag ml-auto ${iconBtn}`}>{soundOn ? <Volume2 size={15} /> : <VolumeX size={15} />}</button>
        <button onClick={toggleSidebar} title="Sakrij bočnu traku (Ctrl+Shift+B)" className={`no-drag ${iconBtn}`}><PanelLeftClose size={16} /></button>
      </div>

      <div className="px-3 pb-2">
        <div className="flex items-center gap-1 text-[10.5px] uppercase tracking-wider text-fg-faint mb-1.5">
          <LayoutGrid size={11} /> Grupe
        </div>
        <div className="flex flex-wrap gap-1">
          {groups.map((g, i) => (
            <GroupTab key={g.id} id={g.id} name={g.name} index={i} active={g.id === activeGroup} closable={groups.length > 1} />
          ))}
          <button onClick={addGroup} title="Nova grupa (Ctrl+T)" className="h-7 w-7 rounded-md flex items-center justify-center text-fg-muted hover:text-fg hover:bg-bg-elev2 border border-transparent">
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="px-3 pb-2 flex gap-1.5 border-t border-border pt-2">
        <button
          onClick={() => setPaneSession(focusedPane, null)}
          title="Novi razgovor (Ctrl+N)"
          className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] border transition
            ${welcomeActive ? 'bg-bg-elev2 border-border-strong text-fg' : 'border-border text-fg-muted hover:text-fg hover:bg-bg-elev2'}`}
        >
          <Plus size={15} /> Novi razgovor
        </button>
        <button onClick={() => splitPane(focusedPane, 'horizontal')} title="Podijeli desno (Ctrl+\)" className={`${iconBtn} border border-border`}><Columns2 size={15} /></button>
        <button onClick={() => splitPane(focusedPane, 'vertical')} title="Podijeli dolje (Ctrl+Shift+\)" className={`${iconBtn} border border-border`}><Rows2 size={15} /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {order.length === 0 && (
          <div className="px-3 py-6 text-xs text-fg-faint text-center">Nema aktivnih razgovora</div>
        )}
        {order.map((id) => {
          const s = sessions[id]
          if (!s) return null
          const paneId = visible.get(id)
          const active = paneId === focusedPane
          const otherGroup = paneId ? null : groupOfSession(groups, id)
          return (
            <div
              key={id}
              onClick={() => showSession(id)}
              className={`group relative flex items-start gap-2 px-3 py-2 rounded-lg cursor-pointer transition
                ${active ? 'bg-bg-elev2 text-fg' : paneId ? 'bg-bg-elev2/50 text-fg' : 'text-fg-muted hover:bg-bg-elev2/60 hover:text-fg'}`}
            >
              <div className="mt-0.5 shrink-0">
                {s.meta.running
                  ? <span className="block w-3.5 h-3.5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                  : <MessageSquare size={14} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] leading-tight">{s.meta.title}</div>
                <div className="truncate text-[11px] text-fg-faint flex items-center gap-1 mt-0.5">
                  <Folder size={10} /> {basename(s.meta.cwd)}
                  {otherGroup && <span className="ml-1 text-fg-faint">· {otherGroup.name}</span>}
                  {s.pending.length > 0 && <span className="ml-1 text-warn">● čeka odobrenje</span>}
                  {s.meta.ended && <span className="ml-1">· završeno</span>}
                </div>
              </div>
              <button
                onClick={(e) => close(e, id)}
                title="Zatvori razgovor"
                className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 text-fg-faint hover:text-danger transition"
              >
                <X size={13} />
              </button>
            </div>
          )
        })}
      </div>

      <div className="px-4 py-2 text-[10.5px] text-fg-faint border-t border-border leading-relaxed">
        Ctrl+T nova grupa · Ctrl+1-9 grupa · Ctrl+Tab sljedeća · Ctrl+N novi · Ctrl+\ split · Ctrl+W zatvori panel · Ctrl+B browser · Ctrl+Shift+B sakrij traku
      </div>
    </aside>
  )
}
