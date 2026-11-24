// Background service worker for LinkedIn Persian Translator

// Translation cache to avoid re-translating the same text
const translationCache = new Map();

// Rate limiting
let requestQueue = [];
let isProcessingQueue = false;
const RATE_LIMIT_DELAY = 100; // ms between requests

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translate') {
    handleTranslation(request.text, request.sourceLang)
      .then(result => sendResponse({ success: true, translated: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for async response
  }

  if (request.action === 'translateBatch') {
    handleBatchTranslation(request.texts, request.sourceLang)
      .then(results => sendResponse({ success: true, translations: results }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'getSettings') {
    chrome.storage.local.get(['translationEnabled', 'autoTranslate', 'translationEngine'], (data) => {
      sendResponse({
        translationEnabled: data.translationEnabled !== false,
        autoTranslate: data.autoTranslate || false,
        translationEngine: data.translationEngine || 'google'
      });
    });
    return true;
  }
});

async function handleTranslation(text, sourceLang = 'auto') {
  if (!text || text.trim().length === 0) return text;

  // Check cache first
  const cacheKey = `${sourceLang}:${text}`;
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  const settings = await getSettings();
  let translated;

  if (settings.translationEngine === 'mymemory') {
    translated = await translateWithMyMemory(text, sourceLang);
  } else {
    translated = await translateWithGoogle(text, sourceLang);
  }

  // Cache the result
  translationCache.set(cacheKey, translated);

  // Limit cache size
  if (translationCache.size > 5000) {
    const firstKey = translationCache.keys().next().value;
    translationCache.delete(firstKey);
  }

  return translated;
}

async function handleBatchTranslation(texts, sourceLang = 'auto') {
  const results = [];
  const uncachedTexts = [];
  const uncachedIndices = [];

  // Check cache for each text
  for (let i = 0; i < texts.length; i++) {
    const cacheKey = `${sourceLang}:${texts[i]}`;
    if (translationCache.has(cacheKey)) {
      results[i] = translationCache.get(cacheKey);
    } else {
      uncachedTexts.push(texts[i]);
      uncachedIndices.push(i);
    }
  }

  // Translate uncached texts in batches
  const BATCH_SIZE = 10;
  for (let i = 0; i < uncachedTexts.length; i += BATCH_SIZE) {
    const batch = uncachedTexts.slice(i, i + BATCH_SIZE);
    const batchTranslations = await Promise.all(
      batch.map(text => handleTranslation(text, sourceLang))
    );

    for (let j = 0; j < batchTranslations.length; j++) {
      const originalIndex = uncachedIndices[i + j];
      results[originalIndex] = batchTranslations[j];
    }

    // Small delay between batches
    if (i + BATCH_SIZE < uncachedTexts.length) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
    }
  }

  return results;
}

async function translateWithGoogle(text, sourceLang) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=fa&dt=t&q=${encodeURIComponent(text)}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Google Translate error: ${response.status}`);
  }

  const data = await response.json();
  let translated = '';
  if (data && data[0]) {
    for (const segment of data[0]) {
      if (segment[0]) {
        translated += segment[0];
      }
    }
  }
  return translated || text;
}

async function translateWithMyMemory(text, sourceLang) {
  const langPair = sourceLang === 'auto' ? 'en|fa' : `${sourceLang}|fa`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langPair}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`MyMemory error: ${response.status}`);
  }

  const data = await response.json();
  if (data && data.responseData && data.responseData.translatedText) {
    return data.responseData.translatedText;
  }
  return text;
}

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['translationEngine'], (data) => {
      resolve({
        translationEngine: data.translationEngine || 'google'
      });
    });
  });
}
