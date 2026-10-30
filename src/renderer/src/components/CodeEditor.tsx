import { useCallback, useEffect, useRef, useState } from 'react'
import { Save, RefreshCw, ExternalLink } from 'lucide-react'
import { basicSetup } from 'codemirror'
import { EditorState, Prec, type Text } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { tags as t } from '@lezer/highlight'
import { useStore } from '../store'
import { errText } from '../actions'
import SelectionBubble from './SelectionBubble'

/** Everything about an open file that must outlive the panel (hidden browser, conversation tucked to the edge). */
interface OpenDoc {
  state: EditorState
  saved: Text
  mtime: number
  crlf: boolean
  save(): void
  changed(): void
}

const docs = new Map<string, OpenDoc>()
const docKey = (sessionId: string, path: string) => `${sessionId}\0${path}`
export const forgetDoc = (sessionId: string, path: string) => docs.delete(docKey(sessionId, path))

// Colours come from the app's theme variables, so the editor follows dark and light mode by itself.
const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--color-fg)', backgroundColor: 'var(--color-bg-code)', fontSize: '12.5px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--color-accent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-accent)', borderLeftWidth: '2px' },
  '.cm-gutters': { backgroundColor: 'var(--color-bg-code)', color: 'var(--color-fg-faint)', border: 'none' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--color-fg)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--color-fg) 4%, transparent)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--color-accent) 28%, transparent) !important',
  },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--color-accent) 16%, transparent)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--color-accent-soft)', color: 'inherit', outline: 'none' },
  '.cm-foldGutter span': { color: 'var(--color-fg-faint)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--color-bg-elev2)', border: 'none', color: 'var(--color-fg-muted)' },
  '.cm-panels': { backgroundColor: 'var(--color-bg-elev)', color: 'var(--color-fg)', borderBottom: '1px solid var(--color-border)' },
  '.cm-panels input, .cm-panels button': { fontFamily: 'var(--font-sans)', fontSize: '12px' },
  '.cm-textfield': { backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '6px', color: 'var(--color-fg)' },
  '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '6px', color: 'var(--color-fg)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--color-warn) 30%, transparent)', outline: 'none' },
  '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--color-accent) 55%, transparent)' },
  '.cm-tooltip': { backgroundColor: 'var(--color-bg-elev)', border: '1px solid var(--color-border-strong)', borderRadius: '8px' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--color-bg-elev2)', color: 'var(--color-fg)' },
})

const syntax = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], color: 'var(--hl-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--hl-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--hl-number)' },
  { tag: [t.comment, t.meta], color: 'var(--hl-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.heading], color: 'var(--hl-title)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--hl-type)' },
  { tag: [t.propertyName, t.attributeName, t.tagName, t.labelName], color: 'var(--hl-attr)' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, color: 'var(--color-link)', textDecoration: 'underline' },
  { tag: t.invalid, color: 'var(--color-danger)' },
])

async function openDoc(cwd: string, path: string): Promise<OpenDoc> {
  const file = await window.mymux.readFile(cwd, path)
  const language = await LanguageDescription.matchFilename(languages, path.split(/[\\/]/).pop() ?? path)?.load().catch(() => undefined)
  const doc: OpenDoc = {
    state: null as unknown as EditorState, saved: null as unknown as Text, mtime: file.mtime, crlf: file.content.includes('\r\n'),
    save: () => {}, changed: () => {},
  }
  doc.state = EditorState.create({
    doc: file.content,
    extensions: [
      Prec.high(keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { doc.save(); return true } }])),
      basicSetup,
      keymap.of([indentWithTab]),
      theme,
      syntaxHighlighting(syntax),
      ...(language ? [language] : []),
      EditorView.updateListener.of((u) => { if (u.docChanged) doc.changed() }),
    ],
  })
  doc.saved = doc.state.doc
  return doc
}

/** One file open in the panel. It stays mounted while another tab is shown, so undo and scroll survive. */
export default function CodeEditor({ sessionId, cwd, path, visible, onPreview }: {
  sessionId: string; cwd: string; path: string; visible: boolean; onPreview(): void
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [dirty, setDirty] = useState(false)
  const key = docKey(sessionId, path)

  const readSelection = useCallback(() => {
    const state = view.current?.state
    return state ? state.sliceDoc(state.selection.main.from, state.selection.main.to) : ''
  }, [])
  // Names the file and lines, so Claude can find the code without searching for it.
  const quoteCode = useCallback((text: string) => {
    const state = view.current?.state
    if (!state) return `${text}\n\n`
    const first = state.doc.lineAt(state.selection.main.from).number
    const last = state.doc.lineAt(state.selection.main.to).number
    const fence = text.includes('```') ? '````' : '```'
    return `${path}:${first}${last > first ? `-${last}` : ''}\n${fence}\n${text}\n${fence}\n\n`
  }, [path])

  const mark = (doc: OpenDoc, state: EditorState) => {
    const now = !state.doc.eq(doc.saved)
    setDirty(now)
    useStore.getState().setCodeDirty(sessionId, path, now)
  }

  const save = (force = false) => {
    const doc = docs.get(key)
    const v = view.current
    if (!doc || !v) return
    const state = v.state
    const text = state.doc.toString()
    window.mymux.writeFile(path, doc.crlf ? text.replace(/\n/g, '\r\n') : text, force ? null : doc.mtime).then((mtime) => {
      doc.mtime = mtime
      doc.saved = state.doc
      setConflict(false)
      setError('')
      mark(doc, v.state)
    }).catch((e) => {
      if (errText(e).includes('CONFLICT')) setConflict(true)
      else setError(`Nije spremljeno: ${errText(e)}`)
    })
  }

  const reload = async () => {
    const doc = docs.get(key)
    const v = view.current
    if (!doc || !v) return
    const file = await window.mymux.readFile(cwd, path)
    const content = file.content.replace(/\r\n/g, '\n')
    doc.mtime = file.mtime
    doc.crlf = file.content.includes('\r\n')
    if (content !== v.state.doc.toString()) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: content } })
    doc.saved = v.state.doc
    setConflict(false)
    mark(doc, v.state)
  }

  useEffect(() => {
    let cancelled = false
    let mounted: EditorView | null = null
    void (async () => {
      try {
        const doc = docs.get(key) ?? await openDoc(cwd, path)
        if (cancelled || !host.current) return
        docs.set(key, doc)
        doc.save = () => save()
        doc.changed = () => { if (view.current) mark(doc, view.current.state) }
        mounted = new EditorView({ state: doc.state, parent: host.current })
        view.current = mounted
        mark(doc, doc.state)
        if (visible) mounted.focus()
      } catch (e) {
        if (!cancelled) setError(errText(e))
      }
    })()
    return () => {
      cancelled = true
      const doc = docs.get(key)
      if (mounted && doc) doc.state = mounted.state
      mounted?.destroy()
      view.current = null
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (visible) view.current?.focus() }, [visible])

  // Claude edits files too: follow the disk while nothing is unsaved, otherwise ask.
  useEffect(() => {
    if (!visible) return
    const timer = setInterval(() => {
      const doc = docs.get(key)
      if (!doc || !view.current) return
      void window.mymux.fileMtime(path).then((mtime) => {
        if (mtime === null || mtime === doc.mtime) return
        if (view.current && !view.current.state.doc.eq(doc.saved)) setConflict(true)
        else void reload().catch(() => {})
      })
    }, 1500)
    return () => clearInterval(timer)
  }, [key, visible]) // eslint-disable-line react-hooks/exhaustive-deps

  const btn = 'h-6 px-2 shrink-0 rounded-md flex items-center gap-1.5 text-[11.5px] text-fg-muted hover:text-fg hover:bg-bg-elev2 disabled:opacity-40 disabled:hover:bg-transparent'
  return (
    <div className={`absolute inset-0 z-10 flex-col bg-bg-code ${visible ? 'flex' : 'hidden'}`}
      // Ctrl+F and Ctrl+S belong to the editor here, not to the app's shortcuts around it.
      onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && 'fs'.includes(e.key.toLowerCase())) e.stopPropagation() }}>
      <div className="h-8 shrink-0 flex items-center gap-1 pl-3 pr-1 border-b border-border bg-bg-elev text-[11.5px] text-fg-faint min-w-0">
        <span className="flex-1 truncate font-mono" title={path}>{path}</span>
        <button className={btn} onClick={onPreview} title="Prikaži datoteku u browseru (Markdown, HTML, tablice…)"><ExternalLink size={12} /> Prikaz</button>
        <button className={btn} disabled={!dirty} onClick={() => save()} title="Spremi (Ctrl+S)"><Save size={12} /> Spremi</button>
      </div>
      {conflict && (
        <div className="shrink-0 flex items-center gap-2 pl-3 pr-1 h-8 border-b border-border bg-accent-soft/40 text-[12px]">
          <span className="flex-1 truncate">Datoteka je promijenjena na disku.</span>
          <button className={btn} onClick={() => void reload()}><RefreshCw size={12} /> Učitaj s diska</button>
          <button className={btn} onClick={() => save(true)}><Save size={12} /> Prepiši mojom verzijom</button>
        </div>
      )}
      {error && <div className="shrink-0 px-3 py-1.5 border-b border-border text-[12px] text-danger">{error}</div>}
      <div ref={host} className="flex-1 min-h-0 overflow-hidden" />
      {visible && <SelectionBubble sessionId={sessionId} container={host} read={readSelection} quote={quoteCode} />}
    </div>
  )
}
