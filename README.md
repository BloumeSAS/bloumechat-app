# 🚀 BloumeChat Desktop (Multi-plateforme)

Bienvenue dans le dépôt de l'application desktop officielle de **BloumeChat**. Cette application est propulsée par **Electron** et **Nextron** (Next.js + Electron), offrant une expérience fluide, rapide et sécurisée sur **Windows**, **macOS** et **Linux**.

## ✨ Fonctionnalités Desktop
- **Performance Optimisée** : Chargement plus rapide et fluidité accrue par rapport au navigateur.
- **Système d'Auto-Update** : Recevez les dernières nouveautés instantanément sans retélécharger manuellement l'application.
- **Intégration Système** : Icône dans la barre des tâches (Tray), notifications natives et contrôle de fenêtre personnalisé.
- **Sécurité Renforcée** : Bypass intelligent pour les cookies cross-origin et gestion sécurisée des sessions.
- **Multi-plateforme** : Support complet pour Windows (.exe), macOS (.dmg universal) et Linux (.AppImage, .deb, .rpm, .snap).

---

## 🛠️ Développement Local

### Installation des dépendances
```bash
npm install
```

### Lancer en mode développement
```bash
npm run dev
```

### Construire localement (Windows uniquement pour l'EXE)
```bash
npm run build:exe
```
Le fichier exécutable sera généré dans le dossier `dist/`.

---

## 📦 CI/CD & Release Automatisée

Nous utilisons **GitHub Actions** pour compiler les versions pour toutes les plateformes automatiquement.

### Publier une nouvelle version
1. Incrémentez la version dans `package.json`.
2. Poussez vos changements sur la branche principale :
   ```bash
   git add .
   git commit -m "feat: nouvelle version X.X.X"
   git push
   ```
3. Créez et poussez un tag de version :
   ```bash
   git tag vX.X.X
   git push origin vX.X.X
   ```
4. **GitHub Actions** lancera automatiquement 2 runners (macOS, Linux) pour compiler les binaires et les ajouter à une nouvelle **Release** sur GitHub. **Windows n'est pas construit par la CI** : l'installeur est signé en local (certificat sur YubiKey) avec `npm run release:win` — voir le Guide de Release.

---

## 📖 Documentation Additionnelle
- [Guide des Codes de Retour EXE](./EXIT_CODES.md) : Comprendre les codes de sortie lors de l'installation ou de l'exécution.
- [Guide de Release](./RELEASE_GUIDE.md) : Procédure détaillée pour les mises à jour.

---

## 🛡️ Sécurité & Confidentialité
L'application utilise un système de vérification par challenge pour garantir que seuls les utilisateurs légitimes accèdent au service. Les cookies de session sont gérés en `SameSite=None` pour une compatibilité parfaite avec l'application web.

---

---

<div align="center">
  <a href="https://bloume.fr">
    <img src="https://bloume.fr/favicon.svg" width="100" height="100" alt="Bloume SAS Logo" style="vertical-align: middle; margin-right: 8px; background-color: #c57af0ff; border-radius: 20%;">
    <br>
    <strong>Bloume SAS</strong>
  </a>
  <br>
  <p>© 2026 Bloume SAS. Tous droits réservés.</p>
</div>
