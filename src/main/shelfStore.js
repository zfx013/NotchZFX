// Persistance du shelf, calquee sur ShelfPersistenceService.swift :
// JSON pretty-printed, sauvegarde a chaque mutation, nettoyage des items invalides au chargement.
const fs = require('fs');
const path = require('path');

class ShelfStore {
  constructor(dir) {
    this.file = path.join(dir, 'shelf-items.json');
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(raw)) return [];
      // cleanupInvalidItems : on ecarte les fichiers qui n'existent plus
      return raw.filter((it) => it && it.path && fs.existsSync(it.path));
    } catch (_) {
      return [];
    }
  }

  save(items) {
    try {
      fs.writeFileSync(this.file, JSON.stringify(items, null, 2));
    } catch (err) {
      console.warn('sauvegarde shelf echouee:', err.message);
    }
  }
}

module.exports = { ShelfStore };
