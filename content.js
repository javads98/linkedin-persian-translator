// Content script for LinkedIn Persian Translator v2
// Completely rewritten — works at the TEXT NODE level for maximum compatibility

(function () {
  'use strict';

  // ============================================================
  // State
  // ============================================================
  let isTranslating = false;
  let translationEnabled = false;
  let autoTranslate = false;
  let observer = null;
  const translatedTextNodes = new WeakSet();
  const originalTextMap = new WeakMap(); // textNode -> original text
  const BATCH_INTERVAL = 500;
  let pendingRoots = [];
  let batchTimer = null;

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'SVG', 'PATH', 'CIRCLE', 'RECT', 'LINE', 'POLYGON',
    'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'CODE', 'PRE', 'INPUT', 'TEXTAREA',
    'SELECT', 'IFRAME', 'NOSCRIPT', 'TEMPLATE', 'MATH', 'HEAD', 'META',
    'LINK', 'BR', 'HR', 'WBR'
  ]);

  // ============================================================
  // Logging
  // ============================================================
  function log(...args) {
    console.log('[LinkedIn-FA]', ...args);
  }

  // ============================================================
  // Init
  // ============================================================
  function init() {
    log('Extension loaded on', location.href);

    chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
      if (chrome.runtime.lastError) {
        log('Settings error:', chrome.runtime.lastError.message);
        return;
      }
      if (response) {
        translationEnabled = response.translationEnabled;
        autoTranslate = response.autoTranslate;
        log('Settings:', { translationEnabled, autoTranslate });
        if (autoTranslate && translationEnabled) {
          startTranslation();
        }
      }
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'toggleTranslation') {
        if (request.enabled) {
          startTranslation();
        } else {
          revertTranslation();
        }
        sendResponse({ success: true });
      }
      if (request.action === 'revertTranslation') {
        revertTranslation();
        sendResponse({ success: true });
      }
      if (request.action === 'getStatus') {
        sendResponse({
          isTranslating,
          translationEnabled,
          nodeCount: countTranslated()
        });
      }
      return true;
    });

    createFloatingButton();
  }

  function countTranslated() {
    return document.querySelectorAll('[data-lt-done]').length;
  }

  // ============================================================
  // Floating Button
  // ============================================================
  function createFloatingButton() {
    if (document.getElementById('lt-floating-btn')) return;
    const btn = document.createElement('div');
    btn.id = 'lt-floating-btn';
    btn.innerHTML = `
      <div class="lt-btn-inner">
        <span class="lt-btn-icon">🇮🇷</span>
        <span class="lt-btn-text">ترجمه</span>
      </div>
    `;
    btn.addEventListener('click', () => {
      if (isTranslating) return;
      if (translationEnabled) {
        revertTranslation();
      } else {
        startTranslation();
      }
    });
    document.body.appendChild(btn);
  }

  function updateFloatingButton() {
    const btn = document.getElementById('lt-floating-btn');
    if (!btn) return;
    const textEl = btn.querySelector('.lt-btn-text');
    if (translationEnabled) {
      btn.classList.add('lt-active');
      textEl.textContent = 'بازگشت';
    } else {
      btn.classList.remove('lt-active');
      textEl.textContent = 'ترجمه';
    }
    if (isTranslating) {
      btn.classList.add('lt-loading');
      textEl.textContent = '...در حال ترجمه';
    } else {
      btn.classList.remove('lt-loading');
    }
  }

  // ============================================================
  // Core: Collect ALL translatable text nodes from the DOM
  // ============================================================
  function collectTextNodes(root) {
    const textNodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        // Skip if already translated
        if (translatedTextNodes.has(node)) return NodeFilter.FILTER_REJECT;

        // Skip empty / whitespace-only
        const text = node.textContent.trim();
        if (text.length < 2) return NodeFilter.FILTER_REJECT;

        // Skip nodes inside our own UI
        if (node.parentElement && node.parentElement.closest('#lt-floating-btn'))
          return NodeFilter.FILTER_REJECT;

        // Skip nodes inside skip tags
        let parent = node.parentElement;
        while (parent && parent !== root) {
          if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
          // Skip contenteditable (input fields)
          if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
          parent = parent.parentElement;
        }

        // Skip if already mostly Persian/Arabic
        if (isPersian(text)) return NodeFilter.FILTER_REJECT;

        // Skip if it's just a number, URL, email or emoji-only
        if (/^[\d\s.,;:!?@#$%^&*()\-+=\[\]{}|\\/<>~`'"]+$/.test(text))
          return NodeFilter.FILTER_REJECT;
        if (/^https?:\/\//.test(text)) return NodeFilter.FILTER_REJECT;
        if (/^[\w.-]+@[\w.-]+$/.test(text)) return NodeFilter.FILTER_REJECT;

        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }
    return textNodes;
  }

  function isPersian(text) {
    const persianChars = (text.match(/[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/g) || []).length;
    const letters = text.replace(/[\s\d\W]/g, '').length;
    return letters > 0 && persianChars / letters > 0.4;
  }

  // ============================================================
  // Translation logic
  // ============================================================
  async function startTranslation() {
    if (isTranslating) return;
    isTranslating = true;
    translationEnabled = true;
    chrome.storage.local.set({ translationEnabled: true });
    updateFloatingButton();
    log('Starting translation...');

    try {
      await translateRoot(document.body);
      startObserver();
      log('Translation complete. Translated elements:', countTranslated());
    } catch (err) {
      log('Translation error:', err);
    } finally {
      isTranslating = false;
      updateFloatingButton();
    }
  }

  async function translateRoot(root) {
    const textNodes = collectTextNodes(root);
    log(`Found ${textNodes.length} text nodes to translate`);

    if (textNodes.length === 0) return;

    // Group text nodes into batches for the API
    const BATCH_SIZE = 20;
    for (let i = 0; i < textNodes.length; i += BATCH_SIZE) {
      if (!translationEnabled) break;

      const batch = textNodes.slice(i, i + BATCH_SIZE);
      const texts = batch.map(n => n.textContent.trim());

      try {
        const response = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { action: 'translateBatch', texts, sourceLang: 'auto' },
            (resp) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(resp);
              }
            }
          );
        });

        if (response && response.success && response.translations) {
          for (let j = 0; j < batch.length; j++) {
            const node = batch[j];
            const translated = response.translations[j];
            if (translated && translated !== texts[j]) {
              // Save original
              originalTextMap.set(node, node.textContent);
              translatedTextNodes.add(node);

              // Replace text content
              // Preserve leading/trailing whitespace from original
              const leading = node.textContent.match(/^\s*/)[0];
              const trailing = node.textContent.match(/\s*$/)[0];
              node.textContent = leading + translated + trailing;

              // Mark the closest block-level parent for RTL
              const blockParent = getBlockParent(node);
              if (blockParent && !blockParent.hasAttribute('data-lt-done')) {
                blockParent.setAttribute('data-lt-done', '1');
                // Save original direction
                if (!blockParent.hasAttribute('data-lt-orig-dir')) {
                  blockParent.setAttribute('data-lt-orig-dir', blockParent.style.direction || '');
                  blockParent.setAttribute('data-lt-orig-align', blockParent.style.textAlign || '');
                }
                blockParent.style.direction = 'rtl';
                blockParent.style.textAlign = 'right';
              }
            }
          }
          log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: translated ${batch.length} nodes`);
        } else {
          log('Batch failed:', response);
        }
      } catch (err) {
        log('Batch error:', err.message);
      }

      // Delay between batches to avoid rate-limiting
      if (i + BATCH_SIZE < textNodes.length) {
        await sleep(150);
      }
    }
  }

  function getBlockParent(textNode) {
    let el = textNode.parentElement;
    if (!el) return null;
    // Walk up to find a reasonable container (not a tiny inline span)
    const inlineTags = new Set(['SPAN', 'A', 'STRONG', 'B', 'EM', 'I', 'U', 'SMALL', 'SUB', 'SUP', 'ABBR', 'MARK']);
    let attempts = 0;
    while (el && inlineTags.has(el.tagName) && attempts < 5) {
      el = el.parentElement;
      attempts++;
    }
    return el;
  }

  // ============================================================
  // Revert
  // ============================================================
  function revertTranslation() {
    log('Reverting translation...');
    translationEnabled = false;
    isTranslating = false;
    stopObserver();

    // Restore all text nodes
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (originalTextMap.has(node)) {
        node.textContent = originalTextMap.get(node);
        originalTextMap.delete(node);
        translatedTextNodes.delete(node);
      }
    }

    // Restore direction on block parents
    document.querySelectorAll('[data-lt-done]').forEach(el => {
      el.style.direction = el.getAttribute('data-lt-orig-dir') || '';
      el.style.textAlign = el.getAttribute('data-lt-orig-align') || '';
      el.removeAttribute('data-lt-done');
      el.removeAttribute('data-lt-orig-dir');
      el.removeAttribute('data-lt-orig-align');
    });

    chrome.storage.local.set({ translationEnabled: false });
    updateFloatingButton();
    log('Reverted.');
  }

  // ============================================================
  // Observer for dynamic content
  // ============================================================
  function startObserver() {
    if (observer) return;

    observer = new MutationObserver((mutations) => {
      if (!translationEnabled || isTranslating) return;

      let hasNew = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          for (const added of mutation.addedNodes) {
            if (added.nodeType === Node.ELEMENT_NODE && !added.closest('#lt-floating-btn')) {
              pendingRoots.push(added);
              hasNew = true;
            }
          }
        }
      }

      if (hasNew) {
        if (batchTimer) clearTimeout(batchTimer);
        batchTimer = setTimeout(processPendingRoots, BATCH_INTERVAL);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Watch for scroll-triggered lazy loading
    let scrollTimer = null;
    window.addEventListener('scroll', () => {
      if (!translationEnabled || isTranslating) return;
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        pendingRoots.push(document.body);
        processPendingRoots();
      }, 1000);
    }, { passive: true });

    // Watch for LinkedIn SPA navigation
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        log('URL changed to', lastUrl);
        if (translationEnabled) {
          setTimeout(() => {
            pendingRoots.push(document.body);
            processPendingRoots();
          }, 2000);
        }
      }
    }, 1000);

    log('Observer started');
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (batchTimer) {
      clearTimeout(batchTimer);
      batchTimer = null;
    }
    pendingRoots = [];
  }

  async function processPendingRoots() {
    if (!translationEnabled || isTranslating || pendingRoots.length === 0) return;
    isTranslating = true;
    updateFloatingButton();

    const roots = [...pendingRoots];
    pendingRoots = [];

    try {
      for (const root of roots) {
        if (root.isConnected) {
          await translateRoot(root);
        }
      }
    } catch (err) {
      log('Process pending error:', err);
    } finally {
      isTranslating = false;
      updateFloatingButton();
    }
  }

  // ============================================================
  // Utility
  // ============================================================
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================================
  // Start
  // ============================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
