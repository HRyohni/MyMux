import { useEffect, useMemo, useRef, useState } from 'react'
import { useWindowControlsInset } from '../hooks'
import {
  Folder, PanelRight, Columns2, Rows2, X, Smartphone, Search, GitFork, FileDiff, ListTodo, ChevronRight, FilePlus, FilePen, GitBranch, Download,
  Square, Bot, MessageSquare,
} from 'lucide-react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import BrowserPanel from './BrowserPanel'
import { useStore, leaves, selectLayout } from '../store'
import { latestTodos, changedFiles, changedFileCount, type ChatItem } from '../reducer'
import { forkToSplit, errText } from '../actions'
import Message, { type MessageContext } from './Message'
import PermissionCard from './PermissionCard'
import Composer from './Composer'
import FindBar from './FindBar'
import Modal from './Modal'
import { TodoList } from './ToolCard'
import ElicitationCard from './ElicitationCard'
import GitModal from './GitModal'
import { SessionContext } from './SessionContext'
import { toMarkdown } from '../export'
import { savedSizes, saveSizes } from '../sizes'
import type { BackgroundTask } from '../../../shared/ipc'

/** Agents and shells still running in the background, each with its own stop button. */
function TaskStrip({ sessionId, tasks }: { sessionId: string; tasks: BackgroundTask[] }) {
  if (tasks.length === 0) return null
  return (
    <div className="shrink-0 px-6 pt-2">
      <div className="max-w-3xl mx-auto rounded-xl border border-border bg-bg-elev text-[12.5px] divide-y divide-border">
        {tasks.map((t) => (
          <div key={t.id} className="flex items-center gap-2 pl-3 pr-1.5 py-1 text-fg-muted">
            <Bot size={13} className="shrink-0 text-accent pulse" />
            <span className="shrink-0 text-[11px] text-fg-faint">{t.type}</span>
            <span className="flex-1 truncate" title={t.description}>{t.description}</span>
            <span className="text-[11px] text-fg-faint shrink-0">u pozadini</span>
            <button onClick={() => void window.mymux.stopTask(sessionId, t.id).catch((e) => useStore.getState().addInfo(sessionId, `Zadatak nije zaustavljen: ${errText(e)}`, 'error'))}
              title="Zaustavi ovaj zadatak" className="w-6 h-6 rounded-md flex items-center justify-center hover:text-danger hover:bg-bg-elev2"><Square size={11} fill="currentColor" /></button>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The current task list, pinned above the composer while there is unfinished work. */
function TodoStrip({ items }: { items: ChatItem[] }) {
  const todos = useMemo(() => latestTodos(items), [items])
  const [open, setOpen] = useState(false)
  const done = todos.filter((t) => t.status === 'completed').length
  if (todos.length === 0 || done === todos.length) return null
  const active = todos.find((t) => t.status === 'in_progress')
  return (
    <div className="shrink-0 px-6 pt-2">
      <div className="max-w-3xl mx-auto rounded-xl border border-border bg-bg-elev text-[12.5px]">
        <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-fg-muted hover:text-fg">
          <ListTodo size={14} className="shrink-0" />
          <span className="shrink-0 tabular-nums">Zadaci {done}/{todos.length}</span>
          <span className="flex-1 truncate text-fg">{active ? (active.activeForm ?? active.content) : ''}</span>
          <ChevronRight size={13} className={`shrink-0 transition ${open ? 'rotate-90' : ''}`} />
        </button>
        {open && <div className="border-t border-border px-3 py-2 max-h-56 overflow-auto"><TodoList todos={todos} /></div>}
      </div>
    </div>
  )
}

/** The prompt Claude is currently answering, pinned on top so each pane says what it is working on. */
function PromptStrip({ items, onJump }: { items: ChatItem[]; onJump(id: string): void }) {
  const last = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === 'user') return items[i]
    return undefined
  }, [items])
  if (!last || last.kind !== 'user') return null
  const text = last.text.trim() || '(slika)'
  return (
    <button onClick={() => onJump(last.id)} title={`${text}\n\nKlik vodi na poruku`}
      className="shrink-0 w-full flex items-center gap-2 px-4 py-1.5 border-b border-border bg-bg-elev text-left text-[12.5px] hover:bg-bg-elev2">
      <MessageSquare size={13} className="shrink-0 text-accent" />
      <span className="truncate min-w-0 text-fg">{text.replace(/\s+/g, ' ')}</span>
    </button>
  )
}

function ChangesModal({ sessionId, items, cwd, onClose }: { sessionId: string; items: ChatItem[]; cwd: string; onClose(): void }) {
  const files = useMemo(() => changedFiles(items), [items])
  const rel = (p: string) => {
    const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '')
    const [file, base] = [norm(p), norm(cwd)]
    return file.toLowerCase().startsWith(base.toLowerCase() + '/') ? file.slice(base.length + 1) : file
  }
  const open = (path: string) => {
    useStore.getState().setBrowserOpen(sessionId, true)
    void window.mymux.browser.openFile(sessionId, path)
    onClose()
  }
  const total = files.reduce((a, f) => ({ added: a.added + f.added, removed: a.removed + f.removed }), { added: 0, removed: 0 })
  return (
    <Modal title={`Izmijenjene datoteke (${files.length})`} onClose={onClose} width="max-w-2xl">
      {files.length === 0
        ? <div className="p-6 text-[13px] text-fg-faint text-center">Claude u ovom razgovoru još nije mijenjao datoteke.</div>
        : (
          <div className="p-2">
            {files.map((f) => (
              <button key={f.path} onClick={() => open(f.path)} title={`${f.path}\nKlik otvara datoteku u browser panelu`}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-left text-[13px] hover:bg-bg-elev2">
                {f.created ? <FilePlus size={14} className="shrink-0 text-ok" /> : <FilePen size={14} className="shrink-0 text-fg-muted" />}
                <span className="font-mono text-[12.5px] truncate flex-1">{rel(f.path)}</span>
                <span className="text-[11px] text-fg-faint shrink-0">{f.edits}×</span>
                <span className="font-mono text-[11.5px] shrink-0 w-20 text-right"><span className="text-ok">+{f.added}</span> <span className="text-danger">−{f.removed}</span></span>
              </button>
            ))}
            <div className="px-3 pt-2 mt-1 border-t border-border text-[11.5px] text-fg-faint flex">
              <span className="flex-1">Brojevi su iz Claudeovih Edit/Write poziva u ovom razgovoru, ne iz gita.</span>
              <span className="font-mono"><span className="text-ok">+{total.added}</span> <span className="text-danger">−{total.removed}</span></span>
            </div>
          </div>
        )}
    </Modal>
  )
}

export default function Chat({ sessionId, paneId }: { sessionId: string; paneId: string }) {
  const headerRef = useRef<HTMLElement>(null)
  const controlsInset = useWindowControlsInset(headerRef)
  const session = useStore((s) => s.sessions[sessionId])
  const setBrowserOpen = useStore((s) => s.setBrowserOpen)
  const setFindOpen = useStore((s) => s.setFindOpen)
  const splitPane = useStore((s) => s.splitPane)
  const closePane = useStore((s) => s.closePane)
  const multi = useStore((s) => leaves(selectLayout(s)).length > 1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [changesOpen, setChangesOpen] = useState(false)
  const [gitOpen, setGitOpen] = useState(false)

  const items = session?.items ?? []
  const pending = session?.pending ?? []
  const running = !!session?.meta.running
  const ended = !!session?.meta.ended
  const changed = useMemo(() => changedFileCount(items), [items])
  const ctx = useMemo<MessageContext>(() => ({ sessionId, paneId, busy: running, ended }), [sessionId, paneId, running, ended])
  const cwd = session?.meta.cwd ?? ''
  const fileCtx = useMemo(() => ({ sessionId, cwd }), [sessionId, cwd])

  useEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current && !session?.findOpen) el.scrollTop = el.scrollHeight
  }, [items, pending.length, session?.elicitations.length, session?.findOpen])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const jumpTo = (id: string) => {
    scrollRef.current?.querySelector(`[data-item="${id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  if (!session) return null
  const { meta, browserOpen } = session

  const addInfo = useStore.getState().addInfo
  const toggleRemote = () => {
    const enable = !meta.remoteUrl
    window.mymux.setRemoteControl(sessionId, enable)
      .then((url) => {
        if (!url) return addInfo(sessionId, 'Remote Control isključen')
        void navigator.clipboard.writeText(url).catch(() => {})
        addInfo(sessionId, `Remote Control uključen, poveznica je kopirana: ${url}`)
      })
      .catch((e) => addInfo(sessionId, `Remote Control nije ${enable ? 'uključen' : 'isključen'}: ${errText(e)}`, 'error'))
  }
  const fork = () => { forkToSplit(sessionId, paneId).catch((e) => addInfo(sessionId, `Kopija razgovora nije napravljena: ${errText(e)}`, 'error')) }
  const exportChat = () => {
    const name = `${meta.title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'razgovor'}.md`
    window.mymux.saveExport(name, toMarkdown(items, meta))
      .then((path) => { if (path) addInfo(sessionId, `Razgovor je spremljen u ${path}`) })
      .catch((e) => addInfo(sessionId, `Izvoz nije uspio: ${errText(e)}`, 'error'))
  }
  const commitRename = () => {
    const t = renaming?.trim()
    setRenaming(null)
    if (t && t !== meta.title) window.mymux.renameSession(sessionId, t).catch((e) => addInfo(sessionId, `Preimenovanje nije uspjelo: ${errText(e)}`, 'error'))
  }

  const iconBtn = 'w-7 h-7 rounded-md flex items-center justify-center text-fg-muted hover:text-fg hover:bg-bg-elev2 disabled:opacity-40'

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header ref={headerRef} className="drag h-10 shrink-0 flex items-center gap-3 px-3 border-b border-border text-[12.5px] text-fg-muted select-none">
        <span className={`w-2 h-2 rounded-full shrink-0 ${meta.running ? 'bg-accent pulse' : meta.ended ? 'bg-fg-faint' : 'bg-ok'}`} />
        {renaming !== null ? (
          <input autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} onBlur={commitRename}
            onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null) }}
            className="no-drag h-7 w-64 max-w-[40%] px-2 rounded-md bg-bg border border-accent text-[12.5px] text-fg outline-none" />
        ) : (
          <span onDoubleClick={() => setRenaming(meta.title)} title="Dvoklik za preimenovanje" className="no-drag truncate text-fg max-w-[35%]">{meta.title}</span>
        )}
        <span className="flex items-center gap-1 truncate min-w-0" title={meta.cwd}><Folder size={12} className="shrink-0" /> <span className="font-mono truncate">{meta.cwd}</span></span>
        <div className="ml-auto no-drag flex items-center gap-1 shrink-0" style={{ paddingRight: controlsInset + 4 }}>
          {changed > 0 && (
            <button onClick={() => setChangesOpen(true)} title="Datoteke izmijenjene u ovom razgovoru"
              className="h-7 px-2 rounded-md flex items-center gap-1.5 text-fg-muted hover:text-fg hover:bg-bg-elev2 text-[12px]">
              <FileDiff size={14} /> {changed}
            </button>
          )}
          <button onClick={() => setFindOpen(sessionId, !session.findOpen)} title="Pretraži razgovor (Ctrl+F)"
            className={`${iconBtn} ${session.findOpen ? 'text-accent' : ''}`}><Search size={15} /></button>
          <button onClick={() => setGitOpen(true)} title="Git: stvarne izmjene, commit, stash, worktree" className={iconBtn}><GitBranch size={15} /></button>
          <button onClick={exportChat} disabled={items.length === 0} title="Izvezi razgovor (Markdown ili HTML)" className={iconBtn}><Download size={15} /></button>
          <button onClick={fork} disabled={!meta.sdkSessionId || meta.running} title="Kopiraj razgovor u novi panel (fork)" className={iconBtn}><GitFork size={15} /></button>
          <button onClick={toggleRemote} disabled={meta.ended}
            title={meta.remoteUrl ? `Remote Control uključen: ${meta.remoteUrl}\nKlik za isključivanje` : 'Remote Control: nastavi razgovor s claude.ai ili mobitela'}
            className={`${iconBtn} ${meta.remoteUrl ? 'text-accent' : ''}`}><Smartphone size={15} /></button>
          <button onClick={() => setBrowserOpen(sessionId, !browserOpen)} title="Browser panel (Ctrl+B)"
            className={`${iconBtn} ${browserOpen ? 'text-accent' : ''}`}><PanelRight size={15} /></button>
          <button onClick={() => splitPane(paneId, 'horizontal')} title="Podijeli desno (Ctrl+\)" className={iconBtn}><Columns2 size={15} /></button>
          <button onClick={() => splitPane(paneId, 'vertical')} title="Podijeli dolje (Ctrl+Shift+\)" className={iconBtn}><Rows2 size={15} /></button>
          {multi && <button onClick={() => closePane(paneId)} title="Zatvori panel (Ctrl+W)" className={iconBtn}><X size={15} /></button>}
        </div>
      </header>

      <Group orientation="horizontal" className="flex-1 min-h-0"
        onLayoutChanged={(sizes) => { if (sizes.browser !== undefined) saveSizes(`chat:${paneId}`, sizes) }}>
        <Panel id="chat" minSize="320px" className="flex flex-col min-h-0 min-w-0">
          {session.findOpen && <FindBar container={scrollRef} version={items} onClose={() => setFindOpen(sessionId, false)} />}
          <PromptStrip items={items} onJump={jumpTo} />
          <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-6 py-6 space-y-5">
              {items.length === 0 && (
                <div className="text-center text-fg-faint py-24 fade-in">
                  <div className="text-lg text-fg-muted">Što radimo danas?</div>
                  <div className="text-xs mt-2 font-mono">{meta.cwd}</div>
                </div>
              )}
              <SessionContext.Provider value={fileCtx}>
                {items.map((it) => <Message key={it.id} item={it} ctx={ctx} />)}
              </SessionContext.Provider>
              {pending.map((p) => <PermissionCard key={p.requestId} req={p} />)}
              {session.elicitations.map((e) => <ElicitationCard key={e.requestId} req={e} />)}
              {meta.running && items[items.length - 1]?.kind === 'user' && (
                <div className="flex items-center gap-2 text-fg-faint text-[13px] pl-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-fg-muted pulse" /> Claude razmišlja…
                </div>
              )}
            </div>
          </div>
          <TaskStrip sessionId={sessionId} tasks={meta.tasks ?? []} />
          <TodoStrip items={items} />
          <Composer sessionId={sessionId} paneId={paneId} />
        </Panel>
        {browserOpen && (
          <>
            <Separator className="w-1 bg-border hover:bg-accent/60 data-[resize-handle-active]:bg-accent transition-colors cursor-col-resize" />
            <Panel id="browser" defaultSize={`${savedSizes(`chat:${paneId}`)?.browser ?? 45}%`} minSize="300px" className="min-w-0">
              <BrowserPanel sessionId={sessionId} />
            </Panel>
          </>
        )}
      </Group>
      {gitOpen && <GitModal cwd={meta.cwd} paneId={paneId} mode={meta.permissionMode} onClose={() => setGitOpen(false)} />}
      {changesOpen && <ChangesModal sessionId={sessionId} items={items} cwd={meta.cwd} onClose={() => setChangesOpen(false)} />}
    </div>
  )
}
