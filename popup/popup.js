const toggleBtn = document.getElementById('toggleBtn');
const savedListEl = document.getElementById('savedList');

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function init() {
  const tab = await getActiveTab();
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'getState' });
    updateButton(response.active);
  } catch {
    updateButton(false);
  }
  loadSavedList();
}

function updateButton(isActive) {
  if (isActive) {
    toggleBtn.textContent = 'Stop Doodling';
    toggleBtn.className = 'toggle-btn on';
  } else {
    toggleBtn.textContent = 'Start Doodling';
    toggleBtn.className = 'toggle-btn off';
  }
}

/* Retry sending toggle message — gives the freshly injected script time to boot */
async function sendToggle(tabId, retries, delay) {
  for (let i = 0; i < retries; i++) {
    try {
      return await chrome.tabs.sendMessage(tabId, { action: 'toggle' });
    } catch {
      if (i < retries - 1) await new Promise(r => setTimeout(r, delay));
    }
  }
  return null;
}

toggleBtn.addEventListener('click', async () => {
  const tab = await getActiveTab();

  /* Block browser-internal pages where scripting is forbidden */
  if (!tab.url || /^(chrome|edge|brave|about|devtools):/.test(tab.url)) {
    showError("Can't doodle on this page");
    return;
  }

  /* 1. Try direct toggle (content script already running) */
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'toggle' });
    updateButton(response.active);
    return;                          // success — done
  } catch { /* content script not there yet — fall through */ }

  /* 2. Inject content script + CSS */
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/content.js']
    });
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['content/content.css']
    });
  } catch {
    showError("Can't doodle on this page");
    return;
  }

  /* 3. Retry toggle — 4 attempts, 250 ms apart (up to 1 s) */
  const response = await sendToggle(tab.id, 4, 250);
  if (response) {
    updateButton(response.active);
  } else {
    showError('Failed — try refreshing the page');
  }
});

function showError(msg) {
  toggleBtn.textContent = msg;
  toggleBtn.className = 'toggle-btn error';
  setTimeout(() => updateButton(false), 2500);
}

/* ── Saved doodles list ── */
function loadSavedList() {
  chrome.storage.local.get(null, (items) => {
    const keys = Object.keys(items).filter(k => k.startsWith('doodle_'));
    savedListEl.innerHTML = '';

    if (keys.length === 0) {
      savedListEl.innerHTML = '<div class="empty-state">No saved doodles yet</div>';
      return;
    }

    keys.slice(0, 10).forEach(key => {
      const urlPart = key.replace('doodle_', '').replace(/_/g, ' ').slice(0, 40);
      const item = document.createElement('div');
      item.className = 'saved-item';
      item.innerHTML = `
        <span class="url" title="${key}">${urlPart}</span>
        <button class="delete-btn" data-key="${key}" title="Delete">✕</button>
      `;
      savedListEl.appendChild(item);
    });

    savedListEl.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const k = e.target.dataset.key;
        chrome.storage.local.remove(k, () => loadSavedList());
      });
    });
  });
}

init();
