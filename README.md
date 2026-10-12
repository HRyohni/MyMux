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
npm test         # vitest: reducer poruka, diff, raspored panela, prečaci, pretraga datoteka
npm run dist     # Windows instaler -> dist/aimux Setup x.y.z.exe
npm run dist:mac # macOS dmg (pokreće se na macOS-u)
npm run dist:linux # Linux AppImage (pokreće se na Linuxu)
npm run release  # Windows build + objava na GitHub Releases (treba GH_TOKEN)
```

## Grupe i paneli

Sidebar na vrhu prikazuje grupe. Svaka grupa je zaseban raspored panela (npr. 3 razgovora u jednoj grupi, 3 druga u drugoj).
Klik na karticu prebacuje grupu, dvoklik je preimenuje, X je zatvara. Razgovori su globalni: klik na razgovor u sidebaru
skače u grupu i panel gdje je otvoren, ili ga otvara u fokusiranom panelu aktivne grupe.

Gumbi prozora (minimiziraj, maksimiziraj, zatvori) su dio aplikacije i uvijek su gore desno, neovisno o panelima.

## Početni ekran

- **Radna mapa**: upiši putanju ili klikni *Odaberi*. Zvjezdica dodaje mapu u omiljene; ispod polja se prikazuju omiljene (zvjezdica) i nedavno korištene mape (sat) kao brzi pristup.
- **Nastavi gdje si stao**: zadnji otvoreni razgovori iz ove aplikacije.
- **Prijašnje sesije**: sve Claude Code sesije za mapu (ili sve mape), s pretragom po naslovu. Enter ili *u sadržaju* pretražuje i tekst poruka u transkriptima.

## Razgovor

- **Pitanja i plan**: kad Claude pozove `AskUserQuestion`, dobiješ karticu s ponuđenim odgovorima (jedan ili više, ili vlastiti tekst).
  U Plan načinu `ExitPlanMode` prikazuje plan kao čitljiv dokument s gumbima *Odobri i prihvaćaj izmjene*, *Odobri, pitaj za svaku izmjenu*
  i *Nastavi planirati* (uz napomenu što promijeniti).
- **Odobrenja**: uz *Odbij* možeš upisati razlog ili uputu što da Claude napravi umjesto toga. Edit/Write se prije odobrenja vide kao diff.
- **Slash komande**: upiši `/` za popis (ugrađene komande, skillovi, komande projekta) s automatskim dovršavanjem. `/compact` i `/clear` rade kao u CLI-ju.
- **Datoteke**: `@` otvara pretragu po radnoj mapi (poštuje `.gitignore`). Spajalica, povlačenje ili Ctrl+V prilažu bilo koju datoteku;
  slike idu kao slike, ostalo kao putanja koju Claude sam pročita.
- **Red čekanja**: poruka poslana dok Claude radi čeka kraj odgovora. U redu je možeš otkazati (X) ili poslati odmah (munja), pa je Claude vidi između dva koraka.
- **Poruke**: prijeđi mišem preko svoje poruke za *kopiraj*, *uredi*, *ponovi*, *grananje u novi panel* i *vrati datoteke*.
  Uređivanje i ponavljanje nastavljaju razgovor od prije te poruke u kopiji transkripta; original ostaje u prijašnjim sesijama.
  *Vrati datoteke* vraća datoteke na stanje prije te poruke (SDK file checkpointing), uz pregled što će se promijeniti.
- **Kod i izmjene**: blokovi koda imaju isticanje sintakse i gumb za kopiranje. Edit/MultiEdit/Write kartice prikazuju diff s brojem dodanih i
  uklonjenih redaka, a ikona u zaglavlju otvara popis svih datoteka izmijenjenih u razgovoru.
- **Zadaci**: lista zadataka (TodoWrite ili TaskCreate/TaskUpdate) vidi se u kartici i prikvačena iznad polja za poruku dok ima nedovršenih.
- **Podagenti**: Agent kartica sadrži cijeli ugniježđeni razgovor podagenta (poruke, alati, rezultati).
- **Kontekst i trošak**: ispod polja za poruku vidiš popunjenost kontekstnog prozora i ukupni trošak sesije; uz svaki odgovor trošak tog odgovora.
- **Model, effort, način odobravanja**: biraju se ispod polja za poruku. Popis modela i razina efforta dolazi iz CLI-ja.
- **Pretraga**: Ctrl+F pretražuje prikazani razgovor (sklopljene kartice alata prvo rasklopi).
- **Sesije**: dvoklik na naslov (zaglavlje ili bočna traka) preimenuje razgovor. U bočnoj traci i na popisu prijašnjih sesija razgovor se može
  arhivirati (sakriti) ili trajno obrisati. Gumb za fork u zaglavlju kopira cijeli razgovor u novi panel.
- **Raspored se pamti**: grupe, splitovi, njihovi omjeri i otvoreni razgovori vraćaju se nakon ponovnog pokretanja (svaki razgovor se nastavlja iz transkripta).
  Imenovani rasporedi spremaju se i učitavaju u Postavke → Rasporedi.
- **Povlačenje**: razgovor iz bočne trake možeš povući u bilo koji panel.
- **Izbornik „⋯” pored polja za poruku**: screenshot browser panela kao prilog, dodavanje radne mape (`/add-dir`), prošireno razmišljanje,
  brzi način i tvoji predlošci poruka (uređuju se u Postavke → Predlošci).
- **Prijedlog sljedeće poruke**: kad ga Claude ponudi, pojavi se kao chip iznad polja; klik ga upisuje.
- **Pozadinski zadaci**: agenti i naredbe koji rade u pozadini vide se iznad polja za poruku, svaki s gumbom za zaustavljanje.
- **Hookovi**: hook koji ne uspije ispisuje se u razgovoru s porukom greške.
- **MCP unos**: kad MCP server zatraži podatke (obrazac) ili korak u pregledniku (URL), dobiješ karticu u razgovoru.
- **Git** (ikona grane u zaglavlju): stvarne izmjene u radnom stablu s diffom prema HEAD-u, commit svih izmjena, stash i
  *Novi worktree + razgovor*, koji napravi granu u susjednoj mapi i otvori razgovor u njoj da dva razgovora ne mijenjaju iste datoteke.
- **Izvoz**: ikona preuzimanja u zaglavlju sprema razgovor kao Markdown ili HTML.
- **Pregled svih razgovora** (Ctrl+Shift+O): stanje, kontekst, trošak i broj izmjena za svaki otvoreni razgovor; klik skače na njega.
- **Suradnja razgovora**: Claude vidi druge otvorene razgovore (`session_list`) i može im poslati poruku (`session_send`, uz tvoje odobrenje).
- **Obavijesti i tray**: obavijest stiže i kad Claude čeka odobrenje, ima pitanje ili plan; klik otvara taj razgovor.
  Ikona u traci prikazuje koliko razgovora čeka tebe, a koliko radi.

## Postavke (Ctrl+,)

Tema (tamna/svijetla), veličina prikaza, zvuk, zadani model, effort i način odobravanja, prilagodba svih prečaca, predlošci poruka i imenovani rasporedi.
Ove kartice prikazuju stanje za razgovor u fokusiranom panelu:

- *MCP serveri*: status, greške, ponovno spajanje, uključivanje. Ispod je popis servera dodanih u aplikaciji (URL ili naredba);
  dobiva ih svaki novi razgovor u aimuxu, a ne diraju konfiguraciju Claude Codea.
- *Dopuštenja i hookovi*: pravila se mogu dodavati i uklanjati. Zadano se pišu u `.claude/settings.local.json` projekta;
  korisničke i projektne postavke treba izričito odabrati. Hookovi se samo pregledavaju.
- *Račun i potrošnja*: račun, pretplata i iskorištenost limita (5 sati, 7 dana).

## Remote Control

Ikona mobitela u zaglavlju razgovora uključuje Claude Code Remote Control za tu sesiju: poveznica na claude.ai se kopira
i ispisuje u razgovoru, pa se isti razgovor može nastaviti iz preglednika ili mobilne aplikacije. Ponovni klik ga isključuje.
Traži prijavu claude.ai računom (ne radi s API ključem).

## Prečaci

| Tipke | Akcija |
|---|---|
| Ctrl+T | nova grupa (svaka grupa ima svoj raspored panela) |
| Ctrl+1 … Ctrl+9 | prebaci na grupu |
| Ctrl+Tab / Ctrl+Shift+Tab | sljedeća / prethodna grupa |
| Ctrl+Shift+W | zatvori grupu (razgovori ostaju u sidebaru) |
| Ctrl+Shift+B | sakrij / prikaži bočnu traku |
| Ctrl+N | novi razgovor u fokusiranom panelu |
| Ctrl+\ | podijeli panel desno |
| Ctrl+Shift+\ | podijeli panel dolje |
| Ctrl+W | zatvori fokusirani panel (razgovor ostaje u sidebaru) |
| Ctrl+B | prikaži/sakrij browser panel |
| Ctrl+F | pretraži razgovor (u browser panelu: pretraži stranicu) |
| Ctrl+Shift+O | pregled svih razgovora |
| Ctrl+, | postavke |
| Enter / Shift+Enter | pošalji / novi red |

Prečaci se mogu promijeniti u postavkama. Dok je fokus u browser panelu vrijede Ctrl+T/Ctrl+W (tab), Ctrl+F, Ctrl +/-/0 (zoom) i F12 (DevTools).

Kad Claude završi odgovor, čuje se kratak zvuk (dublji ton kod greške). Gumb sa zvučnikom u bočnoj traci ga uključuje i isključuje.

Koristi istu prijavu, model, postavke, CLAUDE.md i hookove kao tvoj Claude Code CLI
(`settingSources: user, project, local`).

## Struktura

- `src/main/agent.ts`  – upravljanje sesijama preko `query()` sa streaming ulazom, odobrenja alata (`canUseTool`)
- `src/main/browser.ts` – WebContentsView po sesiji + Playwright preko CDP-a (`SessionBrowser`, `CdpConnection`)
- `src/main/browserTools.ts` – in-process MCP server `aimux` s `browser_*` alatima koje Claude koristi
- `src/main/documents.ts` – DOCX (mammoth), XLSX/CSV (SheetJS), PPTX (pojednostavljeno, preko JSZip-a), Markdown i tekst → privremeni HTML za browser panel
- `src/main/files.ts` – pretraga datoteka za `@` spominjanja, privremeno spremanje priloga
- `src/main/updater.ts` – auto-update preko electron-updatera
- `src/main/git.ts` – status, diff, commit, stash i worktree za Git dijalog
- `src/main/extras.ts` – stablo datoteka, pretraga transkripata, povijest podagenata, izvoz, uređivanje pravila dopuštenja
- `src/main/index.ts`  – Electron prozor, IPC, obavijesti, dev hookovi
- `src/preload/`       – `window.aimux` API (contextBridge)
- `src/renderer/`      – React + Tailwind UI. Čista logika je odvojena i pokrivena testovima: `reducer.ts` (SDK poruke → chat stavke),
  `layout.ts` (stablo panela, spremanje rasporeda), `diff.ts`, `keys.ts`; `store.ts` je zustand store, `actions.ts` otvaranje/fork/brisanje sesija
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
| `AIMUX_USER_DATA=mapa` | zaseban profil (localStorage, cache), da test ne dira pokrenutu aplikaciju |
| `AIMUX_AUTOIMAGE=put.png` | priloži sliku uz `AIMUX_AUTOPROMPT` |
| `AIMUX_TOGGLE_SIDEBAR=ms` | sklopi/rasklopi bočnu traku nakon zadanog vremena |
| `AIMUX_MODE=plan` | način odobravanja za autoprompt sesiju (`plan`, `acceptEdits`, …) |
| `AIMUX_CDP_PORT=9333` | fiksni CDP port, da se testna skripta (Playwright `connectOverCDP`) može spojiti na UI |
| `AIMUX_NO_UPDATE=1` | preskoči provjeru nove verzije |

Aplikacija je single-instance: drugo pokretanje s istim profilom samo fokusira postojeći prozor.

## Napomene o SDK-u (naučeno u fazi 1)

- Uz `includePartialMessages` SDK šalje `assistant` poruku **po svakom bloku**, ne po cijeloj poruci.
  UI gradi blokove iz `stream_event` događaja, a iz `assistant` poruka uzima samo konačni `input` alata.
- SDK ne vraća korisnikov prompt natrag; main proces ga sam emitira u UI.
- Rezultati alata stižu kao `user` poruke s `tool_result` blokovima.

## Browser panel (faza 2)

- Svaka sesija ima svoje tabove (`WebContentsView` po tabu) ugrađene u prozor; korisnik ih vidi i može sam klikati, upisati URL ili otvoriti PDF.
  Poveznice koje otvaraju novi prozor otvaraju novi tab. Claude tabovima upravlja alatom `browser_tabs`.
- Preuzimanja se spremaju u mapu Preuzimanja i prikazuju na dnu panela (otvori / prikaži u mapi).
- Traka ispod adrese ima stablo datoteka radne mape (klik otvara datoteku), zoom, pretragu na stranici i DevTools.
- Ikona uz putanju u Read/Edit/Write karticama otvara tu datoteku u browser panelu.
- Dok je otvoren dijalog (postavke, popis izmjena) browser se privremeno sakrije, jer je nativni view uvijek iznad DOM-a.
- Electron se pokreće s `--remote-debugging-port` na slobodnom localhost portu; Playwright se spaja preko `connectOverCDP`
  i pronalazi stranicu po jedinstvenom početnom `data:` URL-u (naslov `aimux-<sessionId>`).
- Alati (`mcp__aimux__browser_navigate|open_file|snapshot|get_text|click|type|select|press|scroll|screenshot|eval|back|tabs|wait`)
  su u `allowedTools`, pa ne traže odobrenje. Snapshot označava interaktivne elemente atributom `data-aimux-ref` (e1, e2…).
- PDF radi preko Chromium PDF viewera (`webPreferences.plugins: true`).
- Renderer samo mjeri placeholder `<div>` i šalje `setBounds`; panel se automatski otvara kad Claude prvi put upotrijebi browser.

## Plan

1. ✅ Chat UI + jedan ili više agenata + odobravanje alata
2. ✅ Browser panel (Electron WebContentsView + Playwright preko CDP-a), PDF
3. ✅ Split panela (više razgovora usporedno, svaki sa svojim browserom)
4. ✅ Dokumenti (DOCX/XLSX/CSV/MD), nastavak sesija s poviješću, pretraga sesija, model po sesiji, obavijesti, instaler

## Distribucija

- **Auto-update**: zapakirana aplikacija pri pokretanju provjerava GitHub Releases repozitorija iz `build.publish` (`HRyohni/MyMux`),
  preuzima noviju verziju u pozadini i instalira je pri zatvaranju. `npm run release` gradi i objavljuje izdanje (treba `GH_TOKEN`).
  Privatni repozitorij traži token i na strani korisnika, pa je za auto-update praktičan samo javni.
- **Potpisivanje**: electron-builder potpisuje instaler ako su postavljeni `CSC_LINK` (put do .pfx certifikata ili base64) i `CSC_KEY_PASSWORD`.
  Bez certifikata instaler ostaje nepotpisan i SmartScreen traži potvrdu; auto-update radi i tada.
- **Platforme**: konfigurirani su Windows (nsis, x64), macOS (dmg, arm64 i x64) i Linux (AppImage, x64). Svaki se gradi na svojoj platformi;
  macOS i Linux build nisu isprobani.

## Poznata ograničenja

- Vraćanje rasporeda pokreće po jedan Claude Code proces za svaki razgovor koji je bio otvoren.
- Uređivanje/ponavljanje poruke vraća razgovor, ali ne i datoteke; za njih postoji zasebno *Vrati datoteke*.
- MCP serveri koji traže prijavu (OAuth) autoriziraju se u CLI-ju (`/mcp`); aplikacija prikazuje status i nudi ponovno spajanje.
- Glasovni unos nije ugrađen: Web Speech API u Electronu ne radi bez Googleovog ključa. Windows diktiranje (Win+H) radi u polju za poruku.
- Dijalozi koje CLI traži preko `onUserDialog` nisu podržani; podržani su MCP zahtjevi za unos (elicitation).
- Prijedlog sljedeće poruke i brzi način ovise o modelu i pretplati; ako ih CLI ne ponudi, ne prikazuju se.
- PPTX je pojednostavljen prikaz (tekst, tablice, slike, bilješke) bez pozicija, tema i animacija; DOCX se renderira bez složenog formatiranja (mammoth).
- Pretraga razgovora ne vidi sadržaj sklopljenih kartica alata.
