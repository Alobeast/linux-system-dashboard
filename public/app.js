const POLL_INTERVAL_MS = 2000;

const cpuValue = document.getElementById('cpu-value');
const memoryValue = document.getElementById('memory-value');
const memoryDetail = document.getElementById('memory-detail');
const uptimeValue = document.getElementById('uptime-value');
const statusEl = document.getElementById('status');
const processList = document.getElementById('process-list');
const storageValue = document.getElementById('storage-value');
const storageDetail = document.getElementById('storage-detail');
const tempValue = document.getElementById('temp-value');
const fanDetail = document.getElementById('fan-detail');

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function updateDashboard(stats) {
  cpuValue.textContent = `${stats.cpuPercent}%`;
  applyStatusClass(cpuValue, stats.cpuPercent, 70, 90);

  memoryValue.textContent = `${stats.memory.usedPercent}%`;
  memoryDetail.textContent = `${stats.memory.usedMB} / ${stats.memory.totalMB} MB`;
  applyStatusClass(memoryValue, stats.memory.usedPercent, 75, 90);

  storageValue.textContent = `${stats.storage.usedPercent}%`;
  storageDetail.textContent = `${stats.storage.usedMB} / ${stats.storage.totalMB} MB`;
  applyStatusClass(storageValue, stats.storage.usedPercent, 80, 95);

  uptimeValue.textContent = formatUptime(stats.uptimeSeconds);
  renderProcesses(stats.topProcesses);

  statusEl.textContent = '';
  statusEl.classList.remove('error');

  if (stats.cpuTemp !== null) {
    tempValue.textContent = `${stats.cpuTemp}°C`;
    applyStatusClass(tempValue, stats.cpuTemp, 70, 85);
  } else {
    tempValue.textContent = 'N/A';
  }

  if (stats.fanSpeeds && stats.fanSpeeds.length > 0) {
    fanDetail.textContent = stats.fanSpeeds
      .map((fan) => `${fan.rpm} RPM`)
      .join(' / ');
  } else {
    fanDetail.textContent = 'No fan data';
  }
}

function renderProcesses(processes) {
  if (!processes || processes.length === 0) {
    processList.innerHTML = '<tr><td class="process-empty">No process above the threshold</td></tr>';
    return;
  }

  processList.innerHTML = processes.map((p) => `
    <tr>
      <td class="process-name">${escapeHtml(p.name)} <span class="process-pid">#${p.pid}</span></td>
      <td class="process-mem">${p.memoryMB} MB</td>
    </tr>
  `).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showError() {
  statusEl.textContent = 'Connection lost — retrying...';
  statusEl.classList.add('error');
}

async function fetchStats() {
  try {
    const response = await fetch('/api/stats');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const stats = await response.json();
    updateDashboard(stats);
  } catch (err) {
    showError();
  }
}

// Applies a color class to an element based on value thresholds
function applyStatusClass(element, value, warnAt, badAt) {
  element.classList.remove('status-good', 'status-warn', 'status-bad');

  if (value >= badAt) {
    element.classList.add('status-bad');
  } else if (value >= warnAt) {
    element.classList.add('status-warn');
  } else {
    element.classList.add('status-good');
  }
}

fetchStats();
setInterval(fetchStats, POLL_INTERVAL_MS);