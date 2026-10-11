import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Square, RotateCcw, Paperclip, X } from 'lucide-react'
import { useStore } from '../store'
import { openSession } from './Welcome'
import type { ImageAttachment } from '../../../shared/ipc'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

interface Pending extends ImageAttachment { id: string; url: string }

function readImage(file: File): Promise<Pending | null> {
  if (!IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_BYTES) return Promise.resolve(null)
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      resolve({ id: `${Date.now()}-${Math.random()}`, url, mediaType: file.type, data: url.slice(url.indexOf(',') + 1) })
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

export default function Composer({ sessionId, paneId }: { sessionId: string; paneId: string }) {
  const meta = useStore((s) => s.sessions[sessionId]?.meta)
  const removeSession = useStore((s) => s.removeSession)
  const addInfo = useStore((s) => s.addInfo)
  const [text, setText] = useState('')
  const [images, setImages] = useState<Pending[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { ref.current?.focus() }, [sessionId])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = Math.min(el.scrollHeight, 240) + 'px'
  }, [text])

  if (!meta) return null
  const running = meta.running

  const addFiles = async (files: File[]) => {
    const candidates = files.filter((f) => f.type.startsWith('image/'))
    if (candidates.length === 0) return
    const read = await Promise.all(candidates.map(readImage))
    const ok = read.filter((x): x is Pending => x !== null)
    if (ok.length < candidates.length) {
      addInfo(sessionId, 'Neke slike nisu dodane. Podržani su PNG, JPEG, GIF i WebP do 5 MB.', 'error')
    }
    if (ok.length) setImages((cur) => [...cur, ...ok].slice(0, 10))
  }

  const send = async () => {
    const t = text.trim()
    if (!t && images.length === 0) return
    const imgs = images.map(({ mediaType, data }) => ({ mediaType, data }))
    setText('')
    setImages([])
    await window.aimux.send(sessionId, t, imgs)
  }

  const stop = () => { void window.aimux.interrupt(sessionId) }

  const resume = async () => {
    if (!meta.sdkSessionId || busy) return
    setBusy(true)
    try {
      await window.aimux.closeSession(sessionId)
      removeSession(sessionId)
      await openSession(paneId, { cwd: meta.cwd, resume: meta.sdkSessionId, permissionMode: meta.permissionMode })
    } finally {
      setBusy(false)
    }
  }

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.items)
      .filter((it) => it.kind === 'file')
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f && f.type.startsWith('image/'))
    if (files.length) {
      e.preventDefault()
      void addFiles(files)
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

  const canSend = text.trim().length > 0 || images.length > 0

  return (
    <div className="shrink-0 px-6 pb-5 pt-2">
      <div className="max-w-3xl mx-auto">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`rounded-2xl border bg-bg-elev transition px-3 py-2
            ${dragOver ? 'border-accent' : 'border-border focus-within:border-border-strong'}`}
        >
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 pb-2">
              {images.map((img) => (
                <div key={img.id} className="relative group/img">
                  <img src={img.url} alt="Prilog" className="h-16 w-16 object-cover rounded-lg border border-border" />
                  <button
                    onClick={() => setImages((cur) => cur.filter((x) => x.id !== img.id))}
                    title="Ukloni sliku"
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
              ref={fileRef} type="file" accept={IMAGE_TYPES.join(',')} multiple className="hidden"
              onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }}
            />
            <button onClick={() => fileRef.current?.click()} title="Priloži sliku (ili zalijepi s Ctrl+V)"
              className="shrink-0 w-8 h-8 rounded-full text-fg-muted hover:text-fg hover:bg-bg-elev2 flex items-center justify-center">
              <Paperclip size={16} />
            </button>
            <textarea
              ref={ref}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              onPaste={onPaste}
              rows={1}
              placeholder={dragOver ? 'Ispusti sliku ovdje…' : running ? 'Možeš pisati i dok Claude radi…' : 'Napiši poruku…'}
              className="flex-1 resize-none bg-transparent outline-none text-[14.5px] leading-relaxed py-1.5 placeholder:text-fg-faint max-h-60"
            />
            {running && !canSend ? (
              <button onClick={stop} title="Zaustavi" className="shrink-0 w-8 h-8 rounded-full bg-bg-elev2 border border-border text-fg hover:text-danger flex items-center justify-center">
                <Square size={13} fill="currentColor" />
              </button>
            ) : (
              <button onClick={() => void send()} disabled={!canSend} title="Pošalji (Enter)"
                className="shrink-0 w-8 h-8 rounded-full bg-accent text-black disabled:opacity-30 flex items-center justify-center hover:brightness-110 transition">
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
        <div className="text-center text-[11px] text-fg-faint mt-2">Enter šalje · Shift+Enter novi red · Ctrl+V lijepi sliku</div>
      </div>
    </div>
  )
}
