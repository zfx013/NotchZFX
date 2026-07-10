// Schema (donnees) de la fenetre Parametres.
// Decrit les pages -> sections -> lignes. Aucune logique de rendu ici :
// les composants generiques (settings-components.js) savent afficher chaque `type`.
//
// Un champ de ligne peut etre une valeur simple ou une FONCTION de `ctx`
// (ctx = { getPref, setPref, info }). Les composants resolvent au moment du rendu.
// Cela permet des options/etats dynamiques (ecrans, calendriers, desactivation...).

(function () {
  // Raccourci pour construire un couple [valeur, libelle] de dropdown.
  const PAGES = [
    // -------------------------------------------------------------- 1) General
    {
      id: 'general',
      label: 'General',
      icon: 'general',
      headerButton: { label: "Quitter l'application", action: () => window.settings.quitApp() },
      sections: [
        {
          title: 'Fonctionnalites systeme',
          rows: [
            { type: 'toggle', key: 'showMenuBarIcon', label: 'Show menu bar icon' },
            { type: 'toggle', key: 'launchAtLogin', label: 'Launch at login' },
            { type: 'toggle', key: 'showOnAllScreens', label: 'Afficher sur tous les ecrans' },
            {
              type: 'dropdown',
              key: 'preferredDisplay',
              label: 'Preferred display',
              // Automatique + un choix par ecran detecte.
              options: (ctx) => [['auto', 'Automatique']].concat(
                (ctx.info.displays || []).map((d) => [d.id, d.name])
              ),
              // Grise tant que « afficher sur tous les ecrans » est actif.
              disabled: (ctx) => !!ctx.getPref('showOnAllScreens'),
            },
            { type: 'toggle', key: 'autoSwitchDisplay', label: "Basculer automatiquement d'ecran" },
          ],
        },
        {
          title: 'Notch sizing',
          rows: [
            {
              type: 'dropdown',
              key: 'notchHeightNotchDisplays',
              label: 'Notch height on notch displays',
              options: [
                ['match', 'Match real notch height'],
                ['menubar', 'Atteindre la hauteur de la barre de menus'],
                ['custom', 'Personnalise'],
              ],
            },
            {
              type: 'dropdown',
              key: 'notchHeightNonNotch',
              label: 'Notch height on non-notch displays',
              options: [
                ['menubar', 'Atteindre la hauteur de la barre de menus'],
                ['matchNotch', 'Comme une vraie encoche'],
                ['custom', 'Personnalise'],
              ],
            },
          ],
        },
        {
          title: 'Comportement du Notch',
          rows: [
            { type: 'toggle', key: 'openOnHover', label: "Ouvrir l'encoche au survol" },
            { type: 'toggle', key: 'hapticFeedback', label: 'Enable haptic feedback' },
            { type: 'toggle', key: 'rememberLastTab', label: 'Se souvenir du dernier onglet' },
            {
              type: 'slider',
              key: 'hoverDelay',
              label: 'Hover delay',
              min: 0, max: 1, step: 0.05,
              // Affichage a la francaise : virgule + suffixe « s ».
              format: (v) => Number(v).toFixed(2).replace(/0$/, '').replace(/\.$/, '').replace('.', ',') + 's',
            },
          ],
        },
        {
          title: 'Controle gestuel',
          badge: 'Beta',
          rows: [
            { type: 'toggle', key: 'gesturesEnabled', label: 'Activer les gestes' },
            { type: 'toggle', key: 'horizontalGestures', label: 'Change media with horizontal gestures' },
            { type: 'toggle', key: 'closeGesture', label: 'Geste de fermeture' },
            {
              type: 'slider',
              key: 'gestureSensitivity',
              label: 'Sensibilite',
              discrete: ['low', 'medium', 'high'],
              discreteLabels: ['Faible', 'Moyen', 'Eleve'],
            },
          ],
          note: "Glisser deux doigts vers le haut sur l'encoche pour fermer, deux doigts vers le bas pour l'ouvrir lorsque Ouvrir au survol est desactive.",
        },
      ],
    },

    // ----------------------------------------------------------- 2) Apparence
    {
      id: 'appearance',
      label: 'Apparence',
      icon: 'appearance',
      sections: [
        {
          title: 'General',
          rows: [
            { type: 'toggle', key: 'alwaysShowTabs', label: 'Toujours afficher les onglets' },
            { type: 'toggle', key: 'showSettingsIcon', label: 'Show settings icon in notch' },
          ],
        },
        {
          title: 'Media',
          rows: [
            { type: 'toggle', key: 'coloredSpectrogram', label: 'Colored spectrogram' },
            { type: 'toggle', key: 'playerTinting', label: 'Player tinting' },
            { type: 'toggle', key: 'albumBlur', label: "Activer l'effet de flou derriere la pochette d'album" },
            {
              type: 'dropdown',
              key: 'sliderColor',
              label: 'Couleur de la barre de defilement',
              options: [['white', 'White'], ['accent', 'Accent'], ['album', 'Album']],
            },
          ],
        },
        {
          title: "Personnaliser l'animation d'activite musicale",
          badge: 'Coming soon',
          rows: [
            { type: 'toggle', key: 'useMusicVisualizer', label: 'Utiliser le spectrogramme du visualiseur de musique' },
          ],
        },
        {
          title: 'Visualiseurs personnalises (Lottie)',
          rows: [
            { type: 'placeholderBox', label: 'Aucun visualiseur personnalise', footerButtons: ['+', '-'] },
          ],
        },
        {
          title: 'Fonctionnalites supplementaires',
          rows: [
            { type: 'toggle', key: 'enableMirror', label: 'Activer le miroir ennuyeux' },
            {
              type: 'dropdown',
              key: 'mirrorShape',
              label: 'Forme du miroir',
              options: [['square', 'Carre'], ['circle', 'Cercle']],
            },
            { type: 'toggle', key: 'coolFaceAnim', label: 'Show cool face animation while inactive' },
          ],
        },
      ],
    },

    // --------------------------------------------------------------- 3) Media
    {
      id: 'media',
      label: 'Media',
      icon: 'media',
      sections: [
        {
          title: 'Source du Media',
          rows: [
            {
              type: 'dropdown',
              key: 'musicSource',
              label: 'Source de la musique',
              options: [['spotify', 'Spotify'], ['music', 'Musique'], ['nowplaying', 'Lecture en cours']],
            },
          ],
          note: '"Lecture en cours" etait la seule option dans les versions precedentes et fonctionne avec toutes les apps multimedias.',
        },
        {
          title: 'Activite de lecture de media en direct',
          rows: [
            { type: 'toggle', key: 'showMusicLiveActivity', label: 'Show music live activity' },
            { type: 'toggle', key: 'sneakPeekOnChange', label: 'Show sneak peek on playback changes' },
            {
              type: 'dropdown',
              key: 'sneakPeekStyle',
              label: 'Style du Sneak Peek',
              options: [['default', 'Default'], ['inline', 'Inline'], ['minimal', 'Minimal']],
            },
            {
              type: 'stepper',
              key: 'mediaInactivityDelay',
              label: "Delai d'inactivite du media",
              min: 1, max: 30, step: 1, suffix: ' secondes',
            },
            {
              type: 'dropdown',
              key: 'fullScreenBehavior',
              label: 'Full screen behavior',
              badge: 'Beta',
              options: [
                ['mediaAppOnly', 'Hide for media app only'],
                ['always', 'Always hide'],
                ['never', 'Never hide'],
              ],
            },
          ],
        },
        {
          title: 'Controles des medias',
          rows: [
            {
              type: 'mediaLayout',
              key: 'mediaControls',
              slots: 5,
              defaults: ['previous', 'playpause', 'next'],
              palette: [
                ['shuffle', 'Shuffle'],
                ['previous', 'Previous'],
                ['playpause', 'Play/Pause'],
                ['next', 'Next'],
                ['repeat', 'Repeat'],
                ['favorite', 'Favorite'],
              ],
            },
            { type: 'toggle', key: 'showLyrics', label: 'Show lyrics below artist name', badge: 'Beta' },
          ],
          note: 'Customize which controls appear in the music player.',
        },
      ],
    },

    // ----------------------------------------------------------- 4) Calendrier
    {
      id: 'calendar',
      label: 'Calendrier',
      icon: 'calendar',
      sections: [
        {
          title: 'General',
          rows: [
            { type: 'toggle', key: 'showCalendar', label: 'Afficher le calendrier' },
            { type: 'toggle', key: 'hideCompletedReminders', label: 'Cacher les rappels termines' },
            { type: 'toggle', key: 'hideAllDayEvents', label: 'Hide all-day events' },
            { type: 'toggle', key: 'autoScrollNextEvent', label: 'Auto-scroll to next event' },
            { type: 'toggle', key: 'showFullEventTitles', label: 'Always show full event titles' },
          ],
        },
        {
          title: 'Calendriers',
          rows: [
            { type: 'checklist', key: 'calendarsDisabled', source: 'event' },
          ],
        },
        {
          title: 'Rappels',
          rows: [
            { type: 'checklist', key: 'remindersDisabled', source: 'reminder' },
          ],
        },
      ],
    },

    // ---------------------------------------------------------------- 5) HUDs
    {
      id: 'huds',
      label: 'HUDs',
      icon: 'huds',
      sections: [
        {
          title: null,
          rows: [
            {
              type: 'toggle',
              key: 'replaceSystemHUD',
              label: 'Replace system HUD',
              desc: 'Remplace les HUD standard de macOS (volume, luminosite ecran/clavier) par un design personnalise.',
            },
          ],
        },
        {
          title: 'General',
          rows: [
            {
              type: 'dropdown',
              key: 'optionKeyBehaviour',
              label: 'Option key behaviour',
              options: [['openSystemSettings', 'Open System Settings'], ['nothing', 'Ne rien faire']],
            },
            {
              type: 'dropdown',
              key: 'progressBarStyle',
              label: 'Progress bar style',
              options: [['hierarchical', 'Hierarchique'], ['full', 'Plein'], ['thin', 'Fin']],
            },
            { type: 'toggle', key: 'hudGlow', label: "Activer l'effet lumineux" },
            { type: 'toggle', key: 'tintProgressAccent', label: 'Tint progress bar with accent color' },
          ],
        },
        {
          title: 'Open Notch',
          badge: 'Beta',
          rows: [
            { type: 'toggle', key: 'hudInOpenNotch', label: 'Show HUD in open notch' },
            { type: 'toggle', key: 'hudShowPercentOpen', label: 'Show percentage' },
          ],
        },
        {
          title: 'Closed Notch',
          rows: [
            {
              type: 'dropdown',
              key: 'closedHudStyle',
              label: "Style de l'HUD",
              options: [['default', 'Par defaut'], ['compact', 'Compact']],
            },
            { type: 'toggle', key: 'hudShowPercentClosed', label: 'Show percentage' },
          ],
        },
      ],
    },

    // ------------------------------------------------------------- 6) Batterie
    {
      id: 'battery',
      label: 'Batterie',
      icon: 'battery',
      sections: [
        {
          title: 'General',
          rows: [
            { type: 'toggle', key: 'showBatteryIndicator', label: "Afficher l'indicateur de la batterie" },
            { type: 'toggle', key: 'showChargingNotifications', label: "Afficher les notifications d'etat de chargement" },
          ],
        },
        {
          title: 'Informations de la batterie',
          rows: [
            { type: 'toggle', key: 'showBatteryPercent', label: 'Afficher le pourcentage de la batterie' },
            { type: 'toggle', key: 'showChargingIcons', label: "Afficher les icones d'etats de chargement" },
          ],
        },
      ],
    },

    // -------------------------------------------------------------- 7) Etagere
    {
      id: 'shelf',
      label: 'Etagere',
      icon: 'shelf',
      sections: [
        {
          title: 'General',
          rows: [
            { type: 'toggle', key: 'shelfEnabled', label: 'Activer la bibliotheque' },
            { type: 'toggle', key: 'shelfOpenByDefault', label: 'Ouvrir la bibliotheque par defaut si des elements sont presents' },
            { type: 'toggle', key: 'expandedDragArea', label: 'Expanded drag detection area' },
            { type: 'toggle', key: 'copyItemsOnDrag', label: 'Copy items on drag' },
            { type: 'toggle', key: 'removeOnDragOut', label: 'Remove from shelf after dragging' },
          ],
        },
        {
          title: 'Quick Share',
          rows: [
            {
              type: 'dropdown',
              key: 'quickShareService',
              label: 'Quick Share Service',
              options: [['airdrop', 'AirDrop'], ['peer', 'PC pair']],
            },
          ],
          note: "Choisir le service utilise pour partager les fichiers depuis l'etagere.",
        },
      ],
    },

    // ----------------------------------------------------------- 8) Raccourcis
    {
      id: 'shortcuts',
      label: 'Raccourcis',
      icon: 'shortcuts',
      sections: [
        {
          title: 'Media',
          rows: [
            {
              type: 'keybind',
              key: 'shortcutSneakPeek',
              label: 'Activer/desactiver Sneak Peek',
              desc: "Sneak Peek montre le titre du media et l'artiste sous l'encoche pendant quelques secondes.",
            },
            {
              type: 'keybind',
              key: 'shortcutOpenNotch',
              label: 'Activer/desactiver le Notch Ouvert',
            },
          ],
        },
      ],
    },

    // ------------------------------------------------------------- 9) Advanced
    {
      id: 'advanced',
      label: 'Advanced',
      icon: 'advanced',
      sections: [
        {
          title: "Couleur d'accent",
          rows: [
            { type: 'colorAccent', modeKey: 'accentMode', colorKey: 'accentColor' },
          ],
          note: "Choisissez entre la couleur d'accent systeme ou personnalisez-la.",
        },
        {
          title: 'Window Appearance',
          rows: [
            { type: 'toggle', key: 'windowShadow', label: "Activer l'ombre de la fenetre" },
            { type: 'toggle', key: 'cornerRadiusResize', label: 'Redimensionnement du rayon des angles' },
          ],
        },
        {
          title: "Icone d'application",
          badge: 'Coming soon',
          rows: [
            { type: 'appIcon', label: 'Par defaut' },
          ],
        },
        {
          title: 'Window Behavior',
          rows: [
            { type: 'toggle', key: 'expandHoverZone', label: 'Etendre la zone de survol' },
            { type: 'toggle', key: 'hideTitleBar', label: 'Hide title bar' },
            { type: 'toggle', key: 'showNotchOnLockScreen', label: 'Show notch on lock screen' },
            { type: 'toggle', key: 'hideFromScreenRecording', label: 'Hide from screen recording' },
          ],
        },
      ],
    },

    // -------------------------------------------------------- 10) Synchronisation
    {
      id: 'sync',
      label: 'Synchronisation',
      icon: 'sync',
      sections: [
        {
          title: 'Reseau',
          rows: [
            { type: 'info', label: 'Cette machine', value: (ctx) => ctx.info.ip || '—' },
            {
              type: 'info',
              label: 'Pair',
              // Suit les mises a jour temps reel (onPeer) via data-sync-peer.
              value: (ctx) => (ctx.info.peer ? `${ctx.info.peerHost || ''} ${ctx.info.peer}`.trim() : 'aucun'),
              live: 'peer',
            },
            { type: 'button', label: 'Ouvrir le dossier de reception', action: () => window.settings.openInbox() },
            { type: 'button', label: "Vider l'etagere", action: () => window.settings.clearShelf() },
          ],
        },
        {
          title: 'Capture automatique',
          rows: [
            { type: 'toggle', key: 'airdropToShelf', label: 'Copier les AirDrop recus dans l\'etagere' },
            { type: 'toggle', key: 'screenshotToShelf', label: "Copier mes captures d'ecran dans l'etagere" },
          ],
        },
        {
          title: 'Ecrans externes',
          rows: [
            { type: 'toggle', key: 'showExternalNotch', label: "Afficher l'encoche sur les ecrans externes" },
            {
              type: 'toggle',
              key: 'externalAnimate',
              label: "Animer l'encoche externe",
              desc: "Desactive si l'ouverture scintille sur l'ecran externe.",
            },
          ],
        },
      ],
    },

    // ------------------------------------------------------------- 11) A propos
    {
      id: 'about',
      label: 'A propos',
      icon: 'about',
      headerButton: { label: 'Verifier les mises a jour...', action: () => window.settings.checkUpdates() },
      sections: [
        {
          title: 'Infos de la version',
          rows: [
            { type: 'info', label: 'Nom de la version', value: (ctx) => ctx.info.versionName || '—' },
            { type: 'info', label: 'Version', value: (ctx) => ctx.info.version || '—' },
          ],
        },
        {
          title: 'Mises a jour du logiciel',
          rows: [
            { type: 'toggle', key: 'autoCheckUpdates', label: 'Verifier les mises a jour automatiquement' },
            { type: 'toggle', key: 'autoDownloadUpdates', label: 'Telecharger les mises a jour automatiquement' },
            { type: 'button', label: 'GitHub', big: true, action: () => window.settings.openExternal('https://github.com') },
          ],
        },
      ],
      footer: 'Fait avec un lapin par des gens pas si ennuyeux — NotchDrop Sync',
    },
  ];

  window.SETTINGS_PAGES = PAGES;
})();
