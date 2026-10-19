import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp, Square, RotateCcw, Paperclip, X, FileText, Clock, Zap, File as FileIcon, Slash, MoreHorizontal, Camera, Brain, Gauge,
  FolderPlus, BookText, Sparkles, Check,
} from 'lucide-react'
import { useSettings } from '../settings'
import { useStore, PERMISSION_MODES, FALLBACK_MODELS, EFFORT_LABELS } from '../store'
import { openSession, closeSession, errText } from '../actions'
import type { ImageAttachment, SlashCommandInfo, PermissionMode, EffortLevel } from '../../../shared/ipc'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
/** Files without a path on disk (pasted, dragged from another app) are copied to a temp folder up to this size. */
const MAX_TEMP_BYTES = 25 * 1024 * 1024
const ALL_EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']

type Attachment =
  | ({ kind: 'image'; id: string; url: string } & ImageAttachment)
  | { kind: 'file'; id: string; name: string; path: string }

const newId = () => `${Date.now()}-${Math.random()}`

function readDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

async function toAttachment(file: File): Promise<Attachment | null> {
  if (IMAGE_TYPES.includes(file.type) && file.size <= MAX_IMAGE_BYTES) {
    const url = await readDataUrl(file)
    return url ? { kind: 'image', id: newId(), url, mediaType: file.type, data: url.slice(url.indexOf(',') + 1) } : null
  }
  // Anything else is handed to Claude by path, so it reads the file with its own tools.
  let path = window.mymux.pathForFile(file)
  if (!path) {
    if (file.size > MAX_TEMP_BYTES) return null
    const url = await readDataUrl(file)
    if (!url) return null
    path = await window.mymux.saveTempFile(file.name || 'prilog', url.slice(url.indexOf(',') + 1))
  }
  return { kind: 'file', id: newId(), name: file.name || path.split(/[\\/]/).pop() || path, path }
}

/** `@path` mention as the CLI reads it; paths with spaces need quotes. */
const mention = (path: string) => (/\s/.test(path) ? `@"${path}"` : `@${path}`)

type Suggestion = { key: string; label: string; detail?: string; insert: string }

const commandCache = new Map<string, Promise<SlashCommandInfo[]>>()

/** Which completion the text before the caret asks for: a slash command or a file mention. */
function completionAt(text: string, caret: number): { type: 'command' | 'file'; query: string; start: number } | null {
  const before = text.slice(0, caret)
  const cmd = /^\/([^\s]*)$/.exec(before)
  if (cmd) return { type: 'command', query: cmd[1], start: 0 }
  const file = /(^|\s)@([^\s"]*)$/.exec(before)
  if (file) return { type: 'file', query: file[2], start: before.length - file[2].length - 1 }
  return null
}

function ContextMeter({ sessionId }: { sessionId: string }) {
  const ctx = useStore((s) => s.sessions[sessionId]?.meta.context)
  const cost = useStore((s) => s.sessions[sessionId]?.meta.costUsd)
  const limit = useStore((s) => s.sessions[sessionId]?.meta.rateLimit)
  // Worth showing only once the plan's limit is in sight or already hit.
  const limitPct = limit?.utilization !== undefined ? Math.round(limit.utilization <= 1 ? limit.utilization * 100 : limit.utilization) : null
  const limitShown = !!limit && (limit.status !== 'allowed' || (limitPct !== null && limitPct >= 50))
  if (!ctx && cost === undefined && !limitShown) return null
  const pct = ctx ? Math.min(100, ctx.percentage) : 0
  const tone = pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warn' : 'bg-accent'
  const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
  return (
    <div className="flex items-center gap-2 text-[11px] text-fg-faint shrink-0 select-none">
      {ctx && (
        <span className="flex items-center gap-1.5" title={`Kontekst: ${ctx.tokens.toLocaleString('hr-HR')} od ${ctx.max.toLocaleString('hr-HR')} tokena. /compact ga sažima.`}>
          <span className="w-14 h-1.5 rounded-full bg-bg-elev2 overflow-hidden"><span className={`block h-full ${tone}`} style={{ width: `${pct}%` }} /></span>
          {ctx.percentage}% · {k(ctx.tokens)}
        </span>
      )}
      {cost !== undefined && cost > 0 && <span title="Procijenjeni trošak ove sesije">${cost.toFixed(2)}</span>}
      {limitShown && limit && (
        <span className={limit.status === 'rejected' ? 'text-danger' : limit.status === 'allowed_warning' ? 'text-warn' : ''}
          title={`Limit pretplate${limit.type ? ` (${limit.type})` : ''}${limit.resetsAt ? `, obnavlja se ${new Date(limit.resetsAt * 1000).toLocaleString('hr-HR')}` : ''}`}>
          {limit.status === 'rejected' ? 'limit dosegnut' : `limit ${limitPct ?? '?'}%`}
        </span>
      )}
    </div>
  )
}

export default function Composer({ sessionId, paneId }: { sessionId: string; paneId: string }) {
  const meta = useStore((s) => s.sessions[sessionId]?.meta)
  const draft = useStore((s) => s.sessions[sessionId]?.draft)
  const models = useStore((s) => s.models)
  const addInfo = useStore((s) => s.addInfo)
  const [text, setText] = useState('')
  const [caret, setCaret] = useState(0)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [commands, setCommands] = useState<SlashCommandInfo[]>([])
  const [files, setFiles] = useState<string[]>([])
  const [selected, setSelected] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const browserOpen = useStore((s) => !!s.sessions[sessionId]?.browserOpen)
  const prompts = useSettings((s) => s.prompts)
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const cwd = meta?.cwd ?? ''
  const live = !!meta && !meta.ended

  useEffect(() => { ref.current?.focus() }, [sessionId])

  useEffect(() => {
    if (!draft) return
    const next = draft.append && text.trim() ? `${text.trimEnd()}

${draft.text}` : draft.text
    setText(next)
    setCaret(next.length)
    ref.current?.focus()
    requestAnimationFrame(() => {
      const el = ref.current
      if (el) { el.setSelectionRange(next.length, next.length); el.scrollTop = el.scrollHeight }
    })
  }, [draft?.nonce]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = Math.min(el.scrollHeight, 240) + 'px'
  }, [text])

  // Slash commands and models come from the session's CLI process, once it has started.
  useEffect(() => {
    if (!live) return
    let cancelled = false
    if (!commandCache.has(sessionId)) commandCache.set(sessionId, window.mymux.getCommands(sessionId))
    commandCache.get(sessionId)!.then((c) => { if (!cancelled) setCommands(c) }).catch(() => commandCache.delete(sessionId))
    if (useStore.getState().models.length === 0) {
      window.mymux.getModels(sessionId).then((m) => { if (m.length) useStore.getState().setModels(m) }).catch(() => {})
    }
    return () => { cancelled = true }
  }, [sessionId, live])

  const completion = useMemo(() => (dismissed ? null : completionAt(text, caret)), [text, caret, dismissed])

  useEffect(() => {
    if (completion?.type !== 'file' || !cwd) { setFiles([]); return }
    let cancelled = false
    const timer = setTimeout(() => {
      window.mymux.searchFiles(cwd, completion.query).then((r) => { if (!cancelled) setFiles(r) }).catch(() => {})
    }, 120)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [completion?.type, completion?.query, cwd])

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!completion) return []
    if (completion.type === 'file') return files.map((f) => ({ key: f, label: f, insert: `${mention(f)} ` }))
    const q = completion.query.toLowerCase()
    return commands
      .filter((c) => c.name.toLowerCase().includes(q))
      .sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)))
      .slice(0, 40)
      .map((c) => ({ key: c.name, label: `/${c.name}${c.argumentHint ? ` ${c.argumentHint}` : ''}`, detail: c.description, insert: `/${c.name} ` }))
  }, [completion, commands, files])

  useEffect(() => { setSelected(0) }, [completion?.type, completion?.query])

  if (!meta) return null
  const running = meta.running

  const addFiles = async (list: File[]) => {
    if (list.length === 0) return
    const read = await Promise.all(list.map((f) => toAttachment(f).catch(() => null)))
    const ok = read.filter((x): x is Attachment => x !== null)
    if (ok.length < list.length) {
      addInfo(sessionId, 'Neki prilozi nisu dodani. Zalijepljene datoteke bez putanje na disku mogu imati do 25 MB.', 'error')
    }
    if (ok.length) setAttachments((cur) => [...cur, ...ok].slice(0, 20))
  }

  const send = async () => {
    const t = text.trim()
    if (!t && attachments.length === 0) return
    const imgs = attachments.flatMap((a) => (a.kind === 'image' ? [{ mediaType: a.mediaType, data: a.data }] : []))
    const paths = attachments.flatMap((a) => (a.kind === 'file' ? [a.path] : []))
    const body = paths.length ? `${t}${t ? '\n\n' : ''}Priložene datoteke: ${paths.map(mention).join(' ')}` : t
    setText('')
    setAttachments([])
    try {
      await window.mymux.send(sessionId, body, imgs)
    } catch (e) {
      addInfo(sessionId, `Poruka nije poslana: ${errText(e)}`, 'error')
    }
  }

  const stop = () => { void window.mymux.interrupt(sessionId) }

  const resume = async () => {
    if (!meta.sdkSessionId || busy) return
    setBusy(true)
    try {
      await closeSession(sessionId)
      await openSession(paneId, { cwd: meta.cwd, resume: meta.sdkSessionId, permissionMode: meta.permissionMode, model: meta.model, effort: meta.effort, title: meta.title })
    } finally {
      setBusy(false)
    }
  }

  const pick = (s: Suggestion) => {
    if (!completion) return
    const next = text.slice(0, completion.start) + s.insert + text.slice(caret)
    const pos = completion.start + s.insert.length
    setText(next)
    setCaret(pos)
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(pos, pos) })
  }

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setSelected((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length)
        return
      }
      const cur = suggestions[Math.min(selected, suggestions.length - 1)]
      // Enter on a command that is already typed out in full sends it instead of completing again.
      const typedOut = completion?.type === 'command' && cur.insert.trim() === text.trim()
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !typedOut)) { e.preventDefault(); pick(cur); return }
      if (e.key === 'Escape') { e.preventDefault(); setDismissed(true); return }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  const onPaste = (e: React.ClipboardEvent) => {
    const list = Array.from(e.clipboardData.items)
      .filter((it) => it.kind === 'file')
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f)
    if (list.length) {
      e.preventDefault()
      void addFiles(list)
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    void addFiles(Array.from(e.dataTransfer.files))
  }

  if (meta.ended) {
    return (
      <div className="shrink-0 px-6 pb-5 pt-2">
        <div className="max-w-3xl mx-auto rounded-2xl border border-border bg-bg-elev px-4 py-3 flex items-center gap-3 text-[13px] text-fg-muted">
          <span className="flex-1">Sesija je završila. Možeš je nastaviti s cijelom poviješću.</span>
          <button onClick={() => void resume()} disabled={!meta.sdkSessionId || busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-black font-medium hover:brightness-110 disabled:opacity-50">
            <RotateCcw size={14} /> Nastavi
          </button>
        </div>
      </div>
    )
  }

  const canSend = text.trim().length > 0 || attachments.length > 0
  const queued = meta.queued ?? []

  const insert = (value: string) => {
    setText(value)
    setCaret(value.length)
    setMenuOpen(false)
    requestAnimationFrame(() => ref.current?.focus())
  }
  const menuAction = (what: string, fn: () => Promise<unknown>) => {
    setMenuOpen(false)
    fn().catch((e) => addInfo(sessionId, `${what}: ${errText(e)}`, 'error'))
  }
  const screenshot = () => menuAction('Screenshot nije snimljen', async () => {
    const data = await window.mymux.browser.capture(sessionId)
    setAttachments((cur) => [...cur, { kind: 'image' as const, id: newId(), url: `data:image/png;base64,${data}`, mediaType: 'image/png', data }].slice(0, 20))
  })
  const addDir = () => menuAction('Mapa nije dodana', async () => {
    const dir = await window.mymux.pickFolder()
    if (dir) await window.mymux.send(sessionId, `/add-dir ${dir}`)
  })
  const menuItem = 'w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] text-fg-muted hover:text-fg hover:bg-bg-elev2 disabled:opacity-40 disabled:hover:bg-transparent'

  const fail = (what: string) => (e: unknown) => addInfo(sessionId, `${what}: ${errText(e)}`, 'error')
  const modelOptions = models.length ? models : FALLBACK_MODELS
  // Sessions report the full model id, the list offers aliases; match either.
  const current = modelOptions.find((m) => m.value === meta.model) ?? modelOptions.find((m) => m.resolved && m.resolved === meta.model)
  const efforts = current?.efforts ?? ALL_EFFORTS
  const select = 'bg-transparent rounded-md px-1 py-0.5 text-[11.5px] text-fg-muted hover:text-fg hover:bg-bg-elev2 outline-none cursor-pointer max-w-[9.5rem] min-w-0 shrink truncate'
  const option = 'bg-bg-elev text-fg'

  return (
    <div className="shrink-0 px-6 pb-3 pt-2">
      <div className="max-w-3xl mx-auto relative">
        {queued.length > 0 && (
          <div className="mb-2 space-y-1">
            {queued.map((m) => (
              <div key={m.id} className="flex items-center gap-2 pl-3 pr-1.5 py-1 rounded-lg border border-border bg-bg-elev text-[12.5px] text-fg-muted">
                <Clock size={13} className="shrink-0 text-fg-faint" />
                <span className="flex-1 truncate" title={m.text}>{m.text || 'Slika'}{m.images > 0 && m.text ? ` · ${m.images} sl.` : ''}</span>
                <span className="text-[11px] text-fg-faint shrink-0">čeka kraj odgovora</span>
                <button onClick={() => void window.mymux.sendQueuedNow(sessionId, m.id).catch(fail('Poruka nije poslana'))}
                  title="Pošalji odmah: Claude je vidi između dva koraka, bez čekanja kraja odgovora"
                  className="w-6 h-6 rounded-md flex items-center justify-center hover:text-accent hover:bg-bg-elev2"><Zap size={13} /></button>
                <button onClick={() => void window.mymux.cancelQueued(sessionId, m.id).catch(fail('Poruka nije uklonjena'))}
                  title="Ukloni iz reda" className="w-6 h-6 rounded-md flex items-center justify-center hover:text-danger hover:bg-bg-elev2"><X size={13} /></button>
              </div>
            ))}
          </div>
        )}

        {meta.suggestion && !running && !text && suggestions.length === 0 && (
          <button onClick={() => insert(meta.suggestion as string)} title="Claudeov prijedlog sljedeće poruke: klik ga upisuje u polje"
            className="mb-2 max-w-full flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-bg-elev text-[12.5px] text-fg-muted hover:text-fg hover:border-border-strong">
            <Sparkles size={12} className="shrink-0 text-accent" /> <span className="truncate">{meta.suggestion}</span>
          </button>
        )}

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onMouseDown={() => setMenuOpen(false)} />
            <div className="absolute bottom-full left-0 mb-2 z-20 w-80 max-h-96 overflow-y-auto rounded-xl border border-border-strong bg-bg-elev shadow-2xl py-1">
              <button className={menuItem} disabled={!browserOpen} onClick={screenshot}
                title={browserOpen ? 'Slika onoga što browser panel trenutno prikazuje' : 'Otvori browser panel da bi ga mogao snimiti'}>
                <Camera size={14} className="shrink-0" /> Priloži screenshot browser panela
              </button>
              <button className={menuItem} onClick={addDir} title="Claude dobiva pristup još jednoj mapi (/add-dir)">
                <FolderPlus size={14} className="shrink-0" /> Dodaj radnu mapu…
              </button>
              <button className={menuItem} onClick={() => menuAction('Razmišljanje nije promijenjeno', () => window.mymux.setThinking(sessionId, !!meta.thinkingOff))}>
                <Brain size={14} className="shrink-0" /> <span className="flex-1">Prošireno razmišljanje</span>
                {!meta.thinkingOff && <Check size={13} className="text-ok" />}
              </button>
              <button className={menuItem} onClick={() => menuAction('Brzi način nije promijenjen', () => window.mymux.setFastMode(sessionId, !meta.fastMode))}
                title="Brži izlaz istog modela, uz veću cijenu; dostupno samo na nekim modelima i pretplatama">
                <Gauge size={14} className="shrink-0" /> <span className="flex-1">Brzi način (fast mode)</span>
                {meta.fastMode && <Check size={13} className="text-ok" />}
              </button>
              <div className="mt-1 pt-1 border-t border-border">
                <div className="px-3 py-1 text-[10.5px] uppercase tracking-wider text-fg-faint">Predlošci</div>
                {prompts.length === 0 && <div className="px-3 pb-1.5 text-[12px] text-fg-faint">Dodaj ih u Postavke → Predlošci.</div>}
                {prompts.map((p) => (
                  <button key={p.id} className={menuItem} onClick={() => insert(p.text)} title={p.text}>
                    <BookText size={14} className="shrink-0" /> <span className="truncate">{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {suggestions.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-2 z-10 max-h-72 overflow-y-auto rounded-xl border border-border-strong bg-bg-elev shadow-2xl py-1">
            {suggestions.map((s, i) => (
              <button key={s.key} onMouseDown={(e) => { e.preventDefault(); pick(s) }} onMouseEnter={() => setSelected(i)}
                ref={(el) => { if (el && i === selected) el.scrollIntoView({ block: 'nearest' }) }}
                className={`w-full text-left px-3 py-1.5 flex items-baseline gap-3 text-[12.5px] ${i === selected ? 'bg-bg-elev2 text-fg' : 'text-fg-muted'}`}>
                <span className="shrink-0 self-center text-fg-faint">{completion?.type === 'file' ? <FileIcon size={12} /> : <Slash size={12} />}</span>
                <span className="font-mono shrink-0 max-w-full truncate">{s.label}</span>
                {s.detail && <span className="truncate text-fg-faint">{s.detail}</span>}
              </button>
            ))}
          </div>
        )}

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`rounded-2xl border bg-bg-elev transition px-3 pt-2 pb-1.5
            ${dragOver ? 'border-accent' : 'border-border focus-within:border-border-strong'}`}
        >
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 pb-2">
              {attachments.map((a) => (
                <div key={a.id} className="relative">
                  {a.kind === 'image'
                    ? <img src={a.url} alt="Prilog" className="h-16 w-16 object-cover rounded-lg border border-border" />
                    : (
                      <div title={a.path} className="h-16 max-w-52 px-3 flex items-center gap-2 rounded-lg border border-border bg-bg text-[12px]">
                        <FileText size={18} className="shrink-0 text-fg-muted" />
                        <span className="truncate">{a.name}</span>
                      </div>
                    )}
                  <button
                    onClick={() => setAttachments((cur) => cur.filter((x) => x.id !== a.id))}
                    title="Ukloni prilog"
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-bg-elev2 border border-border-strong text-fg-muted hover:text-danger flex items-center justify-center"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileRef} type="file" multiple className="hidden"
              onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }}
            />
            <button onClick={() => fileRef.current?.click()} title="Priloži datoteku ili sliku (može i povlačenjem ili Ctrl+V)"
              className="shrink-0 w-8 h-8 rounded-full text-fg-muted hover:text-fg hover:bg-bg-elev2 flex items-center justify-center">
              <Paperclip size={16} />
            </button>
            <button onClick={() => setMenuOpen(!menuOpen)} title="Više: screenshot, radne mape, razmišljanje, predlošci"
              className={`shrink-0 w-8 h-8 -ml-1.5 rounded-full hover:bg-bg-elev2 flex items-center justify-center ${menuOpen ? 'text-accent' : 'text-fg-muted hover:text-fg'}`}>
              <MoreHorizontal size={16} />
            </button>
            <textarea
              ref={ref}
              value={text}
              onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); setDismissed(false) }}
              onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
              onKeyDown={onKey}
              onPaste={onPaste}
              rows={1}
              placeholder={dragOver ? 'Ispusti datoteku ovdje…' : running ? 'Poruka ide u red dok Claude radi…' : 'Napiši poruku, / za komande, @ za datoteke…'}
              className="flex-1 resize-none bg-transparent outline-none text-[14.5px] leading-relaxed py-1.5 placeholder:text-fg-faint max-h-60"
            />
            {running && (
              <button onClick={stop} title="Zaustavi" className="shrink-0 w-8 h-8 rounded-full bg-bg-elev2 border border-border text-fg hover:text-danger flex items-center justify-center">
                <Square size={13} fill="currentColor" />
              </button>
            )}
            {(!running || canSend) && (
              <button onClick={() => void send()} disabled={!canSend} title={running ? 'Dodaj u red (Enter)' : 'Pošalji (Enter)'}
                className="shrink-0 w-8 h-8 rounded-full bg-accent text-black disabled:opacity-30 flex items-center justify-center hover:brightness-110 transition">
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 pt-1.5 mt-1 border-t border-border/60 min-w-0 overflow-hidden">
            <select value={current?.value ?? meta.model ?? ''} title={`Model: ${meta.model ?? 'zadani'}`} className={select}
              onChange={(e) => void window.mymux.setModel(sessionId, e.target.value || undefined).catch(fail('Model nije promijenjen'))}>
              {!modelOptions.some((m) => m.value === 'default') && <option className={option} value="">Zadani model</option>}
              {modelOptions.map((m) => <option className={option} key={m.value} value={m.value} title={m.description}>{m.label}</option>)}
              {meta.model && !current && <option className={option} value={meta.model}>{meta.model}</option>}
            </select>
            <select value={meta.effort ?? ''} title="Effort: koliko Claude razmišlja prije odgovora" className={select}
              onChange={(e) => void window.mymux.setEffort(sessionId, (e.target.value || null) as EffortLevel | null).catch(fail('Effort nije promijenjen'))}>
              <option className={option} value="">Effort: zadani</option>
              {efforts.map((ef) => <option className={option} key={ef} value={ef}>Effort: {EFFORT_LABELS[ef]}</option>)}
              {meta.effort && !efforts.includes(meta.effort) && <option className={option} value={meta.effort}>Effort: {EFFORT_LABELS[meta.effort]}</option>}
            </select>
            <select value={meta.permissionMode} title="Način odobravanja alata" className={select}
              onChange={(e) => void window.mymux.setPermissionMode(sessionId, e.target.value as PermissionMode).catch(fail('Način odobravanja nije promijenjen'))}>
              {PERMISSION_MODES.map((m) => <option className={option} key={m.value} value={m.value} title={m.hint}>{m.label}</option>)}
              {!PERMISSION_MODES.some((m) => m.value === meta.permissionMode) && <option className={option} value={meta.permissionMode}>{meta.permissionMode}</option>}
            </select>
            <span className="flex-1" />
            {meta.compacting && <span className="text-[11px] text-accent pulse shrink-0">sažimam kontekst…</span>}
            <ContextMeter sessionId={sessionId} />
          </div>
        </div>
      </div>
    </div>
  )
}
