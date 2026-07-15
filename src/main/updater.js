'use strict';
// Mise à jour intégrée depuis les Releases GitHub (repo PRIVÉ).
// Le téléchargement des binaires nécessite un token GitHub fine-grained en LECTURE
// SEULE (permission "Contents: read" sur ce seul repo), injecté au build dans
// `updater-token.json` (jamais committé). Sans token -> updater désactivé.
const { app } = require('electron');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFileSync } = require('child_process');

const REPO = 'zfx013/NotchZFX';

function token() {
  if (process.env.NOTCHZFX_UPDATE_TOKEN) return process.env.NOTCHZFX_UPDATE_TOKEN;
  try { return require('./updater-token.json').token || null; } catch (_) { return null; }
}
function hasToken() { return !!token(); }

// GET JSON sur api.github.com avec auth.
function apiJson(urlPath) {
  return new Promise((resolve, reject) => {
    const tok = token();
    const req = https.request({
      host: 'api.github.com', path: urlPath, method: 'GET',
      headers: {
        'User-Agent': 'NotchZFX-Updater',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(tok ? { Authorization: 'Bearer ' + tok } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode + ' ' + buf.toString().slice(0, 160)));
        try { resolve(JSON.parse(buf.toString())); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

// Compare deux versions "x.y.z" -> >0 si a plus récent que b.
function cmpVer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

// Nom de l'asset attendu pour CETTE plateforme/arch.
function assetName(ver) {
  if (process.platform === 'darwin') return `NotchZFX-${ver}-mac.zip`;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `NotchZFX-${ver}-win-${arch}.zip`;
}

async function checkForUpdate() {
  if (!hasToken()) return { available: false, reason: 'no-token' };
  const rel = await apiJson(`/repos/${REPO}/releases/latest`);
  const latest = (rel.tag_name || '').replace(/^v/, '');
  const current = app.getVersion();
  if (!latest || cmpVer(latest, current) <= 0) return { available: false, current, latest };
  const name = assetName(latest);
  const asset = (rel.assets || []).find((a) => a.name === name);
  return {
    available: !!asset, current, latest, notes: rel.body || '', htmlUrl: rel.html_url,
    asset: asset ? { id: asset.id, name: asset.name, size: asset.size } : null,
  };
}

// Télécharge un asset privé : l'URL d'API renvoie un 302 vers S3 ; on NE renvoie PAS
// l'en-tête Authorization sur la redirection (sinon S3 refuse).
function downloadAsset(assetId, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const tok = token();
    let redirects = 0;
    const go = (opts) => {
      const req = https.request(opts, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          if (++redirects > 5) return reject(new Error('trop de redirections'));
          res.resume();
          const u = new URL(res.headers.location);
          return go({ host: u.host, path: u.pathname + u.search, method: 'GET', headers: { 'User-Agent': 'NotchZFX-Updater' } });
        }
        if (res.statusCode >= 400) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let got = 0;
        const ws = fs.createWriteStream(destPath);
        res.on('data', (c) => { got += c.length; if (onProgress && total) onProgress(got / total); });
        res.pipe(ws);
        ws.on('finish', () => ws.close(() => resolve(destPath)));
        ws.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(120000, () => req.destroy(new Error('timeout')));
      req.end();
    };
    go({
      host: 'api.github.com', path: `/repos/${REPO}/releases/assets/${assetId}`, method: 'GET',
      headers: { 'User-Agent': 'NotchZFX-Updater', Accept: 'application/octet-stream', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
    });
  });
}

// Remplace l'app par la version téléchargée puis relance (script détaché qui attend
// la fermeture de l'app en cours). Renvoie après avoir lancé le swapper.
function install(zipPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nzfx-upd-'));
  if (process.platform === 'darwin') {
    execFileSync('/usr/bin/ditto', ['-x', '-k', zipPath, tmp]);
    const newApp = path.join(tmp, 'NotchZFX.app');
    if (!fs.existsSync(newApp)) throw new Error('NotchZFX.app introuvable dans le zip');
    const appPath = path.resolve(app.getPath('exe'), '..', '..', '..'); // .../NotchZFX.app
    const script = path.join(tmp, 'swap.sh');
    fs.writeFileSync(script, [
      '#!/bin/bash',
      `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done`,
      'sleep 0.6',
      `rm -rf "${appPath}"`,
      `/usr/bin/ditto "${newApp}" "${appPath}"`,
      `/usr/bin/xattr -dr com.apple.quarantine "${appPath}" 2>/dev/null`,
      'sleep 0.3',
      `open "${appPath}"`,
      `rm -rf "${tmp}"`,
      '',
    ].join('\n'), { mode: 0o755 });
    spawn('/bin/bash', [script], { detached: true, stdio: 'ignore' }).unref();
  } else {
    // Chaines PowerShell entre quotes simples : une apostrophe dans un chemin (ex.
    // utilisateur "D'Angelo") casse toute la commande -> on double les apostrophes.
    const psq = (s) => String(s).replace(/'/g, "''");
    const exe = process.execPath;
    const appDir = path.dirname(exe);
    const extract = path.join(tmp, 'x');
    const backupName = path.basename(appDir) + '.old-' + process.pid;
    const statusFile = path.join(app.getPath('userData'), 'update-status.json');
    const ps = path.join(tmp, 'swap.ps1');
    // Swap robuste et DETACHE (l'extraction se fait apres la fermeture de l'app -> pas de
    // gel de l'UI) : rename-aside de l'ancien dossier (avec retry si des DLL sont encore
    // verrouillees), copie du nouveau via robocopy (retries integres), restauration si
    // echec, et ecriture d'un STATUT relu au prochain demarrage.
    fs.writeFileSync(ps, [
      '$ErrorActionPreference = "Stop"',
      `$exe = '${psq(exe)}'`,
      `$appDir = '${psq(appDir)}'`,
      `$parent = Split-Path -Parent $appDir`,
      `$backup = Join-Path $parent '${psq(backupName)}'`,
      `$extract = '${psq(extract)}'`,
      `$zip = '${psq(zipPath)}'`,
      `$status = '${psq(statusFile)}'`,
      'function Write-Status($ok, $msg) {',
      '  try { $o = @{ ok = $ok; msg = $msg } | ConvertTo-Json -Compress; Set-Content -LiteralPath $status -Value $o -Encoding UTF8 } catch {}',
      '}',
      'try {',
      `  try { Wait-Process -Id ${process.pid} -Timeout 30 } catch {}`,
      '  Start-Sleep -Milliseconds 800',
      '  Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force',
      '  if (-not (Test-Path (Join-Path $extract "NotchZFX.exe"))) { throw "NotchZFX.exe absent du zip" }',
      '  $moved = $false',
      '  for ($i = 0; $i -lt 20; $i++) {',
      '    try { Rename-Item -LiteralPath $appDir -NewName $backup -ErrorAction Stop; $moved = $true; break }',
      '    catch { Start-Sleep -Milliseconds 500 }',
      '  }',
      '  if (-not $moved) { throw "Dossier de l\'app verrouille (fichiers encore ouverts)" }',
      '  robocopy $extract $appDir /E /NFL /NDL /NJH /NJS /R:3 /W:1 | Out-Null',
      '  if ($LASTEXITCODE -ge 8) { throw "Copie echouee (robocopy $LASTEXITCODE)" }',
      '  Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue',
      '  Write-Status $true "ok"',
      '  Start-Process -FilePath $exe',
      '} catch {',
      '  if (Test-Path $backup) {',
      '    if (Test-Path $appDir) { Remove-Item -LiteralPath $appDir -Recurse -Force -ErrorAction SilentlyContinue }',
      '    Rename-Item -LiteralPath $backup -NewName (Split-Path -Leaf $appDir) -ErrorAction SilentlyContinue',
      '  }',
      '  Write-Status $false $_.Exception.Message',
      '  Start-Process -FilePath $exe',
      '} finally {',
      `  Remove-Item -LiteralPath '${psq(tmp)}' -Recurse -Force -ErrorAction SilentlyContinue`,
      '}',
      '',
    ].join('\r\n'));
    spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', ps],
      { detached: true, stdio: 'ignore' }).unref();
  }
}

// Statut de la derniere tentative de MAJ (Windows) ecrit par le swapper detache ;
// l'app le lit au demarrage pour signaler un echec silencieux. Renvoie null si absent.
function takeUpdateStatus() {
  try {
    const f = path.join(app.getPath('userData'), 'update-status.json');
    if (!fs.existsSync(f)) return null;
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    fs.unlink(f, () => {});
    return data;
  } catch (_) { return null; }
}

module.exports = { hasToken, checkForUpdate, downloadAsset, install, takeUpdateStatus };
