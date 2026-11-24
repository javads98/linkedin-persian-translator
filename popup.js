// Popup script for LinkedIn Persian Translator

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

  // Check if we're on LinkedIn
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isLinkedIn = tab && tab.url && (tab.url.includes('linkedin.com'));

  if (!isLinkedIn) {
    notLinkedIn.style.display = 'block';
    mainControls.style.display = 'none';
    return;
  }

  // Load saved settings
  chrome.storage.local.get(['translationEnabled', 'autoTranslate', 'translationEngine'], (data) => {
    autoTranslateToggle.checked = data.autoTranslate || false;
    translationEngine.value = data.translationEngine || 'google';
    updateUI(data.translationEnabled || false);
  });

  // Get current status from content script
  try {
    chrome.tabs.sendMessage(tab.id, { action: 'getStatus' }, (response) => {
      if (chrome.runtime.lastError) {
        // Content script might not be loaded yet
        return;
      }
      if (response) {
        updateUI(response.translationEnabled);
        translatedCount.textContent = toPersianNumber(response.nodeCount || 0);
      }
    });
  } catch (e) {
    // ignore
  }

  // Translate button click
  translateBtn.addEventListener('click', async () => {
    translateBtn.disabled = true;
    translateBtn.textContent = '...⏳ در حال ترجمه';

    chrome.tabs.sendMessage(tab.id, { action: 'toggleTranslation', enabled: true }, (response) => {
      translateBtn.disabled = false;
      if (response && response.success) {
        updateUI(true);
      }
      translateBtn.textContent = '🇮🇷 ترجمه صفحه به فارسی';
    });
  });

  // Revert button click
  revertBtn.addEventListener('click', () => {
    chrome.tabs.sendMessage(tab.id, { action: 'revertTranslation' }, (response) => {
      if (response && response.success) {
        updateUI(false);
      }
    });
  });

  // Auto translate toggle
  autoTranslateToggle.addEventListener('change', () => {
    chrome.storage.local.set({ autoTranslate: autoTranslateToggle.checked });
  });

  // Translation engine change
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
    return String(num).replace(/\d/g, d => persianDigits[d]);
  }

  // Auto-refresh stats
  setInterval(() => {
    if (!isLinkedIn) return;
    try {
      chrome.tabs.sendMessage(tab.id, { action: 'getStatus' }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response) {
          translatedCount.textContent = toPersianNumber(response.nodeCount || 0);
        }
      });
    } catch (e) {
      // ignore
    }
  }, 2000);
});
