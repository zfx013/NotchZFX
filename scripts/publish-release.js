#!/usr/bin/env node
// Publie la Release GitHub de la version courante et uploade les binaires de dist/.
// Idempotent (réutilise la release si le tag existe, remplace les assets homonymes).
//
//   GITHUB_TOKEN=ghp_xxx node scripts/publish-release.js
//
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.REPO || 'zfx013/NotchZFX';
const ROOT = path.resolve(__dirname, '..');
const ver = require(path.join(ROOT, 'package.json')).version;
const TAG = 'v' + ver;
const dist = path.join(ROOT, 'dist');
const assets = [
  `NotchZFX-${ver}-mac.zip`,
  `NotchZFX-${ver}-win-x64.zip`,
  `NotchZFX-${ver}-win-arm64.zip`,
];
const notes = [
  `## NotchZFX ${TAG}`, '',
  'Bibliothèque commune de fichiers sur le réseau local — Mac ⇄ PC. Cette version durcit la sécurité, fiabilise les transferts et l’updater Windows, et ajoute plusieurs commodités.', '',
  '**Sécurité & vie privée**',
  '- Le partage automatique ne vise plus que **tes appareils appairés** (même code d’appairage) : tes fichiers/captures ne partent plus vers un inconnu du réseau.',
  '- Fichiers reçus mis en **quarantaine** (Gatekeeper / SmartScreen), **plafond de taille** par fichier, ordre de vidage distant authentifié.', '',
  '**Fiabilité**',
  '- Un transfert interrompu ne laisse plus de fichier « fantôme » figé.',
  '- Envoi **parallèle** : un appareil lent ne bloque plus les autres.',
  '- **Updater Windows** réécrit (copie robuste + restauration si échec + rapport d’erreur) : fini les mises à jour qui échouent en silence.', '',
  '**Nouveautés**',
  '- **Suppression d’un fichier propagée** à tous les appareils ; suppression au clavier + croix au survol.',
  '- **Raccourci global** d’ouverture de l’encoche et **couleur d’accent** personnalisable.',
  '- Retour visuel « Partagé ✓ » au dépôt, moins de scintillement dans l’étagère.', '',
  'Binaires non signés — voir le README pour l’ouverture (Gatekeeper / SmartScreen).',
].join('\n');
const H = {Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'};

async function main() {
  if (!TOKEN) throw new Error('Définis GITHUB_TOKEN (Personal Access Token, scope repo)');
  let r = await fetch(`https://api.github.com/repos/${REPO}/releases`, {
    method: 'POST', headers: {...H, 'Content-Type': 'application/json'},
    body: JSON.stringify({tag_name: TAG, name: `NotchZFX ${TAG}`, body: notes, draft: false, prerelease: false}),
  });
  let rel = await r.json();
  if (!rel.id) {
    const ex = await (await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${TAG}`, {headers: H})).json();
    if (ex.id) rel = ex; else throw new Error('création/récupération release impossible : ' + JSON.stringify(rel).slice(0, 200));
  }
  console.log('release', TAG, '->', rel.html_url);
  const existing = await (await fetch(`https://api.github.com/repos/${REPO}/releases/${rel.id}/assets`, {headers: H})).json();
  for (const name of assets) {
    const p = path.join(dist, name);
    if (!fs.existsSync(p)) { console.log('!! manquant', name, '(reconstruis les binaires)'); continue; }
    const dup = Array.isArray(existing) && existing.find((e) => e.name === name);
    if (dup) await fetch(`https://api.github.com/repos/${REPO}/releases/assets/${dup.id}`, {method: 'DELETE', headers: H});
    const buf = fs.readFileSync(p);
    process.stdout.write(`upload ${name} (${(buf.length / 1048576).toFixed(0)} Mo)... `);
    const up = await fetch(`https://uploads.github.com/repos/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`, {
      method: 'POST', headers: {...H, 'Content-Type': 'application/zip'}, body: buf, duplex: 'half',
    });
    console.log(up.status === 201 ? 'OK' : 'échec ' + up.status);
  }
  console.log('Fait :', rel.html_url);
}
main().catch((e) => { console.error('ERREUR :', e.message); process.exit(1); });
