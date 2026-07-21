# windows/ — Règles module (Electron, app desktop)

Ce fichier complète `CLAUDE.md` à la racine du repo (toutes les règles 1→18 s'appliquent ici intégralement) — il évite de perdre le contexte si une session démarre directement dans `windows/` plutôt qu'à la racine.

## Mémoire persistante — TOUJOURS consulter en premier
Avant toute tâche non triviale, lire :
1. `C:\Users\super\Documents\Obsidian\Bloume SAS\Bloume SAS\Context\Memory\BloumeChat.md` (index racine du projet)
2. `C:\Users\super\Documents\Obsidian\Bloume SAS\Bloume SAS\Projects\bloumechat\windows\Memory.md` (MOC du module — gotchas 100% atomisés : RPC/IPC/nativeImage/Android splash)

Voir le skill `obsidian-memory` (`.claude/skills/obsidian-memory/SKILL.md` à la racine).

## Ce module
- Electron 34 + Next.js 14 (Nextron), TypeScript strict.
- Path toujours `windows/` — jamais de dossier standalone (règle #12).
- Android (Capacitor) vit dans `webapp/android/`, PAS dans `windows/`.
- `background.ts` = orchestrateur (~220 lignes) — toute la logique métier vit dans `windows/main/services/`.

## Gotchas critiques à ne jamais réoublier
- **IPC Proxy (4 endroits obligatoires)** : toute nouvelle méthode IPC doit être ajoutée dans `preload.ts`, `ipc-handlers.ts`, `home.tsx` methodMap, ET `webapp/components/providers/index.tsx` (proxy webapp) — l'oubli d'un seul endroit rend l'appel silencieusement `undefined`, aucune erreur.
- `postMessage` bridge (`home.tsx handleMessage`) DOIT vérifier `event.origin` + ne JAMAIS avoir de fallback `methodMap[method] || method` (contourne l'allowlist).
- `nativeImage` ne rastérise PAS le SVG — toujours du PNG/ICO pour badge/thumbar/tray.
- Tout changement dans `main/` (rpc.ts, thumbar.ts, ipc-handlers.ts, preload.ts, background.ts) nécessite un rebuild Electron (`npm run build:exe`) — pas de hot-reload via la webapp.

## Rappel
Fichier qui dépasse ~200 lignes ou mélange les responsabilités → split immédiat — règle #17.
