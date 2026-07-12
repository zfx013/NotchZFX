// Equivalents SVG des SF Symbols utilises par Boring Notch.
// (TabSelectionView: house.fill / tray.fill ; BoringHeader: gear ;
//  ShelfView: tray.and.arrow.down ; FileShareView: square.and.arrow.up ;
//  NotchHomeView: backward.fill / play.fill / pause.fill / forward.fill)
const ICONS = {
  'house.fill':
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.1l8.6 7.4a1 1 0 01.4.8V20a1 1 0 01-1 1h-5.2a.6.6 0 01-.6-.6V15a2.2 2.2 0 00-4.4 0v5.4a.6.6 0 01-.6.6H4a1 1 0 01-1-1v-8.7a1 1 0 01.4-.8L12 3.1z"/></svg>',
  'tray.fill':
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.6 4h14.8a1.6 1.6 0 011.5 1.1l2 6.4c.07.2.1.42.1.63V18a2 2 0 01-2 2H3a2 2 0 01-2-2v-5.87c0-.21.03-.42.1-.63l2-6.4A1.6 1.6 0 014.6 4zm.7 2l-1.7 5.5H8a4 4 0 008 0h4.4L18.7 6H5.3z"/></svg>',
  gear:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94a7.07 7.07 0 000-1.88l2.03-1.58a.5.5 0 00.12-.64l-1.92-3.32a.5.5 0 00-.61-.22l-2.39.96a7.05 7.05 0 00-1.63-.94l-.36-2.54A.5.5 0 0013.89 2h-3.78a.5.5 0 00-.5.42l-.36 2.54c-.59.24-1.13.56-1.63.94l-2.39-.96a.5.5 0 00-.61.22L2.7 8.48a.5.5 0 00.12.64l2.03 1.58a7.07 7.07 0 000 1.88L2.82 14.6a.5.5 0 00-.12.64l1.92 3.32c.13.22.39.31.61.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54a.5.5 0 00.5.42h3.78a.5.5 0 00.5-.42l.36-2.54c.59-.24 1.13-.56 1.63-.94l2.39.96c.22.09.48 0 .61-.22l1.92-3.32a.5.5 0 00-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1115.5 12 3.5 3.5 0 0112 15.5z"/></svg>',
  'tray.and.arrow.down':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v8.5"/><path d="M8.5 8L12 11.5 15.5 8"/><path d="M3.5 13.5h4a4.5 4.5 0 009 0h4V18a2 2 0 01-2 2H5.5a2 2 0 01-2-2v-4.5z" fill="currentColor" stroke="none"/></svg>',
  'square.and.arrow.up':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3.5"/><path d="M8.5 7L12 3.5 15.5 7"/><path d="M8 9.5H6.5a2 2 0 00-2 2v7a2 2 0 002 2h11a2 2 0 002-2v-7a2 2 0 00-2-2H16"/></svg>',
  'backward.fill':
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.8 12L21 5.8v12.4L11.8 12zM2.5 12l9.2-6.2v12.4L2.5 12z"/></svg>',
  'play.fill':
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.3a.8.8 0 011.2-.7l12 7a.8.8 0 010 1.4l-12 7A.8.8 0 017 18.3V4.3z"/></svg>',
  'pause.fill':
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4.5h3.4v15H6zM14.6 4.5H18v15h-3.4z"/></svg>',
  'forward.fill':
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.2 12L3 18.2V5.8L12.2 12zM21.5 12l-9.2 6.2V5.8L21.5 12z"/></svg>',
  'music.note':
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.5 17.3V5.6a.8.8 0 01.63-.78l9-2A.8.8 0 0120.1 3.6v11.2a3.05 3.05 0 11-1.6-2.69V6.6l-7.4 1.64v10.56a3.05 3.05 0 11-1.6-2.69z"/></svg>',
  bolt:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 2L5 13.5h5.5L10 22l8.5-11.5H13L13.5 2z"/></svg>',
  airdrop:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="butt"><path d="M10.35 14.36 A3.3 3.3 0 1 1 13.65 14.36"/><path d="M8.78 17.09 A6.45 6.45 0 1 1 15.22 17.09"/><path d="M7.2 19.81 A9.6 9.6 0 1 1 16.8 19.81"/><circle cx="12" cy="11.5" r="1.15" fill="currentColor" stroke="none"/></svg>',
  'speaker.wave':
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 4.7a.8.8 0 00-1.32-.6L5.9 7.4H3.2a1.2 1.2 0 00-1.2 1.2v6.8a1.2 1.2 0 001.2 1.2h2.7l3.78 3.3A.8.8 0 0011 19.3V4.7z"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M15.5 9a4.2 4.2 0 010 6M18.2 6.6a7.6 7.6 0 010 10.8"/></svg>',
  'speaker.slash':
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 4.7a.8.8 0 00-1.32-.6L5.9 7.4H3.2a1.2 1.2 0 00-1.2 1.2v6.8a1.2 1.2 0 001.2 1.2h2.7l3.78 3.3A.8.8 0 0011 19.3V4.7z"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M15.5 9.5l5 5M20.5 9.5l-5 5"/></svg>',
  'sun.max':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none"/><path d="M12 2.2v2.4M12 19.4v2.4M2.2 12h2.4M19.4 12h2.4M5 5l1.7 1.7M17.3 17.3L19 19M19 5l-1.7 1.7M6.7 17.3L5 19"/></svg>',
  'pc.display':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M9 20.5h6M12 16.5v4"/></svg>',
  xmark:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  laptopcomputer:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="5" width="15" height="9.5" rx="1.6"/><path d="M2.5 18h19M9.5 18l.5-1.2h4l.5 1.2"/></svg>',
  desktopcomputer:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="1.8"/><path d="M9 20h6M12 16v4"/></svg>',
  'paperplane.fill':
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.4 3.1a.7.7 0 00-.77-.15L3.3 9.86c-.66.26-.6 1.22.09 1.4l5.6 1.47 1.47 5.6c.18.69 1.14.75 1.4.09l6.9-17.34a.7.7 0 00-.16-.77l-.6.6zM10.6 12.2l6.9-4.7-4.7 6.9-.6-1.6-1.6-.6z"/></svg>',
};

function icon(name, cls) {
  const span = document.createElement('span');
  span.className = 'icon' + (cls ? ' ' + cls : '');
  span.innerHTML = ICONS[name] || '';
  return span;
}
