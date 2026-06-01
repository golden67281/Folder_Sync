const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const chokidar = require('chokidar');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const qrcode = require('qrcode');
const cors = require('cors');
const { exec } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const PORT = 3000;
const CONFIG_FILE = path.join(__dirname, 'config.json');
const DEFAULT_SYNC_FOLDER = path.join(__dirname, '..', 'sync-folder');

// ---------- Config ----------
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (cfg.syncFolder && fs.existsSync(cfg.syncFolder)) return cfg;
    }
  } catch {}
  return { syncFolder: DEFAULT_SYNC_FOLDER, folderName: 'sync-folder' };
}
function saveConfig(cfg) {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2)); } catch {}
}

let config = loadConfig();
if (!fs.existsSync(DEFAULT_SYNC_FOLDER)) fs.mkdirSync(DEFAULT_SYNC_FOLDER, { recursive: true });
if (!config.syncFolder || !fs.existsSync(config.syncFolder)) {
  config = { syncFolder: DEFAULT_SYNC_FOLDER, folderName: 'sync-folder' };
  saveConfig(config);
}

// ---------- Middleware ----------
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- IP helpers ----------
function getAllIPs() {
  const interfaces = os.networkInterfaces();
  const results = [];
  const skip = [/vmware/i, /virtualbox/i, /vbox/i, /hyper-v/i, /loopback/i, /bluetooth/i, /local area connection\*/i, /isatap/i, /teredo/i];
  for (const [name, addrs] of Object.entries(interfaces)) {
    const isVirtual = skip.some(p => p.test(name));
    for (const iface of addrs) {
      if (iface.family !== 'IPv4' || iface.internal || iface.address.startsWith('169.254.')) continue;
      results.push({ name, address: iface.address, isVirtual });
    }
  }
  results.sort((a, b) => {
    const s = r => /wi.?fi/i.test(r.name) ? 0 : /ethernet/i.test(r.name) && !r.isVirtual ? 1 : r.isVirtual ? 10 : 5;
    return s(a) - s(b);
  });
  return results;
}
function getLocalIP() { const ips = getAllIPs(); return ips.length ? ips[0].address : 'localhost'; }

// ---------- Path safety ----------
function safePath(relPath) {
  const base = config.syncFolder;
  if (!base) return null;
  const resolved = relPath ? path.resolve(base, relPath) : base;
  return resolved.startsWith(base) ? resolved : null;
}

// ---------- Directory contents ----------
function getDirContents(relPath) {
  const abs = safePath(relPath || '');
  if (!abs || !fs.existsSync(abs)) return { folders: [], files: [] };
  try {
    const folders = [], files = [];
    for (const name of fs.readdirSync(abs)) {
      if (name.startsWith('.') || name === 'Thumbs.db' || name === 'desktop.ini') continue;
      try {
        const fp = path.join(abs, name);
        const st = fs.statSync(fp);
        if (st.isDirectory()) folders.push({ name, type: 'folder', modified: st.mtime.toISOString() });
        else files.push({ name, type: 'file', size: st.size, modified: st.mtime.toISOString(), ext: path.extname(name).toLowerCase().replace('.', '') });
      } catch {}
    }
    folders.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    return { folders, files };
  } catch { return { folders: [], files: [] }; }
}
function getFiles() { return getDirContents('').files; }

// ---------- File watcher ----------
let watcher = null;
function startWatcher(folderPath) {
  if (watcher) { watcher.close().catch(() => {}); watcher = null; }
  if (!folderPath || !fs.existsSync(folderPath)) return;
  watcher = chokidar.watch(folderPath, {
    ignored: /(^|[\/\\])(\.|Thumbs\.db|desktop\.ini)/,
    persistent: true, ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
  });
  watcher
    .on('add', fp => { const n = path.basename(fp); console.log('Added:', n); io.emit('files-update', getFiles()); io.emit('notify', { type: 'add', message: 'New file: ' + n }); })
    .on('change', fp => { const n = path.basename(fp); io.emit('files-update', getFiles()); io.emit('notify', { type: 'change', message: 'Updated: ' + n }); })
    .on('unlink', fp => { const n = path.basename(fp); console.log('Deleted:', n); io.emit('files-update', getFiles()); io.emit('notify', { type: 'delete', message: 'Deleted: ' + n }); })
    .on('error', err => console.error('Watcher error:', err.message));
}
startWatcher(config.syncFolder);

// ---------- Routes: Config ----------
app.get('/api/config', (req, res) => res.json({ syncFolder: config.syncFolder, folderName: config.folderName }));

app.post('/api/config/folder', (req, res) => {
  const { folderPath } = req.body;
  if (!folderPath) return res.status(400).json({ error: 'No path' });
  const resolved = path.resolve(folderPath.trim());
  if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'Folder not found: ' + resolved });
  if (!fs.statSync(resolved).isDirectory()) return res.status(400).json({ error: 'Not a folder' });
  config.syncFolder = resolved;
  config.folderName = path.basename(resolved);
  saveConfig(config);
  startWatcher(resolved);
  io.emit('folder-changed', { folderName: config.folderName, syncFolder: config.syncFolder });
  io.emit('files-update', getFiles());
  res.json({ success: true, folderName: config.folderName, syncFolder: config.syncFolder });
});

// ---------- Route: Windows Folder Picker ----------
app.post('/api/browse-folder', (req, res) => {
  const tmpScript = path.join(os.tmpdir(), 'foldersync_picker.ps1');
  const cur = (config.syncFolder || '').replace(/'/g, "''");
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "$owner = New-Object System.Windows.Forms.Form",
    "$owner.TopMost = $true",
    "$owner.StartPosition = 'Manual'",
    "$owner.Location = New-Object System.Drawing.Point(0,0)",
    "$owner.Size = New-Object System.Drawing.Size(1,1)",
    "$owner.Show()",
    "$owner.BringToFront()",
    "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$d.Description = 'Select a folder to sync with your phone'",
    "$d.RootFolder = 'MyComputer'",
    "$d.ShowNewFolderButton = $true",
    `if ('${cur}' -ne '' -and (Test-Path '${cur}')) { $d.SelectedPath = '${cur}' }`,
    "$r = $d.ShowDialog($owner)",
    "$owner.Dispose()",
    "if ($r -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath } else { Write-Output '' }"
  ].join('\n');
  try { fs.writeFileSync(tmpScript, script, 'utf8'); } catch (e) { return res.status(500).json({ error: e.message }); }
  exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpScript}"`, { timeout: 120000 }, (err, stdout) => {
    try { fs.unlinkSync(tmpScript); } catch {}
    const selected = (stdout || '').trim();
    if (!selected) return res.json({ cancelled: true });
    if (!fs.existsSync(selected)) return res.status(404).json({ error: 'Not found: ' + selected });
    config.syncFolder = selected;
    config.folderName = path.basename(selected);
    saveConfig(config);
    startWatcher(selected);
    io.emit('folder-changed', { folderName: config.folderName, syncFolder: config.syncFolder });
    io.emit('files-update', getFiles());
    res.json({ success: true, folderName: config.folderName, syncFolder: config.syncFolder });
  });
});

// ---------- Route: Browse directory ----------
app.get('/api/browse', (req, res) => {
  const relPath = (req.query.path || '').replace(/\\/g, '/').replace(/^\//, '');
  const abs = safePath(relPath);
  if (!abs) return res.status(403).json({ error: 'Invalid path' });
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Not found' });
  res.json({ path: relPath, ...getDirContents(relPath) });
});

// ---------- Route: Create folder ----------
app.post('/api/mkdir', (req, res) => {
  const { path: relPath, name } = req.body;
  if (!name || /[<>:"|?*\\/]/.test(name)) return res.status(400).json({ error: 'Invalid folder name' });
  const parentAbs = safePath(relPath || '');
  if (!parentAbs) return res.status(403).json({ error: 'Invalid path' });
  const newDir = path.join(parentAbs, name);
  if (!newDir.startsWith(config.syncFolder)) return res.status(403).json({ error: 'Access denied' });
  try { fs.mkdirSync(newDir, { recursive: true }); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- Route: Download ----------
app.get('/api/download', (req, res) => {
  const relPath = (req.query.path || '').replace(/\\/g, '/');
  const abs = safePath(relPath);
  if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'Not found' });
  res.download(abs, path.basename(abs));
});

// ---------- Route: View inline (Preview) ----------
app.get('/api/view', (req, res) => {
  const relPath = (req.query.path || '').replace(/\\/g, '/');
  const abs = safePath(relPath);
  if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(abs);
});

// ---------- Route: Delete ----------
app.delete('/api/delete', (req, res) => {
  const relPath = (req.query.path || '').replace(/\\/g, '/');
  const abs = safePath(relPath);
  if (!abs || !abs.startsWith(config.syncFolder)) return res.status(403).json({ error: 'Access denied' });
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Not found' });
  try {
    const st = fs.statSync(abs);
    if (st.isDirectory()) fs.rmSync(abs, { recursive: true, force: true });
    else fs.unlinkSync(abs);
    console.log('Deleted:', relPath);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- Route: Upload files ----------
app.post('/api/upload', (req, res) => {
  const relPath = (req.query.path || '').replace(/\\/g, '/');
  const targetAbs = safePath(relPath) || config.syncFolder;
  if (!targetAbs || !targetAbs.startsWith(config.syncFolder)) return res.status(403).json({ error: 'Access denied' });
  if (!fs.existsSync(targetAbs)) try { fs.mkdirSync(targetAbs, { recursive: true }); } catch {}

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, targetAbs),
      filename: (req, file, cb) => cb(null, Buffer.from(file.originalname, 'latin1').toString('utf8'))
    }),
    limits: { fileSize: 500 * 1024 * 1024 }
  });
  upload.array('files', 50)(req, res, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files' });
    console.log('Uploaded', req.files.length, 'file(s) to:', targetAbs);
    res.json({ success: true, files: req.files.map(f => f.filename) });
  });
});

// ---------- Route: Upload entire FOLDER from phone ----------
// Phone sends: files[] + relpaths[] (parallel arrays, relpaths = webkitRelativePath)
// Server recreates the full folder tree at the destination
app.post('/api/upload-folder', (req, res) => {
  const destRelPath = (req.query.path || '').replace(/\\/g, '/');
  const destAbs = safePath(destRelPath) || config.syncFolder;
  if (!destAbs || !destAbs.startsWith(config.syncFolder)) return res.status(403).json({ error: 'Access denied' });

  // Use memory storage so we can pair files with their relpaths from req.body
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 200 * 1024 * 1024, files: 2000 }
  });

  upload.array('files', 2000)(req, res, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files received' });

    let relpaths = req.body.relpaths || [];
    if (!Array.isArray(relpaths)) relpaths = [relpaths];

    let written = 0;
    const errors = [];

    req.files.forEach((file, i) => {
      // relFilePath example: "MyPhotos/2024/pic.jpg"
      const relFilePath = (relpaths[i] || file.originalname).replace(/\\/g, '/');
      const segments = relFilePath.split('/').filter(Boolean);
      const destFile = path.join(destAbs, ...segments);

      // Security: stay inside sync folder
      if (!destFile.startsWith(config.syncFolder)) { errors.push('Blocked: ' + relFilePath); return; }

      try {
        fs.mkdirSync(path.dirname(destFile), { recursive: true });
        fs.writeFileSync(destFile, file.buffer);
        written++;
      } catch (e) { errors.push(relFilePath + ': ' + e.message); }
    });

    const folderName = (relpaths[0] || '').split('/')[0] || 'folder';
    console.log(`Folder upload: "${folderName}" — ${written} files saved to: ${destAbs}`);
    res.json({ success: true, written, folderName, errors: errors.length ? errors : undefined });
  });
});

// ---------- Legacy compat ----------
app.get('/api/files', (req, res) => res.json(getFiles()));
app.get('/api/files/:fn', (req, res) => {
  const fp = path.join(config.syncFolder, decodeURIComponent(req.params.fn));
  if (!fp.startsWith(config.syncFolder) || !fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  res.download(fp);
});
app.delete('/api/files/:fn', (req, res) => {
  const fp = path.join(config.syncFolder, decodeURIComponent(req.params.fn));
  if (!fp.startsWith(config.syncFolder) || !fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  try { fs.unlinkSync(fp); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/info', (req, res) => res.json({ syncFolder: config.syncFolder, folderName: config.folderName, ip: getLocalIP(), port: PORT }));

// ---------- Socket.io ----------
let sharedText = '';

io.on('connection', socket => {
  console.log('Device connected:', socket.id);
  socket.emit('files-update', getFiles());
  socket.emit('folder-changed', { folderName: config.folderName, syncFolder: config.syncFolder });
  socket.emit('text-update', sharedText);
  
  socket.on('share-text', text => {
    sharedText = text || '';
    socket.broadcast.emit('text-update', sharedText); // broadcast to other devices
  });

  socket.on('disconnect', () => console.log('Device disconnected:', socket.id));
});

// ---------- Start ----------
const allIPs = getAllIPs();
const IP = getLocalIP();
const URL = `http://${IP}:${PORT}`;

async function printBanner() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║      FOLDER SYNC SERVER STARTED          ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Laptop: http://localhost:${PORT}             ║`);
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  Phone URLs:                             ║');
  allIPs.forEach(({ address }) => {
    const mark = address === IP ? ' <- USE THIS' : '';
    console.log(`║   http://${address}:${PORT}${mark}`);
  });
  console.log(`╠══════════════════════════════════════════╣`);
  console.log(`║  Syncing: ${config.folderName}`);
  console.log('╚══════════════════════════════════════════╝\n');
  try { console.log(await qrcode.toString(URL, { type: 'terminal', small: true })); } catch {}
  console.log(`Laptop: http://localhost:${PORT}\n`);
}

function startListening(retries) {
  retries = retries || 0;

  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      if (retries < 5) {
        console.log(`Port ${PORT} busy — retrying in 3 seconds... (attempt ${retries + 1}/5)`);
        server.close();
        setTimeout(() => startListening(retries + 1), 3000);
      } else {
        console.error(`Could not start: port ${PORT} is still in use after 5 retries.`);
        console.error('Please close any other program using port 3000 and try again.');
        process.exit(1);
      }
    } else {
      console.error('Server error:', err.message);
      process.exit(1);
    }
  });

  server.listen(PORT, '0.0.0.0', () => printBanner());
}

startListening();

process.on('SIGINT', () => { if (watcher) watcher.close(); server.close(() => process.exit(0)); });
