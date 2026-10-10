import { useEffect, useRef } from 'react'
import { useWindowControlsInset } from '../hooks'
import { Folder, PanelRight, Columns2, Rows2, X } from 'lucide-react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import BrowserPanel from './BrowserPanel'
import { useStore, PERMISSION_MODES, MODELS, leaves, selectLayout } from '../store'
import type { PermissionMode } from '../../../shared/ipc'
import Message from './Message'
import PermissionCard from './PermissionCard'
import Composer from './Composer'

export default function Chat({ sessionId, paneId }: { sessionId: string; paneId: string }) {
  const headerRef = useRef<HTMLElement>(null)
  const controlsInset = useWindowControlsInset(headerRef)
  const session = useStore((s) => s.sessions[sessionId])
  const setBrowserOpen = useStore((s) => s.setBrowserOpen)
  const splitPane = useStore((s) => s.splitPane)
  const closePane = useStore((s) => s.closePane)
  const multi = useStore((s) => leaves(selectLayout(s)).length > 1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)

  const items = session?.items ?? []
  const pending = session?.pending ?? []

  useEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [items, pending.length])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  if (!session) return null
  const { meta, browserOpen } = session

  const changeMode = (mode: PermissionMode) => { void window.aimux.setPermissionMode(sessionId, mode) }
  const changeModel = (model: string) => { void window.aimux.setModel(sessionId, model || undefined) }
  const modelValue = MODELS.some((m) => m.value === meta.model) ? meta.model : ''

  const iconBtn = 'w-7 h-7 rounded-md flex items-center justify-center text-fg-muted hover:text-fg hover:bg-bg-elev2'
  const select = 'bg-bg-elev border border-border rounded-md px-2 py-1 text-[12px] text-fg outline-none'

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header ref={headerRef} className="drag h-10 shrink-0 flex items-center gap-3 px-3 border-b border-border text-[12.5px] text-fg-muted select-none">
        <span className={`w-2 h-2 rounded-full shrink-0 ${meta.running ? 'bg-accent pulse' : meta.ended ? 'bg-fg-faint' : 'bg-ok'}`} />
        <span className="truncate text-fg max-w-[35%]">{meta.title}</span>
        <span className="flex items-center gap-1 truncate min-w-0" title={meta.cwd}><Folder size={12} className="shrink-0" /> <span className="font-mono truncate">{meta.cwd}</span></span>
        <div className="ml-auto no-drag flex items-center gap-1.5 shrink-0" style={{ paddingRight: controlsInset + 4 }}>
          <select value={modelValue ?? ''} onChange={(e) => changeModel(e.target.value)} className={select} title={`Model: ${meta.model ?? 'zadani'}`}>
            {MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            {meta.model && !MODELS.some((m) => m.value === meta.model) && <option value={meta.model}>{meta.model}</option>}
          </select>
          <select value={meta.permissionMode} onChange={(e) => changeMode(e.target.value as PermissionMode)} className={select} title="Način odobravanja alata">
            {PERMISSION_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            {!PERMISSION_MODES.some((m) => m.value === meta.permissionMode) && <option value={meta.permissionMode}>{meta.permissionMode}</option>}
          </select>
          <button onClick={() => setBrowserOpen(sessionId, !browserOpen)} title="Browser panel (Ctrl+B)"
            className={`${iconBtn} ${browserOpen ? 'text-accent' : ''}`}><PanelRight size={15} /></button>
          <button onClick={() => splitPane(paneId, 'horizontal')} title="Podijeli desno (Ctrl+\)" className={iconBtn}><Columns2 size={15} /></button>
          <button onClick={() => splitPane(paneId, 'vertical')} title="Podijeli dolje (Ctrl+Shift+\)" className={iconBtn}><Rows2 size={15} /></button>
          {multi && <button onClick={() => closePane(paneId)} title="Zatvori panel (Ctrl+W)" className={iconBtn}><X size={15} /></button>}
        </div>
      </header>

      <Group orientation="horizontal" className="flex-1 min-h-0">
        <Panel id="chat" minSize="320px" className="flex flex-col min-h-0 min-w-0">
          <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-6 py-6 space-y-5">
              {items.length === 0 && (
                <div className="text-center text-fg-faint py-24 fade-in">
                  <div className="text-lg text-fg-muted">Što radimo danas?</div>
                  <div className="text-xs mt-2 font-mono">{meta.cwd}</div>
                </div>
              )}
              {items.map((it) => <Message key={it.id} item={it} />)}
              {pending.map((p) => <PermissionCard key={p.requestId} req={p} />)}
              {meta.running && items[items.length - 1]?.kind === 'user' && (
                <div className="flex items-center gap-2 text-fg-faint text-[13px] pl-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-fg-muted pulse" /> Claude razmišlja…
                </div>
              )}
            </div>
          </div>
          <Composer sessionId={sessionId} paneId={paneId} />
        </Panel>
        {browserOpen && (
          <>
            <Separator className="w-1 bg-border hover:bg-accent/60 data-[resize-handle-active]:bg-accent transition-colors cursor-col-resize" />
            <Panel id="browser" defaultSize="45%" minSize="300px" className="min-w-0">
              <BrowserPanel sessionId={sessionId} />
            </Panel>
          </>
        )}
      </Group>
    </div>
  )
}
