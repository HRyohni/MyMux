import { memo, useState } from 'react'
import { Brain, ChevronRight, AlertCircle, Info, Pencil, RotateCcw, GitFork, Undo2 } from 'lucide-react'
import { useStore, type ChatItem, type Block } from '../store'
import { branchBefore, errText } from '../actions'
import type { ImageAttachment, RewindResult } from '../../../shared/ipc'
import ToolCard from './ToolCard'
import Markdown, { CopyButton } from './Markdown'
import Modal from './Modal'

/** Where a top-level message lives; nested subagent messages have none and get no actions. */
export interface MessageContext { sessionId: string; paneId: string; busy: boolean; ended: boolean }

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  if (!text.trim()) return null
  return (
    <div className="text-fg-faint text-[13px]">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 hover:text-fg-muted">
        <Brain size={13} /> Razmišljanje
        <ChevronRight size={12} className={`transition ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <div className="mt-2 pl-5 whitespace-pre-wrap italic leading-relaxed border-l border-border ml-1.5">{text}</div>}
    </div>
  )
}

function BlockView({ block, streaming }: { block: Block; streaming: boolean }) {
  if (block.type === 'text') return <Markdown text={block.text} />
  if (block.type === 'thinking') return <Thinking text={block.text} />
  return <ToolCard block={block} streaming={streaming} />
}

const toAttachment = (dataUrl: string): ImageAttachment | null => {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl)
  return m ? { mediaType: m[1], data: m[2] } : null
}

type UserItem = Extract<ChatItem, { kind: 'user' }>

function UserActions({ item, ctx }: { item: UserItem; ctx: MessageContext }) {
  const [working, setWorking] = useState(false)
  const [rewind, setRewind] = useState<RewindResult | null>(null)
  const { sessionId, paneId } = ctx
  const store = useStore.getState

  const run = async (fn: () => Promise<void>, what: string) => {
    if (working) return
    setWorking(true)
    try { await fn() } catch (e) {
      // The session may have been replaced meanwhile; report wherever the pane now points.
      if (store().sessions[sessionId]) store().addInfo(sessionId, `${what}: ${errText(e)}`, 'error')
      else console.error(what, e)
    } finally { setWorking(false) }
  }

  const edit = () => run(async () => {
    const meta = await branchBefore(sessionId, paneId, item, true)
    store().setDraft(meta.id, item.text)
  }, 'Uređivanje nije uspjelo')

  const retry = () => run(async () => {
    const meta = await branchBefore(sessionId, paneId, item, true)
    const images = (item.images ?? []).map(toAttachment).filter((x): x is ImageAttachment => !!x)
    await window.mymux.send(meta.id, item.text, images)
  }, 'Ponavljanje nije uspjelo')

  const branch = () => run(async () => {
    const meta = await branchBefore(sessionId, paneId, item, false)
    store().setDraft(meta.id, item.text)
  }, 'Grananje nije uspjelo')

  const previewRewind = () => run(async () => {
    const r = await window.mymux.rewindFiles(sessionId, item.uuid as string, true)
    if (!r.canRewind) throw new Error(r.error ?? 'za ovu poruku nema spremljenog stanja datoteka')
    setRewind(r)
  }, 'Vraćanje datoteka nije moguće')

  const applyRewind = () => run(async () => {
    setRewind(null)
    const r = await window.mymux.rewindFiles(sessionId, item.uuid as string, false)
    if (!r.canRewind) throw new Error(r.error ?? 'nepoznata greška')
    store().addInfo(sessionId, `Datoteke su vraćene na stanje prije ove poruke (${r.filesChanged?.length ?? 0} datoteka). Razgovor nije promijenjen.`)
  }, 'Vraćanje datoteka nije uspjelo')

  const btn = 'w-6 h-6 rounded-md flex items-center justify-center text-fg-faint hover:text-fg hover:bg-bg-elev2 disabled:opacity-30 disabled:hover:bg-transparent'
  const blocked = ctx.busy || working
  const why = ctx.busy ? ' (pričekaj da Claude završi)' : ''

  return (
    <div className="flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100 transition">
      <CopyButton text={item.text} title="Kopiraj poruku" />
      <button className={btn} disabled={blocked} onClick={edit} title={`Uredi i pošalji ponovno: razgovor se nastavlja od prije ove poruke${why}`}><Pencil size={13} /></button>
      <button className={btn} disabled={blocked} onClick={retry} title={`Ponovi: pošalji istu poruku ponovno od ove točke${why}`}><RotateCcw size={13} /></button>
      <button className={btn} disabled={blocked} onClick={branch} title={`Grananje: nastavi od prije ove poruke u novom panelu${why}`}><GitFork size={13} /></button>
      {item.uuid && !ctx.ended && (
        <button className={btn} disabled={blocked} onClick={previewRewind} title={`Vrati datoteke na stanje prije ove poruke${why}`}><Undo2 size={13} /></button>
      )}
      {rewind && (
        <Modal title="Vrati datoteke" onClose={() => setRewind(null)} width="max-w-lg">
          <div className="p-4 text-[13px] space-y-3">
            <p>
              Datoteke će se vratiti na stanje prije ove poruke
              {rewind.insertions !== undefined && <> (<span className="text-ok">+{rewind.insertions}</span> <span className="text-danger">−{rewind.deletions ?? 0}</span> redaka)</>}.
              Razgovor ostaje kakav jest.
            </p>
            {rewind.filesChanged && rewind.filesChanged.length > 0
              ? <ul className="font-mono text-[12px] bg-bg border border-border rounded-lg p-2.5 max-h-56 overflow-auto space-y-0.5">{rewind.filesChanged.map((f) => <li key={f} className="break-all">{f}</li>)}</ul>
              : <p className="text-fg-muted">Nema datoteka koje bi se promijenile.</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setRewind(null)} className="px-3 py-1.5 rounded-lg border border-border hover:bg-bg-elev2">Odustani</button>
              <button onClick={applyRewind} disabled={!rewind.filesChanged?.length} className="px-3 py-1.5 rounded-lg bg-accent text-black font-medium hover:brightness-110 disabled:opacity-40">Vrati datoteke</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Message({ item, ctx, nested = false }: { item: ChatItem; ctx?: MessageContext; nested?: boolean }) {
  if (item.kind === 'user') {
    return (
      <div data-item={item.id} className="group/msg flex justify-end fade-in">
        <div className="max-w-[80%] flex flex-col items-end gap-1.5">
          {item.images && (
            <div className="flex flex-wrap justify-end gap-2">
              {item.images.map((src, i) => (
                <img key={i} src={src} alt="Priložena slika" className="max-h-64 max-w-full rounded-xl border border-border" />
              ))}
            </div>
          )}
          {item.text.trim() && (
            <div className={`bg-user rounded-2xl rounded-tr-md px-4 py-2.5 whitespace-pre-wrap break-words leading-relaxed ${nested ? 'text-[13px]' : 'text-[14.5px]'}`}>
              {item.text}
            </div>
          )}
          {ctx && <UserActions item={item} ctx={ctx} />}
        </div>
      </div>
    )
  }

  if (item.kind === 'assistant') {
    const visible = item.blocks.filter((b) => b.type === 'tool_use' || b.text.trim().length > 0)
    if (visible.length === 0 && !item.streaming) return null
    const text = () => item.blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n')
    const hasText = item.blocks.some((b) => b.type === 'text' && b.text.trim())
    return (
      <div className="group/msg flex gap-3 fade-in">
        {!nested && <div className="shrink-0 w-7 h-7 rounded-full bg-accent-soft text-accent flex items-center justify-center text-[11px] font-bold mt-0.5 select-none">C</div>}
        <div className="min-w-0 flex-1 space-y-3">
          {visible.map((b, i) => <BlockView key={b.type === 'tool_use' ? b.id : i} block={b} streaming={item.streaming} />)}
          {item.streaming && visible.length === 0 && (
            <div className="flex items-center gap-1 h-6 pl-1">
              <span className="w-1.5 h-1.5 rounded-full bg-fg-muted pulse" />
              <span className="w-1.5 h-1.5 rounded-full bg-fg-muted pulse [animation-delay:.2s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-fg-muted pulse [animation-delay:.4s]" />
            </div>
          )}
          {hasText && !item.streaming && !nested && (
            <div className="opacity-0 group-hover/msg:opacity-100 transition -mt-1"><CopyButton text={text} title="Kopiraj odgovor" /></div>
          )}
        </div>
      </div>
    )
  }

  if (item.kind === 'result') {
    const secs = (item.durationMs / 1000).toFixed(1)
    const cost = item.totalCostUsd - item.costUsd > 0.00005
      ? `$${item.costUsd.toFixed(4)} · ukupno $${item.totalCostUsd.toFixed(4)}`
      : `$${item.totalCostUsd.toFixed(4)}`
    return (
      <div className={`${nested ? '' : 'pl-10'} text-[11.5px] ${item.isError ? 'text-danger' : 'text-fg-faint'} fade-in`}>
        {item.isError
          ? <span className="flex items-start gap-1.5"><AlertCircle size={13} className="mt-0.5 shrink-0" /> Greška: {item.text}</span>
          : <span>{secs}s · {item.turns} {item.turns === 1 ? 'korak' : 'koraka'} · {cost}</span>}
      </div>
    )
  }

  return <InfoView item={item} />
}

function InfoView({ item }: { item: Extract<ChatItem, { kind: 'info' }> }) {
  const [open, setOpen] = useState(false)
  // Multi-line notices (hook stack traces and the like) show their first line until opened.
  const nl = item.markdown ? -1 : item.text.indexOf('\n')
  const collapsible = nl !== -1
  return (
    <div className={`flex items-start gap-2 text-[13px] px-3 py-2 rounded-lg border fade-in
      ${item.level === 'error' ? 'border-danger/40 bg-danger/10 text-danger' : 'border-border bg-bg-elev text-fg-muted'}`}>
      {item.level === 'error' ? <AlertCircle size={15} className="mt-0.5 shrink-0" /> : <Info size={15} className="mt-0.5 shrink-0" />}
      {item.markdown
        ? <div className="min-w-0 flex-1 [&_.md]:text-[13px]"><Markdown text={item.text} /></div>
        : !collapsible
          ? <span className="whitespace-pre-wrap break-words min-w-0">{item.text}</span>
          : (
            <div className="min-w-0 flex-1">
              <button onClick={() => setOpen(!open)} title={open ? 'Sakrij detalje' : 'Prikaži detalje'} className="flex items-center gap-1.5 w-full text-left">
                <span className="truncate min-w-0">{item.text.slice(0, nl)}</span>
                <ChevronRight size={12} className={`shrink-0 transition ${open ? 'rotate-90' : ''}`} />
              </button>
              {open && <pre className="mt-1.5 font-mono text-[11.5px] whitespace-pre-wrap break-words max-h-56 overflow-auto opacity-90">{item.text.slice(nl + 1)}</pre>}
            </div>
          )}
    </div>
  )
}

export default memo(Message)
