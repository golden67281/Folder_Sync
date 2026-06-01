// Helper script: kills any process using port 3000, then exits
const { execSync } = require('child_process');
try {
  const out = execSync('netstat -ano', { encoding: 'utf8' });
  const lines = out.split('\n');
  const pids = new Set();
  for (const line of lines) {
    if (line.includes(':3000 ') && line.includes('LISTENING')) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && pid !== '0') pids.add(pid);
    }
  }
  if (pids.size === 0) {
    console.log('Port 3000 is free.');
  } else {
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        console.log('Stopped process PID ' + pid);
      } catch {}
    }
    // Wait for port to release
    const wait = ms => new Promise(r => setTimeout(r, ms));
    (async () => { await wait(1500); console.log('Port 3000 freed.'); })();
  }
} catch (e) {
  console.log('Port check skipped:', e.message);
}
