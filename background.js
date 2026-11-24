// Background service worker for LinkedIn Persian Translator v2

// Translation cache
const translationCache = new Map();

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
      ['translationEnabled', 'autoTranslate', 'translationEngine'],
      (data) => {
        sendResponse({
          translationEnabled: data.translationEnabled !== false ? (data.translationEnabled || false) : false,
          autoTranslate: data.autoTranslate || false,
          translationEngine: data.translationEngine || 'google'
        });
      }
    );
    return true;
  }
});

// ---- Single translation ----
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
    // Fallback to the other engine
    try {
      if (settings.translationEngine === 'mymemory') {
        translated = await callGoogle(text, sourceLang);
      } else {
        translated = await callMyMemory(text, sourceLang);
      }
    } catch (err2) {
      console.error('[LinkedIn-FA BG] Fallback also failed:', err2.message);
      return text; // Return original on total failure
    }
  }

  // Cache
  translationCache.set(cacheKey, translated);
  if (translationCache.size > 8000) {
    const first = translationCache.keys().next().value;
    translationCache.delete(first);
  }

  return translated;
}

// ---- Batch translation ----
async function translateBatch(texts, sourceLang = 'auto') {
  if (!texts || texts.length === 0) return [];

  const results = new Array(texts.length);
  const toTranslate = []; // { index, text }

  // Check cache
  for (let i = 0; i < texts.length; i++) {
    const key = texts[i].trim();
    if (translationCache.has(key)) {
      results[i] = translationCache.get(key);
    } else {
      toTranslate.push({ index: i, text: texts[i] });
    }
  }

  // Translate uncached — use Google's batch-friendly endpoint
  // Google Translate can handle multiple q params
  if (toTranslate.length > 0) {
    const settings = await getSettings();

    if (settings.translationEngine === 'mymemory') {
      // MyMemory doesn't support batch, translate one by one
      await Promise.all(
        toTranslate.map(async ({ index, text }) => {
          try {
            results[index] = await translateSingle(text, sourceLang);
          } catch {
            results[index] = text;
          }
        })
      );
    } else {
      // Google Translate — send individual requests in parallel with concurrency limit
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
  }

  return results;
}

// ---- Google Translate (free endpoint) ----
async function callGoogle(text, sourceLang) {
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx' +
    '&sl=' + encodeURIComponent(sourceLang) +
    '&tl=fa' +
    '&dt=t' +
    '&dj=1' +           // JSON response
    '&q=' + encodeURIComponent(text);

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error('Google HTTP ' + resp.status);
  }

  const data = await resp.json();
  let out = '';
  if (data && data.sentences) {
    for (const s of data.sentences) {
      if (s.trans) out += s.trans;
    }
  } else if (data && Array.isArray(data[0])) {
    // Fallback: array format
    for (const seg of data[0]) {
      if (seg[0]) out += seg[0];
    }
  }
  return out || text;
}

// ---- MyMemory ----
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

// ---- Settings helper ----
function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['translationEngine'], (data) => {
      resolve({ translationEngine: data.translationEngine || 'google' });
    });
  });
}
