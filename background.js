// Background service worker for LinkedIn Persian Translator v1.1.0

// Translation cache
const translationCache = new Map();

// ============================================================
// Context Menu (Right-click)
// ============================================================
chrome.runtime.onInstalled.addListener(() => {
  // Main context menu item
  chrome.contextMenus.create({
    id: 'translate-page-fa',
    title: '🇮🇷 ترجمه صفحه به فارسی',
    contexts: ['page'],
    documentUrlPatterns: ['https://www.linkedin.com/*', 'https://linkedin.com/*']
  });

  // Context menu for selected text
  chrome.contextMenus.create({
    id: 'translate-selection-fa',
    title: '🇮🇷 ترجمه "%s" به فارسی',
    contexts: ['selection'],
    documentUrlPatterns: ['https://www.linkedin.com/*', 'https://linkedin.com/*']
  });

  console.log('[LinkedIn-FA] Context menus created');
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'translate-page-fa') {
    chrome.tabs.sendMessage(tab.id, { action: 'toggleTranslation', enabled: true });
  }
  if (info.menuItemId === 'translate-selection-fa') {
    const selectedText = info.selectionText;
    if (selectedText) {
      translateSingle(selectedText, 'auto').then(translated => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'showTranslationPopup',
          original: selectedText,
          translated: translated
        });
      });
    }
  }
});

// ============================================================
// Omnibox (Address bar)
// ============================================================
chrome.omnibox.onInputStarted.addListener(() => {
  chrome.omnibox.setDefaultSuggestion({
    description: '🇮🇷 ترجمه به فارسی — متن خود را تایپ کنید یا Enter بزنید برای ترجمه صفحه'
  });
});

chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  if (text.trim().length > 0) {
    translateSingle(text.trim(), 'auto').then(translated => {
      suggest([{
        content: translated,
        description: `ترجمه: ${translated}`
      }]);
    }).catch(() => {});
  }
});

chrome.omnibox.onInputEntered.addListener((text, disposition) => {
  // If user just presses Enter without text, translate the page
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url && tabs[0].url.includes('linkedin.com')) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleTranslation', enabled: true });
    }
  });
});

// ============================================================
// Action icon click (address bar icon)
// ============================================================
// When user clicks the extension icon in toolbar, popup opens.
// But we also set badge to show status
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url && tab.url.includes('linkedin.com')) {
    chrome.action.setBadgeText({ tabId, text: 'فا' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#0a66c2' });
  }
});

// ============================================================
// Message handling
// ============================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translate') {
    translateSingle(request.text, request.sourceLang)
      .then(result => sendResponse({ success: true, translated: result }))
      .catch(err => {
        console.error('[LinkedIn-FA BG] translate error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (request.action === 'translateBatch') {
    translateBatch(request.texts, request.sourceLang)
      .then(results => sendResponse({ success: true, translations: results }))
      .catch(err => {
        console.error('[LinkedIn-FA BG] batch error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (request.action === 'getSettings') {
    chrome.storage.local.get(
      ['translationEnabled', 'autoTranslate', 'translationEngine',
       'floatingBtnEnabled', 'floatingBtnPosition', 'floatingBtnSize'],
      (data) => {
        sendResponse({
          translationEnabled: data.translationEnabled || false,
          autoTranslate: data.autoTranslate || false,
          translationEngine: data.translationEngine || 'google',
          floatingBtnEnabled: data.floatingBtnEnabled !== false,
          floatingBtnPosition: data.floatingBtnPosition || 'above-messaging',
          floatingBtnSize: data.floatingBtnSize || 'medium'
        });
      }
    );
    return true;
  }

  if (request.action === 'updateSettings') {
    chrome.storage.local.set(request.settings, () => {
      // Notify all LinkedIn tabs about settings change
      chrome.tabs.query({ url: ['https://www.linkedin.com/*', 'https://linkedin.com/*'] }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { action: 'settingsUpdated', settings: request.settings }).catch(() => {});
        });
      });
      sendResponse({ success: true });
    });
    return true;
  }
});

// ============================================================
// Translation functions
// ============================================================
async function translateSingle(text, sourceLang = 'auto') {
  if (!text || text.trim().length === 0) return text;

  const cacheKey = text.trim();
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  const settings = await getSettings();
  let translated;

  try {
    if (settings.translationEngine === 'mymemory') {
      translated = await callMyMemory(text, sourceLang);
    } else {
      translated = await callGoogle(text, sourceLang);
    }
  } catch (err) {
    console.error('[LinkedIn-FA BG] API error, trying fallback:', err.message);
    try {
      if (settings.translationEngine === 'mymemory') {
        translated = await callGoogle(text, sourceLang);
      } else {
        translated = await callMyMemory(text, sourceLang);
      }
    } catch (err2) {
      console.error('[LinkedIn-FA BG] Fallback also failed:', err2.message);
      return text;
    }
  }

  translationCache.set(cacheKey, translated);
  if (translationCache.size > 8000) {
    const first = translationCache.keys().next().value;
    translationCache.delete(first);
  }

  return translated;
}

async function translateBatch(texts, sourceLang = 'auto') {
  if (!texts || texts.length === 0) return [];

  const results = new Array(texts.length);
  const toTranslate = [];

  for (let i = 0; i < texts.length; i++) {
    const key = texts[i].trim();
    if (translationCache.has(key)) {
      results[i] = translationCache.get(key);
    } else {
      toTranslate.push({ index: i, text: texts[i] });
    }
  }

  if (toTranslate.length > 0) {
    const CONCURRENCY = 5;
    for (let i = 0; i < toTranslate.length; i += CONCURRENCY) {
      const chunk = toTranslate.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async ({ index, text }) => {
          try {
            results[index] = await translateSingle(text, sourceLang);
          } catch {
            results[index] = text;
          }
        })
      );
    }
  }

  return results;
}

async function callGoogle(text, sourceLang) {
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx' +
    '&sl=' + encodeURIComponent(sourceLang) +
    '&tl=fa&dt=t&dj=1' +
    '&q=' + encodeURIComponent(text);

  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Google HTTP ' + resp.status);

  const data = await resp.json();
  let out = '';
  if (data && data.sentences) {
    for (const s of data.sentences) {
      if (s.trans) out += s.trans;
    }
  } else if (data && Array.isArray(data[0])) {
    for (const seg of data[0]) {
      if (seg[0]) out += seg[0];
    }
  }
  return out || text;
}

async function callMyMemory(text, sourceLang) {
  const sl = sourceLang === 'auto' ? 'en' : sourceLang;
  const url =
    'https://api.mymemory.translated.net/get?q=' +
    encodeURIComponent(text) +
    '&langpair=' + sl + '|fa';

  const resp = await fetch(url);
  if (!resp.ok) throw new Error('MyMemory HTTP ' + resp.status);

  const data = await resp.json();
  if (data && data.responseData && data.responseData.translatedText) {
    const t = data.responseData.translatedText;
    if (t === 'NO QUERY SPECIFIED' || t === '' || t === text) return text;
    return t;
  }
  return text;
}

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['translationEngine'], (data) => {
      resolve({ translationEngine: data.translationEngine || 'google' });
    });
  });
}
