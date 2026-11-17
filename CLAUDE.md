# windows/ — Règles module (Electron, app desktop)

Ce fichier complète `CLAUDE.md` à la racine du repo (toutes les règles 1→18 s'appliquent ici intégralement) — il évite de perdre le contexte si une session démarre directement dans `windows/` plutôt qu'à la racine.

## Mémoire persistante — TOUJOURS consulter en premier
Avant toute tâche non triviale, lire :
1. `C:\Users\super\Documents\Obsidian\Bloume SAS\Bloume SAS\Context\Memory\BloumeChat.md` (index racine du projet)
2. `C:\Users\super\Documents\Obsidian\Bloume SAS\Bloume SAS\Projects\bloumechat\windows\Memory.md` (MOC du module — gotchas 100% atomisés : RPC/IPC/nativeImage/Android splash)

Voir le skill `obsidian-memory` (`.claude/skills/obsidian-memory/SKILL.md` à la racine).

## Ce module
- Electron 43 (Chromium 150) + Next.js 14 (Nextron), TypeScript strict. Le partage d'écran sans le son de l'app (`restrictOwnAudio`) est vérifié sur Electron 43 ; les versions plus anciennes (34) n'ont pas été testées — ne pas redescendre sans re-mesurer (voir gotchas).
- Path toujours `windows/` — jamais de dossier standalone (règle #12).
- Android (Capacitor) vit dans `webapp/android/`, PAS dans `windows/`.
- `background.ts` = orchestrateur — toute la logique métier vit dans `windows/main/services/` : `updater/` (mise à jour auto), `crash/`, `badge/` (pastille non-lus + icône d'appel, dessinées en pixels), `rpc/` (activité), `navigation.ts` (liste blanche d'origines EXACTES), `site-health.ts`, `voice-power.ts`, `os-integration.ts`, `server.ts`.
- **Release Windows = locale, jamais en CI** : certificat OV sur YubiKey. `npm run release:win` (voir `RELEASE_GUIDE.md`).

## Gotchas critiques à ne jamais réoublier
- **IPC Proxy (4 endroits obligatoires)** : toute nouvelle méthode IPC doit être ajoutée dans `preload.ts`, `ipc-handlers.ts`, `home.tsx` methodMap, ET `webapp/components/providers/index.tsx` (proxy webapp) — l'oubli d'un seul endroit rend l'appel silencieusement `undefined`, aucune erreur.
- `postMessage` bridge (`home.tsx handleMessage`) DOIT vérifier `event.origin` + ne JAMAIS avoir de fallback `methodMap[method] || method` (contourne l'allowlist).
- `nativeImage` ne rastérise PAS le SVG — toujours du PNG/ICO pour badge/thumbar/tray.
- Tout changement dans `main/` (rpc/, thumbar.ts, ipc-handlers.ts, preload.ts, background.ts) nécessite un rebuild Electron (`npm run build:exe`) — pas de hot-reload via la webapp.
- **`publisherName` (electron-builder.yml) est comparé en respectant la casse** au sujet du certificat : `CN=BLOUME SAS, O=BLOUME SAS, L=Paris, C=FR` (majuscules). Sans `publisherName` dans `app-update.yml`, electron-updater **ne vérifie plus aucune signature**. Jamais de `NODE_TLS_REJECT_UNAUTHORIZED=0` ni `verifyUpdateCodeSignature=false`.
- Signer par **empreinte SHA-1** (`certificateSha1`), jamais par nom : le magasin contient d'anciens certificats auto-signés « Bloume SAS ».
- Whitelist de navigation / permissions : comparer des **origines** (`new URL(x).origin`), jamais `startsWith` (`https://bloumechat.com.evil.example` passait).
- Avant de toucher au son du partage d'écran : `getSupportedConstraints().restrictOwnAudio` est vrai dans Electron 43 ET exclut réellement le son de l'app (mesuré : deviceId `loopbackWithoutChrome`, −131 dB contre −26 dB sans l'option). L'annulation d'écho ne retire PAS le son de l'app de la capture loopback.
- Le crashReporter envoie du gzip : le serveur (`server-nest/src/crash-reports/crash-report-upload.ts`) doit le décompresser — déployer le serveur avant l'app.

## Tester l'app construite pour de vrai (sans toucher à l'installation de l'utilisateur)
`npx electron-builder --win nsis --publish never -c.win.sign=tools/no-sign.js` (build NON signé), puis lancer `dist/win-unpacked/BloumeChat.exe --user-data-dir=<dossier temporaire> --remote-debugging-port=9333` avec `BLOUME_SKIP_OS_INTEGRATION=1` (sinon le protocole `bloumechat://` et la jump list de l'installation réelle sont écrasés). Piloter via le protocole Chrome DevTools (captures `Page.captureScreenshot`, `Runtime.evaluate`). `--inspect=9230` donne accès au processus principal.

## Rappel
Fichier qui dépasse ~200 lignes ou mélange les responsabilités → split immédiat — règle #17.
