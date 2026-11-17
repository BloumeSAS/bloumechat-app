# Publier une version de l'app Windows

L'installeur Windows est **signé avec le certificat OV « BLOUME SAS » (SSL.com)** qui vit sur une YubiKey : la clé privée ne quitte jamais la clé, donc la CI GitHub (cloud) ne peut pas le signer. **L'installeur Windows se construit et se signe sur ce PC**, YubiKey branchée. La CI ne construit que macOS et Linux.

## Prérequis (une seule fois)

1. **YubiKey branchée.** Le certificat doit apparaître dans le magasin Windows : `certutil -user -store My` doit lister `CN=BLOUME SAS` émis par *SSL.com Code Signing Intermediate CA RSA R1*.
2. Si ce n'est pas le cas :
   - Le service **Certificate Propagation** ne doit pas être désactivé (`Get-Service CertPropSvc`). En PowerShell administrateur : `Set-Service CertPropSvc -StartupType Manual; Start-Service CertPropSvc`, puis débrancher / rebrancher la clé.
   - Installer le **pilote « YubiKey Smart Card Minidriver »** de Yubico : la clé du certificat est en RSA 3072 et le pilote intégré à Windows ne la gère pas (`signtool` répond `0x80100004`).
3. `gh auth status` doit être connecté (publication sur GitHub).

## Procédure

```powershell
# 1. depuis la racine du dépôt : version + commit + tag + push (la CI construit macOS/Linux)
python scripts/git_sync.py windows

# 2. depuis windows/ : construire, signer, vérifier (rien n'est envoyé)
npm run release:win
#    → Windows ouvre une fenêtre : saisir le PIN de la YubiKey (plusieurs fois, c'est normal)

# 3. si tout est vert : envoyer sur GitHub
npm run release:win -- -Publish
```

Le script vérifie avant d'envoyer : signature valide **et horodatée** sur `BloumeChat.exe` et l'installeur, signataire = `publisherName`, `app-update.yml` contient `publisherName`, `latest.yml` correspond à la version et au `sha512` de l'installeur. Il envoie l'installeur et le `.blockmap` **puis `latest.yml` en dernier** : les apps installées ne voient la nouvelle version qu'une fois tout en place.

> Enchaîner les étapes 1 → 3 sans attendre : la release GitHub créée par la CI n'a pas d'installeur Windows tant que l'étape 3 n'est pas faite, et le bouton de téléchargement du site (`/api/v2/downloads`) pointe sur la dernière release.

## Mise à jour automatique

- Une app installée (installeur NSIS) cherche une mise à jour **45 s après le démarrage puis toutes les ~4 h**, jamais pendant un appel vocal.
- Elle télécharge en arrière-plan, **vérifie la signature** (l'éditeur doit être exactement `CN=BLOUME SAS, O=BLOUME SAS, L=Paris, C=FR`, casse comprise), puis affiche une barre « Redémarrer et installer » ; sinon la mise à jour s'applique à la fermeture suivante.
- Une mise à jour dont la signature est refusée est supprimée et **n'est pas retentée** pendant la session.
- Pas d'auto-mise à jour pour : la version Microsoft Store (mise à jour par le Store), une version portable, un lancement en développement.
- Les apps **≤ 2.21** n'ont aucun vérificateur : leurs utilisateurs doivent installer la 2.22 à la main (bannière admin du site → page de téléchargement). Ensuite tout est automatique.

## Renouvellement du certificat (novembre 2027)

Le certificat expire le **17/11/2027**. Au renouvellement : nouvelle empreinte SHA-1 dans `electron-builder.yml` (`certificateSha1`), et le **sujet doit rester identique** (`CN=BLOUME SAS, O=BLOUME SAS, L=Paris, C=FR`) sinon les apps déjà installées refuseront les mises à jour.

## Dépannage

| Symptôme | Cause |
| --- | --- |
| `signtool` : `0x80100004` / « No certificates were found » | Certificat absent du magasin ou pilote RSA 3072 manquant (voir prérequis) |
| Le script refuse : « signer differs from publisherName » | Mauvais certificat utilisé : vérifier `certificateSha1` |
| Les apps ne se mettent pas à jour | `latest.yml` absent de la release, ou installeur non signé / signé par un autre sujet (voir `%APPDATA%\BloumeChat\logs\main.log`) |
| Rapport de crash jamais reçu | Le serveur doit être déployé avant l'app (il décompresse les rapports gzip) |

## Microsoft Store (fiche « application EXE »)

La fiche Store pointe vers l'installeur `.exe` hébergé sur GitHub (pas de paquet MSIX : `identityName` / `publisher` de la section `appx` ne servent à rien et `build:msix` n'est pas utilisé).

Après chaque release signée, dans Espace partenaires → la soumission → **Packages** :
1. URL de l'installeur **de cette version** (pas « latest ») : `https://github.com/BloumeSAS/bloumechat-app/releases/download/vX.Y.Z/BloumeChat-Setup-X.Y.Z.exe`
2. Paramètres d'installation silencieuse : `/S` (NSIS) ; architecture x64.
3. **Package validation** : le Store télécharge l'installeur et exige une signature d'une autorité reconnue (le certificat SSL.com l'est) — c'est la première version signée qui doit être soumise. Si la validation refuse l'URL parce que GitHub répond par une redirection, héberger le fichier sur un lien direct (ex. le CDN du site).
4. Notes de version : voir le texte FR/EN de la soumission.

Une installation faite depuis le Store est un installeur NSIS normal : l'app se met à jour seule (elle ne dépend pas d'une nouvelle soumission pour les mises à jour suivantes).
