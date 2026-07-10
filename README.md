<div align="center">

# NotchZFX 😉

**Une encoche interactive façon Dynamic Island pour macOS — étagère de fichiers, lecteur média, calendrier, HUD volume/luminosité — plus la synchro de fichiers Mac ⇄ PC sur le réseau local.**

[**⬇️ Télécharger**](https://zfx013.github.io/NotchZFX/) · [Releases](https://github.com/zfx013/NotchZFX/releases) · [Signaler un bug](https://github.com/zfx013/NotchZFX/issues)

</div>

---

## ✨ Fonctionnalités

- **Encoche interactive** — s'ouvre au survol, animations spring fidèles à Boring Notch.
- **Étagère (Shelf)** — glisse des fichiers vers l'encoche, ils s'y posent (multi-sélection au lasso, glisser-déposer sortant).
- **Capture automatique** — les **AirDrop reçus** et les **captures d'écran** se copient dans l'étagère.
- **Lecteur média** — pochette, titre, artiste, progression, contrôles play/pause/suivant/précédent (Spotify & Apple Music via AppleScript).
- **Activité musicale** — pochette + spectre animé de chaque côté de l'encoche fermée.
- **HUD volume / luminosité** — remplace la jauge native de macOS par une jauge dans l'encoche.
- **Calendrier** — les événements du jour dans l'encoche (EventKit).
- **Synchro PC** — envoie des fichiers vers un pair sur le réseau local, découverte automatique.
- **Multi-écran** — une encoche par écran (encoche fine et discrète sur les écrans externes).
- **Fenêtre Paramètres complète** — 11 pages, tout est réglable.

## ⬇️ Installation

Rendez-vous sur la **[page de téléchargement](https://zfx013.github.io/NotchZFX/)** ou les **[releases](https://github.com/zfx013/NotchZFX/releases)** :

| Plateforme | Fichier |
|---|---|
| **macOS** (Apple Silicon / Intel) | `NotchZFX-*.dmg` |
| **Windows** | `NotchZFX-Setup-*.exe` |
| **Linux** | `NotchZFX-*.AppImage` / `.deb` |

> macOS : l'app est signée ad-hoc. Au premier lancement, faites **clic droit → Ouvrir**, puis autorisez les demandes de permission (Automatisation pour la musique, Calendrier). Les fonctions natives (encoche de drop, HUD, calendrier) sont spécifiques à macOS.

## 🛠️ Développement

```bash
npm install
npm start          # lance en mode dev (Electron)
```

Empaqueter l'app macOS localement (bundle signé ad-hoc + helpers natifs) :

```bash
bash scripts/package-mac.sh   # -> dist/NotchZFX.app
```

## 🏗️ Architecture

- **Electron** (process principal `src/main/main.js`, renderer `src/renderer/`).
- **Helpers natifs macOS** (Swift, compilés en `.app` signées ad-hoc) :
  - `DragCatcher` — capture native des drops de fichiers.
  - `HUDMonitor` — lecture volume (CoreAudio) + luminosité (DisplayServices).
  - `CalendarHelper` — événements & rappels (EventKit).
- **AppleScript** pour le now-playing / contrôle média (MediaRemote étant verrouillé sur macOS récents).

## 📄 Licence

MIT
