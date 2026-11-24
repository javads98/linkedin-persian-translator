// Popup script for LinkedIn Persian Translator v2

document.addEventListener('DOMContentLoaded', async () => {
  const translateBtn = document.getElementById('translate-btn');
  const revertBtn = document.getElementById('revert-btn');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const translatedCount = document.getElementById('translated-count');
  const autoTranslateToggle = document.getElementById('auto-translate');
  const translationEngine = document.getElementById('translation-engine');
  const notLinkedIn = document.getElementById('not-linkedin');
  const mainControls = document.getElementById('main-controls');

  // Check if on LinkedIn
  let tab;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs[0];
  } catch (e) {
    console.error('Tab query error:', e);
  }

  const isLinkedIn = tab && tab.url && tab.url.includes('linkedin.com');

  if (!isLinkedIn) {
    notLinkedIn.style.display = 'block';
    mainControls.style.display = 'none';
    return;
  }

  // Load settings
  chrome.storage.local.get(
    ['translationEnabled', 'autoTranslate', 'translationEngine'],
    (data) => {
      autoTranslateToggle.checked = data.autoTranslate || false;
      translationEngine.value = data.translationEngine || 'google';
      updateUI(data.translationEnabled || false);
    }
  );

  // Get status from content script
  function refreshStatus() {
    try {
      chrome.tabs.sendMessage(tab.id, { action: 'getStatus' }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response) {
          updateUI(response.translationEnabled);
          translatedCount.textContent = toPersianNumber(response.nodeCount || 0);
        }
      });
    } catch (e) {}
  }
  refreshStatus();

  // Translate button
  translateBtn.addEventListener('click', () => {
    translateBtn.disabled = true;
    translateBtn.textContent = '⏳ در حال ترجمه...';

    chrome.tabs.sendMessage(
      tab.id,
      { action: 'toggleTranslation', enabled: true },
      (response) => {
        translateBtn.disabled = false;
        translateBtn.textContent = '🇮🇷 ترجمه صفحه به فارسی';
        if (response && response.success) {
          updateUI(true);
        }
      }
    );
  });

  // Revert button
  revertBtn.addEventListener('click', () => {
    chrome.tabs.sendMessage(
      tab.id,
      { action: 'revertTranslation' },
      (response) => {
        if (response && response.success) {
          updateUI(false);
        }
      }
    );
  });

  // Settings
  autoTranslateToggle.addEventListener('change', () => {
    chrome.storage.local.set({ autoTranslate: autoTranslateToggle.checked });
  });

  translationEngine.addEventListener('change', () => {
    chrome.storage.local.set({ translationEngine: translationEngine.value });
  });

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
      translatedCount.textContent = '۰';
    }
  }

  function toPersianNumber(num) {
    const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return String(num).replace(/\d/g, (d) => persianDigits[d]);
  }

  // Auto-refresh
  setInterval(refreshStatus, 2000);
});
