# aimux

Chat sučelje za Claude Code s vidljivim browser panelom (faza 2) i prikazom dokumenata (faza 4).
Zamjena za wmux bez xterm/konzolnog izgleda: Claude Code se pokreće preko Claude Agent SDK-a,
a poruke, pozivi alata i odobrenja renderiraju se kao normalan chat.

## Pokretanje

```bash
npm install
npm run dev      # dev mode s hot reloadom
npm start        # build + pokretanje
npm run typecheck
npm run dist     # Windows instaler -> dist/aimux Setup x.y.z.exe
```

## Grupe i paneli

Sidebar na vrhu prikazuje grupe. Svaka grupa je zaseban raspored panela (npr. 3 razgovora u jednoj grupi, 3 druga u drugoj).
Klik na karticu prebacuje grupu, dvoklik je preimenuje, X je zatvara. Razgovori su globalni: klik na razgovor u sidebaru
skače u grupu i panel gdje je otvoren, ili ga otvara u fokusiranom panelu aktivne grupe.

Gumbi prozora (minimiziraj, maksimiziraj, zatvori) su dio aplikacije i uvijek su gore desno, neovisno o panelima.

## Početni ekran

- **Radna mapa**: upiši putanju ili klikni *Odaberi*. Zvjezdica dodaje mapu u omiljene; ispod polja se prikazuju omiljene (zvjezdica) i nedavno korištene mape (sat) kao brzi pristup.
- **Nastavi gdje si stao**: zadnji otvoreni razgovori iz ove aplikacije.
- **Prijašnje sesije**: sve Claude Code sesije za mapu (ili sve mape), s pretragom.

## Prečaci

| Tipke | Akcija |
|---|---|
| Ctrl+T | nova grupa (svaka grupa ima svoj raspored panela) |
| Ctrl+1 … Ctrl+9 | prebaci na grupu |
| Ctrl+Tab / Ctrl+Shift+Tab | sljedeća / prethodna grupa |
| Ctrl+Shift+W | zatvori grupu (razgovori ostaju u sidebaru) |
| Ctrl+N | novi razgovor u fokusiranom panelu |
| Ctrl+\ | podijeli panel desno |
| Ctrl+Shift+\ | podijeli panel dolje |
| Ctrl+W | zatvori fokusirani panel (razgovor ostaje u sidebaru) |
| Ctrl+B | prikaži/sakrij browser panel |
| Enter / Shift+Enter | pošalji / novi red |

Koristi istu prijavu, model, postavke, CLAUDE.md i hookove kao tvoj Claude Code CLI
(`settingSources: user, project, local`).

## Struktura

- `src/main/agent.ts`  – upravljanje sesijama preko `query()` sa streaming ulazom, odobrenja alata (`canUseTool`)
- `src/main/browser.ts` – WebContentsView po sesiji + Playwright preko CDP-a (`SessionBrowser`, `CdpConnection`)
- `src/main/browserTools.ts` – in-process MCP server `aimux` s `browser_*` alatima koje Claude koristi
- `src/main/documents.ts` – DOCX (mammoth), XLSX/CSV (SheetJS), Markdown i tekst → privremeni HTML za browser panel
- `src/main/index.ts`  – Electron prozor, IPC, obavijesti, dev hookovi
- `src/preload/`       – `window.aimux` API (contextBridge)
- `src/renderer/`      – React + Tailwind UI; `store.ts` pretvara SDK poruke u chat stavke i drži split layout (binarno stablo panela)
- `src/shared/ipc.ts`  – tipovi IPC ugovora

## Dev hookovi (env varijable)

| Varijabla | Što radi |
|---|---|
| `AIMUX_AUTOPROMPT` | pošalje prompt odmah nakon pokretanja |
| `AIMUX_CWD` | radna mapa za autoprompt sesiju |
| `AIMUX_AUTOOPEN=put.pdf` | otvori datoteku u browser panelu odmah nakon pokretanja (bez prompta) |
| `AIMUX_AUTORESUME=latest\|<id>` | nastavi zadnju (ili zadanu) sesiju iz `AIMUX_CWD` s učitanom poviješću |
| `AIMUX_AUTOSPLIT=horizontal\|vertical` | podijeli panel nakon pokretanja |
| `AIMUX_AUTOANSWER=allow\|deny` | automatski odgovara na zahtjeve za odobrenje (`AIMUX_AUTOANSWER_DELAY` ms) |
| `AIMUX_SCREENSHOT=put.png` | snimi prozor nakon `AIMUX_SCREENSHOT_DELAY` ms (više vrijednosti odvojenih zarezom) |
| `AIMUX_DEBUG=1` | ispisuje tipove SDK poruka u konzolu |

## Napomene o SDK-u (naučeno u fazi 1)

- Uz `includePartialMessages` SDK šalje `assistant` poruku **po svakom bloku**, ne po cijeloj poruci.
  UI gradi blokove iz `stream_event` događaja, a iz `assistant` poruka uzima samo konačni `input` alata.
- SDK ne vraća korisnikov prompt natrag; main proces ga sam emitira u UI.
- Rezultati alata stižu kao `user` poruke s `tool_result` blokovima.

## Browser panel (faza 2)

- Svaka sesija ima svoj `WebContentsView` ugrađen u prozor; korisnik ga vidi i može sam klikati, upisati URL ili otvoriti PDF.
- Electron se pokreće s `--remote-debugging-port` na slobodnom localhost portu; Playwright se spaja preko `connectOverCDP`
  i pronalazi stranicu po jedinstvenom početnom `data:` URL-u (naslov `aimux-<sessionId>`).
- Alati (`mcp__aimux__browser_navigate|open_file|snapshot|get_text|click|type|select|press|scroll|screenshot|eval|back|wait`)
  su u `allowedTools`, pa ne traže odobrenje. Snapshot označava interaktivne elemente atributom `data-aimux-ref` (e1, e2…).
- PDF radi preko Chromium PDF viewera (`webPreferences.plugins: true`).
- Renderer samo mjeri placeholder `<div>` i šalje `setBounds`; panel se automatski otvara kad Claude prvi put upotrijebi browser.

## Plan

1. ✅ Chat UI + jedan ili više agenata + odobravanje alata
2. ✅ Browser panel (Electron WebContentsView + Playwright preko CDP-a), PDF
3. ✅ Split panela (više razgovora usporedno, svaki sa svojim browserom)
4. ✅ Dokumenti (DOCX/XLSX/CSV/MD), nastavak sesija s poviješću, pretraga sesija, model po sesiji, obavijesti, instaler

## Poznata ograničenja

- Sesija živi dok aplikacija radi; nakon ponovnog pokretanja nastavi je s "Nastavi gdje si stao" (povijest se učitava iz transkripta).
- Slash komande (/compact, /clear…) i interaktivni TUI dijalozi nisu podržani.
- Podagenti se prikazuju samo kao sažeti log unutar Agent kartice.
- PPTX se ne prikazuje; DOCX se renderira bez složenog formatiranja (mammoth).
- Instaler nije potpisan, pa Windows SmartScreen traži potvrdu pri prvoj instalaciji.
