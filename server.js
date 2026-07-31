const express = require('express');
const os = require('os');
const { execFile } = require('child_process');
const util = require('util');

const execFileAsync = util.promisify(execFile);

const app = express();
const PORT = 3000;
const TOP_PROCESSES_MIN_MB = 50;
const TOP_PROCESSES_MAX_COUNT = 15; // safety cap, rarely hit in practice

app.use(express.static('public'));

function getCpuSnapshot() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;

  for (const cpu of cpus) {
    for (const type in cpu.times) {
      total += cpu.times[type];
    }
    idle += cpu.times.idle;
  }

  return { idle, total };
}

function getCpuUsagePercent(start, end) {
  const idleDiff = end.idle - start.idle;
  const totalDiff = end.total - start.total;
  const usage = 1 - idleDiff / totalDiff;
  return Math.round(usage * 1000) / 10;
}

function getMemoryInfo() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;

  return {
    totalMB: Math.round(total / 1024 / 1024),
    usedMB: Math.round(used / 1024 / 1024),
    freeMB: Math.round(free / 1024 / 1024),
    usedPercent: Math.round((used / total) * 1000) / 10
  };
}

// Parses `ps` output and returns the top memory-consuming processes,
// aggregated by executable name (e.g. multiple "apache2" workers become one row)
async function getTopProcesses() {
  const { stdout } = await execFileAsync('ps', [
    '-eo', 'pid=,rss=,args='
  ]);

  const lines = stdout.trim().split('\n');

  const processes = lines.map((line) => {
    const trimmed = line.trim();
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) return null;

    const [, pid, rssKB, fullCommand] = match;
    const executablePath = fullCommand.split(' ')[0];
    const name = executablePath.split('/').pop();

    return { pid, name, memoryMB: Math.round(parseInt(rssKB, 10) / 1024) };
  }).filter(Boolean);

  const grouped = new Map();
  for (const p of processes) {
    const existing = grouped.get(p.name);
    if (existing) {
      existing.memoryMB += p.memoryMB;
      existing.count += 1;
    } else {
      grouped.set(p.name, { pid: p.pid, name: p.name, memoryMB: p.memoryMB, count: 1 });
    }
  }

  return Array.from(grouped.values())
    .filter((p) => p.memoryMB >= TOP_PROCESSES_MIN_MB)
    .sort((a, b) => b.memoryMB - a.memoryMB)
    .slice(0, TOP_PROCESSES_MAX_COUNT);
}

function getCpuUsageAsync() {
  return new Promise((resolve) => {
    const start = getCpuSnapshot();
    setTimeout(() => {
      const end = getCpuSnapshot();
      resolve(getCpuUsagePercent(start, end));
    }, 200);
  });
}

// Parses `df` output for the root filesystem
async function getStorageInfo() {
  const { stdout } = await execFileAsync('df', ['-kP', '/']);
  const line = stdout.trim().split('\n')[1]; // skip header line
  const parts = line.trim().split(/\s+/);

  const totalKB = parseInt(parts[1], 10);
  const usedKB = parseInt(parts[2], 10);
  const freeKB = parseInt(parts[3], 10);

  return {
    mountPoint: '/',
    totalMB: Math.round(totalKB / 1024),
    usedMB: Math.round(usedKB / 1024),
    freeMB: Math.round(freeKB / 1024),
    usedPercent: Math.round((usedKB / totalKB) * 1000) / 10
  };
}

// Reads CPU temperature and fan speeds via `sensors -j` (lm-sensors)
async function getThermalInfo() {
  try {
    const { stdout } = await execFileAsync('sensors', ['-j']);
    const data = JSON.parse(stdout);

    const cpuTemp = data['coretemp-isa-0000']?.['Package id 0']?.temp1_input ?? null;

    const fans = data['applesmc-isa-0300'];
    const fanSpeeds = fans
      ? Object.entries(fans)
          .filter(([key]) => key.trim().toLowerCase().includes('side'))
          .map(([label, values]) => ({
            label: label.trim(),
            rpm: Math.round(Object.values(values)[0])
          }))
      : [];

    return {
      cpuTemp: cpuTemp !== null ? Math.round(cpuTemp * 10) / 10 : null,
      fanSpeeds
    };
  } catch (err) {
    console.error('Failed to read sensors:', err);
    return { cpuTemp: null, fanSpeeds: [] };
  }
}

app.get('/api/stats', async (req, res) => {
  try {
    const [cpuPercent, topProcesses, storage, thermal] = await Promise.all([
      getCpuUsageAsync(),
      getTopProcesses(),
      getStorageInfo(),
      getThermalInfo()
    ]);

    res.json({
      cpuPercent,
      cpuTemp: thermal.cpuTemp,
      fanSpeeds: thermal.fanSpeeds,
      memory: getMemoryInfo(),
      storage,
      uptimeSeconds: Math.round(os.uptime()),
      topProcesses
    });
  } catch (err) {
    console.error('Error collecting stats:', err);
    res.status(500).json({ error: 'Failed to collect stats' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});