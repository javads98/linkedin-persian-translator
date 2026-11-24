// Popup script for LinkedIn Persian Translator v1.1.0

document.addEventListener('DOMContentLoaded', async () => {
  const translateBtn = document.getElementById('translate-btn');
  const revertBtn = document.getElementById('revert-btn');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const statBadge = document.getElementById('stat-badge');
  const autoTranslateToggle = document.getElementById('auto-translate');
  const translationEngine = document.getElementById('translation-engine');
  const btnEnabled = document.getElementById('btn-enabled');
  const btnPosition = document.getElementById('btn-position');
  const btnSize = document.getElementById('btn-size');
  const notLinkedIn = document.getElementById('not-linkedin');
  const mainControls = document.getElementById('main-controls');

  // Check if on LinkedIn
  let tab;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs[0];
  } catch (e) {}

  const isLinkedIn = tab && tab.url && tab.url.includes('linkedin.com');

  if (!isLinkedIn) {
    notLinkedIn.style.display = 'block';
    mainControls.style.display = 'none';
    return;
  }

  // Load settings
  chrome.storage.local.get(
    ['translationEnabled', 'autoTranslate', 'translationEngine',
     'floatingBtnEnabled', 'floatingBtnPosition', 'floatingBtnSize'],
    (data) => {
      autoTranslateToggle.checked = data.autoTranslate || false;
      translationEngine.value = data.translationEngine || 'google';
      btnEnabled.checked = data.floatingBtnEnabled !== false;
      btnPosition.value = data.floatingBtnPosition || 'above-messaging';
      btnSize.value = data.floatingBtnSize || 'medium';
      updateUI(data.translationEnabled || false);
    }
  );

  // Get status
  function refreshStatus() {
    try {
      chrome.tabs.sendMessage(tab.id, { action: 'getStatus' }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response) {
          updateUI(response.translationEnabled);
          statBadge.textContent = toPersianNumber(response.nodeCount || 0) + ' ترجمه';
        }
      });
    } catch (e) {}
  }
  refreshStatus();

  // Translate button
  translateBtn.addEventListener('click', () => {
    translateBtn.disabled = true;
    translateBtn.textContent = '⏳ در حال ترجمه...';
    chrome.tabs.sendMessage(tab.id, { action: 'toggleTranslation', enabled: true }, (response) => {
      translateBtn.disabled = false;
      translateBtn.textContent = '🇮🇷 ترجمه صفحه به فارسی';
      if (response && response.success) updateUI(true);
    });
  });

  // Revert button
  revertBtn.addEventListener('click', () => {
    chrome.tabs.sendMessage(tab.id, { action: 'revertTranslation' }, (response) => {
      if (response && response.success) updateUI(false);
    });
  });

  // ---- Settings handlers ----
  autoTranslateToggle.addEventListener('change', () => {
    saveSetting('autoTranslate', autoTranslateToggle.checked);
  });

  translationEngine.addEventListener('change', () => {
    saveSetting('translationEngine', translationEngine.value);
  });

  btnEnabled.addEventListener('change', () => {
    saveSetting('floatingBtnEnabled', btnEnabled.checked);
  });

  btnPosition.addEventListener('change', () => {
    saveSetting('floatingBtnPosition', btnPosition.value);
  });

  btnSize.addEventListener('change', () => {
    saveSetting('floatingBtnSize', btnSize.value);
  });

  function saveSetting(key, value) {
    const settings = {};
    settings[key] = value;
    chrome.storage.local.set(settings);
    // Also notify content script
    chrome.runtime.sendMessage({ action: 'updateSettings', settings });
  }

  // ---- UI ----
  function updateUI(isEnabled) {
    if (isEnabled) {
      statusDot.classList.add('active');
      statusText.textContent = 'فعال ✅';
      translateBtn.style.display = 'none';
      revertBtn.style.display = 'block';
    } else {
      statusDot.classList.remove('active');
      statusText.textContent = 'غیرفعال';
      translateBtn.style.display = 'block';
      revertBtn.style.display = 'none';
      statBadge.textContent = '۰ ترجمه';
    }
  }

  function toPersianNumber(num) {
    const d = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return String(num).replace(/\d/g, c => d[c]);
  }

  setInterval(refreshStatus, 2000);
});
