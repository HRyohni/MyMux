import { useEffect, useState } from 'react'
import { RefreshCw, Loader2, X } from 'lucide-react'
import { useStore, PERMISSION_MODES, FALLBACK_MODELS, EFFORT_LABELS, selectActiveGroup, leaves } from '../store'
import { useSettings, type PromptTemplate } from '../settings'
import { ACTIONS, comboOf, type ActionId } from '../keys'
import { errText, readLayouts, saveLayout, deleteLayout, loadLayout } from '../actions'
import type { McpServerInfo, SettingsSourceInfo, PermissionMode, EffortLevel, McpServerSpec, UsageInfo } from '../../../shared/ipc'
import Modal from './Modal'

const TABS = [
  { id: 'general', label: 'Općenito' },
  { id: 'keys', label: 'Prečaci' },
  { id: 'prompts', label: 'Predlošci' },
  { id: 'layouts', label: 'Rasporedi' },
  { id: 'mcp', label: 'MCP serveri' },
  { id: 'rules', label: 'Dopuštenja i hookovi' },
  { id: 'account', label: 'Račun i potrošnja' },
] as const
type TabId = typeof TABS[number]['id']

const select = 'bg-bg border border-border rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-border-strong'
const button = 'px-3 py-1.5 rounded-lg border border-border bg-bg text-[12.5px] hover:bg-bg-elev2 disabled:opacity-40'

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-2.5">
      <div className="flex-1 min-w-0">
        <div className="text-[13px]">{label}</div>
        {hint && <div className="text-[11.5px] text-fg-faint mt-0.5">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function General() {
  const s = useSettings()
  const models = useStore((st) => st.models)
  const modelOptions = (models.length ? models : FALLBACK_MODELS).filter((m) => m.value !== 'default')
  return (
    <div className="divide-y divide-border">
      <Row label="Tema">
        <select className={select} value={s.theme} onChange={(e) => s.set({ theme: e.target.value as 'dark' | 'light' })}>
          <option value="dark">Tamna</option>
          <option value="light">Svijetla</option>
        </select>
      </Row>
      <Row label="Veličina prikaza" hint="Povećava ili smanjuje tekst i cijelo sučelje.">
        <div className="flex items-center gap-2">
          <input type="range" min={80} max={150} step={5} value={Math.round(s.zoom * 100)}
            onChange={(e) => s.set({ zoom: Number(e.target.value) / 100 })} className="accent-accent w-36" />
          <span className="w-10 text-right text-[12.5px] tabular-nums text-fg-muted">{Math.round(s.zoom * 100)}%</span>
        </div>
      </Row>
      <Row label="Zvuk kad Claude završi">
        <input type="checkbox" checked={s.sound} onChange={(e) => s.set({ sound: e.target.checked })} className="accent-accent w-4 h-4" />
      </Row>
      <Row label="Zadani model" hint="Za nove razgovore. Model otvorenog razgovora mijenjaš ispod polja za poruku.">
        <select className={select} value={s.defaultModel} onChange={(e) => s.set({ defaultModel: e.target.value })}>
          <option value="">Kao u Claude Code postavkama</option>
          {modelOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          {s.defaultModel && !modelOptions.some((m) => m.value === s.defaultModel) && <option value={s.defaultModel}>{s.defaultModel}</option>}
        </select>
      </Row>
      <Row label="Zadani effort" hint="Koliko Claude razmišlja prije odgovora.">
        <select className={select} value={s.defaultEffort} onChange={(e) => s.set({ defaultEffort: e.target.value as EffortLevel | '' })}>
          <option value="">Kao u Claude Code postavkama</option>
          {(Object.keys(EFFORT_LABELS) as EffortLevel[]).map((ef) => <option key={ef} value={ef}>{EFFORT_LABELS[ef]}</option>)}
        </select>
      </Row>
      <Row label="Zadani način odobravanja" hint="Predodabran na ekranu novog razgovora.">
        <select className={select} value={s.defaultMode} onChange={(e) => s.set({ defaultMode: e.target.value as PermissionMode })}>
          {PERMISSION_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </Row>
    </div>
  )
}

function Keys() {
  const keys = useSettings((s) => s.keys)
  const setKey = useSettings((s) => s.setKey)
  const resetKeys = useSettings((s) => s.resetKeys)
  const [recording, setRecording] = useState<ActionId | null>(null)

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setRecording(null)
      const combo = comboOf(e)
      // A shortcut needs Ctrl or Alt, otherwise it would fire while typing.
      if (!combo || !/^(Ctrl|Alt)\+/.test(combo)) return
      setKey(recording, combo)
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, setKey])

  const taken = (id: ActionId) => ACTIONS.some((a) => a.id !== id && keys[a.id] === keys[id])

  return (
    <div>
      <div className="divide-y divide-border">
        {ACTIONS.map((a) => (
          <Row key={a.id} label={a.label} hint={taken(a.id) ? 'Isti prečac ima i druga akcija; radi samo prva na popisu.' : undefined}>
            <button onClick={() => setRecording(recording === a.id ? null : a.id)}
              className={`min-w-36 px-3 py-1.5 rounded-lg border font-mono text-[12.5px]
                ${recording === a.id ? 'border-accent text-accent' : taken(a.id) ? 'border-warn/60 text-warn' : 'border-border bg-bg hover:bg-bg-elev2'}`}>
              {recording === a.id ? 'pritisni tipke…' : keys[a.id]}
            </button>
          </Row>
        ))}
      </div>
      <div className="flex items-center gap-3 pt-3 text-[11.5px] text-fg-faint">
        <span className="flex-1">Klikni prečac pa pritisni novu kombinaciju s Ctrl ili Alt. Esc odustaje. Ctrl+1 do Ctrl+9 uvijek biraju grupu.</span>
        <button onClick={resetKeys} className={button}>Vrati zadane</button>
      </div>
    </div>
  )
}

const STATUS: Record<McpServerInfo['status'], { label: string; tone: string }> = {
  connected: { label: 'spojen', tone: 'text-ok' },
  failed: { label: 'greška', tone: 'text-danger' },
  'needs-auth': { label: 'treba prijavu', tone: 'text-warn' },
  pending: { label: 'spaja se', tone: 'text-fg-muted' },
  disabled: { label: 'isključen', tone: 'text-fg-faint' },
}

function Mcp({ sessionId }: { sessionId: string | null }) {
  const [servers, setServers] = useState<McpServerInfo[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const load = () => {
    if (!sessionId) return
    setError('')
    window.mymux.getMcpStatus(sessionId).then(setServers).catch((e) => setError(errText(e)))
  }
  useEffect(load, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!sessionId) {
    return (
      <div>
        <Empty>Status MCP servera čita se iz žive sesije. Otvori razgovor i fokusiraj njegov panel.</Empty>
        <McpAdd sessionId={null} onChanged={() => {}} />
      </div>
    )
  }

  const act = (name: string, fn: () => Promise<void>) => {
    setBusy(name)
    fn().catch((e) => setError(errText(e))).finally(() => { setBusy(''); load() })
  }

  return (
    <div>
      <div className="flex items-center gap-2 pb-2 text-[11.5px] text-fg-faint">
        <span className="flex-1">Serveri fokusiranog razgovora. Konfiguracija je ista kao u Claude Code CLI-ju.</span>
        <button onClick={load} className={button}><RefreshCw size={12} className="inline -mt-0.5 mr-1" />Osvježi</button>
      </div>
      {error && <div className="mb-2 text-[12px] text-danger">{error}</div>}
      {!servers && !error && <Empty><Loader2 size={14} className="inline animate-spin mr-2" />Učitavam…</Empty>}
      {servers?.length === 0 && <Empty>Nema konfiguriranih MCP servera.</Empty>}
      <div className="divide-y divide-border">
        {servers?.map((m) => (
          <div key={m.name} className="py-2.5">
            <div className="flex items-center gap-3">
              <button onClick={() => setOpen(open === m.name ? null : m.name)} className="flex-1 min-w-0 text-left">
                <div className="text-[13px] font-mono truncate">{m.name}{m.version ? <span className="text-fg-faint"> v{m.version}</span> : null}</div>
                <div className="text-[11.5px] text-fg-faint truncate">
                  <span className={STATUS[m.status].tone}>{STATUS[m.status].label}</span>
                  {m.scope ? ` · ${m.scope}` : ''} · {m.tools.length} alata{m.url ? ` · ${m.url}` : ''}
                </div>
              </button>
              {m.name !== 'mymux' && (
                <>
                  <button disabled={busy === m.name} onClick={() => act(m.name, () => window.mymux.reconnectMcp(sessionId, m.name))} className={button}>Spoji ponovno</button>
                  <button disabled={busy === m.name} onClick={() => act(m.name, () => window.mymux.toggleMcp(sessionId, m.name, m.status === 'disabled'))} className={button}>
                    {m.status === 'disabled' ? 'Uključi' : 'Isključi'}
                  </button>
                </>
              )}
            </div>
            {m.error && <div className="mt-1.5 text-[12px] text-danger font-mono whitespace-pre-wrap break-words">{m.error}</div>}
            {m.status === 'needs-auth' && (
              <div className="mt-1.5 text-[12px] text-warn">Server traži prijavu. Autoriziraj ga u terminalu naredbom <span className="font-mono">claude mcp</span> (ili /mcp u CLI-ju), pa klikni „Spoji ponovno”.</div>
            )}
            {open === m.name && m.tools.length > 0 && (
              <div className="mt-2 font-mono text-[11.5px] text-fg-muted bg-bg border border-border rounded-lg p-2.5 max-h-40 overflow-auto leading-relaxed">{m.tools.join('  ·  ')}</div>
            )}
          </div>
        ))}
      </div>
      <McpAdd sessionId={sessionId} onChanged={load} />
    </div>
  )
}

const Empty = ({ children }: { children: React.ReactNode }) => <div className="py-8 text-center text-[13px] text-fg-faint">{children}</div>

const SOURCE_LABEL: Record<string, string> = {
  user: 'Korisničke postavke', project: 'Projekt', local: 'Projekt (lokalno)', managed: 'Upravljane (organizacija)', flag: 'Zastavica --settings',
}
const LISTS = [
  { id: 'allow', title: 'Dopušteno', tone: 'text-ok' },
  { id: 'ask', title: 'Pita', tone: 'text-warn' },
  { id: 'deny', title: 'Zabranjeno', tone: 'text-danger' },
] as const
type RuleList = typeof LISTS[number]['id']

function Rules({ cwd }: { cwd: string | null }) {
  const [sources, setSources] = useState<SettingsSourceInfo[] | null>(null)
  const [error, setError] = useState('')
  const [target, setTarget] = useState('')
  const [list, setList] = useState<RuleList>('allow')
  const [rule, setRule] = useState('')

  const load = () => {
    if (!cwd) return
    window.mymux.getSettingsInfo(cwd).then((src) => {
      setSources(src)
      const editable = src.filter((x) => x.path && x.source !== 'managed' && x.source !== 'flag')
      setTarget((cur) => cur || editable.find((x) => x.source === 'local')?.path || editable[0]?.path || '')
    }).catch((e) => setError(errText(e)))
  }
  useEffect(() => { setSources(null); setError(''); load() }, [cwd]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!cwd) return <Empty>Pravila ovise o radnoj mapi. Otvori razgovor i fokusiraj njegov panel.</Empty>
  if (!sources) return error ? <div className="py-4 text-[12.5px] text-danger">{error}</div> : <Empty><Loader2 size={14} className="inline animate-spin mr-2" />Učitavam…</Empty>

  const editable = sources.filter((x) => x.path && x.source !== 'managed' && x.source !== 'flag')
  const edit = (path: string, l: RuleList, r: string, add: boolean) => {
    setError('')
    window.mymux.editPermissionRule(cwd, path, l, r, add).then(load).catch((e) => setError(errText(e)))
  }
  const addRule = () => {
    if (!rule.trim() || !target) return
    edit(target, list, rule, true)
    setRule('')
  }
  const used = sources.filter((x) => x.allow.length || x.deny.length || x.ask.length || x.hooks.length || x.defaultMode)

  return (
    <div>
      <div className="pb-2 text-[11.5px] text-fg-faint">
        Pravila i hookovi koje učitava sesija u mapi <span className="font-mono">{cwd}</span>. Izmjene se zapisuju u odabranu datoteku postavki i vrijede za nove sesije; hookovi se ovdje samo pregledavaju.
      </div>
      {editable.length > 0 && (
        <div className="flex gap-2 pb-3">
          <select value={list} onChange={(e) => setList(e.target.value as RuleList)} className={select}>
            {LISTS.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
          </select>
          <input value={rule} onChange={(e) => setRule(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addRule() }}
            placeholder="Pravilo, npr. Bash(npm run test:*) ili Read(./secrets/**)" spellCheck={false}
            className={`${select} flex-1 min-w-0 font-mono text-[12.5px]`} />
          <select value={target} onChange={(e) => setTarget(e.target.value)} className={`${select} max-w-44`} title={target}>
            {editable.map((x) => <option key={x.path} value={x.path}>{SOURCE_LABEL[x.source] ?? x.source}</option>)}
          </select>
          <button onClick={addRule} disabled={!rule.trim()} className={button}>Dodaj</button>
        </div>
      )}
      {error && <div className="pb-2 text-[12px] text-danger">{error}</div>}
      {used.length === 0 && <Empty>Nijedna datoteka postavki ne definira pravila dopuštenja ni hookove.</Empty>}
      <div className="space-y-3">
        {used.map((src, i) => {
          const canEdit = editable.some((x) => x.path === src.path)
          return (
            <div key={i} className="rounded-lg border border-border bg-bg p-3">
              <div className="text-[13px] font-medium">{SOURCE_LABEL[src.source] ?? src.source}</div>
              {src.path && <div className="text-[11px] text-fg-faint font-mono break-all">{src.path}</div>}
              {src.defaultMode && <div className="mt-2 text-[12px] text-fg-muted">Zadani način: <span className="font-mono">{src.defaultMode}</span></div>}
              {LISTS.map((l) => src[l.id].length > 0 && (
                <div key={l.id} className="mt-2">
                  <div className={`text-[11px] uppercase tracking-wider ${l.tone}`}>{l.title} ({src[l.id].length})</div>
                  <div className="mt-1 font-mono text-[12px] text-fg-muted">
                    {src[l.id].map((r, k) => (
                      <div key={k} className="group/rule flex items-start gap-2 py-px">
                        <span className="break-all flex-1">{r}</span>
                        {canEdit && src.path && (
                          <button onClick={() => edit(src.path as string, l.id, r, false)} title="Ukloni pravilo"
                            className="shrink-0 text-fg-faint hover:text-danger opacity-0 group-hover/rule:opacity-100"><X size={12} /></button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {src.hooks.length > 0 && (
                <div className="mt-2">
                  <div className="text-[11px] uppercase tracking-wider text-fg-faint">Hookovi ({src.hooks.length})</div>
                  <div className="mt-1 space-y-1">
                    {src.hooks.map((h, k) => (
                      <div key={k} className="text-[12px]">
                        <span className="text-fg">{h.event}</span>{h.matcher ? <span className="text-fg-faint"> · {h.matcher}</span> : null}
                        <div className="font-mono text-fg-muted break-all">{h.command}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** App-added MCP servers: stored in the app, given to every new session and applied to the focused one right away. */
function McpAdd({ sessionId, onChanged }: { sessionId: string | null; onChanged(): void }) {
  const servers = useSettings((st) => st.mcpServers)
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [error, setError] = useState('')

  const apply = (next: Record<string, McpServerSpec>) => {
    useSettings.getState().set({ mcpServers: next })
    setError('')
    if (sessionId) window.mymux.setMcpServers(sessionId, next).then(onChanged).catch((e) => setError(errText(e)))
  }
  const add = () => {
    const n = name.trim()
    const t = target.trim()
    if (!/^[\w-]+$/.test(n) || n === 'mymux') return setError('Ime smije imati slova, brojke, crticu i podvlaku.')
    if (!t) return
    const [command, ...args] = t.split(/\s+/)
    apply({ ...servers, [n]: /^https?:\/\//.test(t) ? { type: 'http', url: t } : { type: 'stdio', command, args } })
    setName('')
    setTarget('')
  }

  return (
    <div className="mt-4 pt-3 border-t border-border">
      <div className="text-[13px] font-medium">Serveri dodani u aplikaciji</div>
      <div className="text-[11.5px] text-fg-faint mt-0.5">Vrijede samo u mymuxu: dobiva ih svaki novi razgovor, a fokusirani odmah. URL daje HTTP server, sve ostalo je naredba koja se pokreće (stdio).</div>
      {Object.entries(servers).map(([n, spec]) => (
        <div key={n} className="flex items-center gap-2 mt-2 text-[12.5px]">
          <span className="font-mono shrink-0">{n}</span>
          <span className="font-mono text-fg-muted truncate flex-1">{spec.type === 'stdio' ? [spec.command, ...spec.args].join(' ') : spec.url}</span>
          <button onClick={() => { const { [n]: _gone, ...rest } = servers; apply(rest) }} title="Ukloni" className="text-fg-faint hover:text-danger"><X size={13} /></button>
        </div>
      ))}
      <div className="flex gap-2 mt-2.5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ime" spellCheck={false} className={`${select} w-32 font-mono text-[12.5px]`} />
        <input value={target} onChange={(e) => setTarget(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }}
          placeholder="https://… ili naredba, npr. npx -y @modelcontextprotocol/server-memory" spellCheck={false}
          className={`${select} flex-1 min-w-0 font-mono text-[12.5px]`} />
        <button onClick={add} disabled={!name.trim() || !target.trim()} className={button}>Dodaj</button>
      </div>
      {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
    </div>
  )
}

function Prompts() {
  const prompts = useSettings((st) => st.prompts)
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const save = (next: PromptTemplate[]) => useSettings.getState().set({ prompts: next })
  const add = () => {
    if (!name.trim() || !text.trim()) return
    save([...prompts, { id: `${Date.now()}`, name: name.trim(), text }])
    setName('')
    setText('')
  }
  return (
    <div>
      <div className="pb-2 text-[11.5px] text-fg-faint">Predlošci poruka koje često šalješ. Umeću se iz izbornika „⋯” pored polja za poruku.</div>
      <div className="space-y-2">
        {prompts.map((p) => (
          <div key={p.id} className="rounded-lg border border-border bg-bg p-2.5">
            <div className="flex items-center gap-2">
              <input value={p.name} onChange={(e) => save(prompts.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)))}
                className="flex-1 min-w-0 bg-transparent outline-none text-[13px] font-medium" />
              <button onClick={() => save(prompts.filter((x) => x.id !== p.id))} title="Obriši predložak" className="text-fg-faint hover:text-danger"><X size={13} /></button>
            </div>
            <textarea value={p.text} rows={Math.min(6, p.text.split('\n').length + 1)}
              onChange={(e) => save(prompts.map((x) => (x.id === p.id ? { ...x, text: e.target.value } : x)))}
              className="mt-1.5 w-full resize-y bg-transparent outline-none text-[12.5px] text-fg-muted leading-relaxed" />
          </div>
        ))}
      </div>
      <div className="mt-3 pt-3 border-t border-border space-y-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Naziv novog predloška" className={`${select} w-full`} />
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Tekst poruke" className={`${select} w-full resize-y`} />
        <button onClick={add} disabled={!name.trim() || !text.trim()} className={button}>Dodaj predložak</button>
      </div>
    </div>
  )
}

function Layouts({ onClose }: { onClose(): void }) {
  const [layouts, setLayouts] = useState(readLayouts)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = () => setLayouts(readLayouts())
  const load = (n: string) => {
    setBusy(true)
    void loadLayout(n).finally(onClose)
  }
  return (
    <div>
      <div className="pb-2 text-[11.5px] text-fg-faint">
        Raspored pamti grupe, splitove i razgovore koji su u njima. Učitavanje zatvara trenutno otvorene razgovore (ostaju u prijašnjim sesijama) i otvara one iz rasporeda.
      </div>
      {Object.keys(layouts).length === 0 && <Empty>Još nema spremljenih rasporeda.</Empty>}
      <div className="divide-y divide-border">
        {Object.entries(layouts).map(([n, w]) => (
          <div key={n} className="flex items-center gap-3 py-2.5">
            <div className="flex-1 min-w-0">
              <div className="text-[13px] truncate">{n}</div>
              <div className="text-[11.5px] text-fg-faint">{w.groups.length} {w.groups.length === 1 ? 'grupa' : 'grupe'} · {w.sessions.length} razgovora</div>
            </div>
            <button disabled={busy} onClick={() => load(n)} className={button}>Učitaj</button>
            <button disabled={busy} onClick={() => { saveLayout(n); refresh() }} className={button} title="Prepiši trenutnim rasporedom">Prepiši</button>
            <button disabled={busy} onClick={() => { deleteLayout(n); refresh() }} className={button}>Obriši</button>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-3 pt-3 border-t border-border">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Naziv, npr. backend" className={`${select} flex-1 min-w-0`}
          onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { saveLayout(name.trim()); setName(''); refresh() } }} />
        <button disabled={!name.trim()} onClick={() => { saveLayout(name.trim()); setName(''); refresh() }} className={button}>Spremi trenutni raspored</button>
      </div>
    </div>
  )
}

function Account({ sessionId }: { sessionId: string | null }) {
  const [info, setInfo] = useState<UsageInfo | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!sessionId) return
    setInfo(null)
    setError('')
    window.mymux.getUsage(sessionId).then(setInfo).catch((e) => setError(errText(e)))
  }, [sessionId])

  if (!sessionId) return <Empty>Podaci o računu čitaju se iz žive sesije. Otvori razgovor i fokusiraj njegov panel.</Empty>
  if (error) return <div className="py-4 text-[12.5px] text-danger">{error}</div>
  if (!info) return <Empty><Loader2 size={14} className="inline animate-spin mr-2" />Učitavam…</Empty>
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('hr-HR', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

  return (
    <div className="divide-y divide-border">
      <Row label="Račun" hint={info.organization}><span className="text-[13px] text-fg-muted">{info.email ?? 'nepoznato'}</span></Row>
      <Row label="Pretplata"><span className="text-[13px] text-fg-muted">{info.subscription ?? 'nepoznato'}</span></Row>
      {info.limits.length === 0 && <div className="py-3 text-[12.5px] text-fg-faint">Limiti potrošnje nisu dostupni za ovaj način prijave.</div>}
      {info.limits.map((l) => (
        <Row key={l.label} label={`Limit: ${l.label}`} hint={l.resetsAt ? `Obnavlja se ${when(l.resetsAt)}` : undefined}>
          <div className="flex items-center gap-2">
            <span className="w-32 h-1.5 rounded-full bg-bg-elev2 overflow-hidden">
              <span className={`block h-full ${l.percent >= 90 ? 'bg-danger' : l.percent >= 70 ? 'bg-warn' : 'bg-accent'}`} style={{ width: `${Math.min(100, l.percent)}%` }} />
            </span>
            <span className="w-10 text-right text-[12.5px] tabular-nums text-fg-muted">{l.percent}%</span>
          </div>
        </Row>
      ))}
      {info.extra && (
        <Row label="Dodatna potrošnja"><span className="text-[13px] text-fg-muted">{info.extra.used ?? 0} / {info.extra.limit ?? '∞'} {info.extra.currency ?? ''}</span></Row>
      )}
      <Row label="Ova sesija" hint="Redaka koje je Claude dodao i uklonio">
        <span className="font-mono text-[12.5px]"><span className="text-ok">+{info.linesAdded}</span> <span className="text-danger">−{info.linesRemoved}</span></span>
      </Row>
    </div>
  )
}

export default function SettingsModal({ onClose }: { onClose(): void }) {
  const [tab, setTab] = useState<TabId>('general')
  // MCP status and rules belong to a session, so they describe the one in the focused pane.
  const focused = useStore((s) => {
    const g = selectActiveGroup(s)
    const id = leaves(g.layout).find((l) => l.id === g.focusedPane)?.sessionId
    return id ? s.sessions[id] : undefined
  })
  const live = focused && !focused.meta.ended ? focused.meta.id : null

  return (
    <Modal title="Postavke" onClose={onClose} width="max-w-3xl">
      <div className="flex min-h-[26rem]">
        <nav className="w-48 shrink-0 border-r border-border p-2 space-y-0.5">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`w-full text-left px-3 py-1.5 rounded-lg text-[13px] ${tab === t.id ? 'bg-bg-elev2 text-fg' : 'text-fg-muted hover:text-fg hover:bg-bg-elev2/60'}`}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="flex-1 min-w-0 px-5 py-3">
          {tab === 'general' && <General />}
          {tab === 'keys' && <Keys />}
          {tab === 'mcp' && <Mcp sessionId={live} />}
          {tab === 'prompts' && <Prompts />}
          {tab === 'layouts' && <Layouts onClose={onClose} />}
          {tab === 'rules' && <Rules cwd={focused?.meta.cwd ?? null} />}
          {tab === 'account' && <Account sessionId={live} />}
        </div>
      </div>
    </Modal>
  )
}
