// Content script for LinkedIn Persian Translator v1.1.0
// Features: text node translation, floating button (customizable), selection popup, above-messaging positioning

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
  const originalTextMap = new WeakMap();
  const BATCH_INTERVAL = 500;
  let pendingRoots = [];
  let batchTimer = null;

  // Button settings
  let floatingBtnEnabled = true;
  let floatingBtnPosition = 'above-messaging'; // 'above-messaging', 'bottom-left', 'bottom-right', 'top-left', 'top-right', 'custom'
  let floatingBtnSize = 'medium'; // 'small', 'medium', 'large'
  let customBtnPosition = { x: null, y: null }; // For drag

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'SVG', 'PATH', 'CIRCLE', 'RECT', 'LINE', 'POLYGON',
    'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'CODE', 'PRE', 'INPUT', 'TEXTAREA',
    'SELECT', 'IFRAME', 'NOSCRIPT', 'TEMPLATE', 'MATH', 'HEAD', 'META',
    'LINK', 'BR', 'HR', 'WBR'
  ]);

  function log(...args) {
    console.log('[LinkedIn-FA]', ...args);
  }

  // ============================================================
  // Init
  // ============================================================
  function init() {
    log('Extension v1.1.0 loaded on', location.href);

    chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
      if (chrome.runtime.lastError) {
        log('Settings error:', chrome.runtime.lastError.message);
        return;
      }
      if (response) {
        translationEnabled = response.translationEnabled;
        autoTranslate = response.autoTranslate;
        floatingBtnEnabled = response.floatingBtnEnabled !== false;
        floatingBtnPosition = response.floatingBtnPosition || 'above-messaging';
        floatingBtnSize = response.floatingBtnSize || 'medium';
        log('Settings:', response);

        if (floatingBtnEnabled) {
          createFloatingButton();
        }

        if (autoTranslate && translationEnabled) {
          startTranslation();
        }
      }
    });

    // Listen for messages
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
      if (request.action === 'showTranslationPopup') {
        showSelectionPopup(request.original, request.translated);
        sendResponse({ success: true });
      }
      if (request.action === 'settingsUpdated') {
        applySettings(request.settings);
        sendResponse({ success: true });
      }
      return true;
    });
  }

  function applySettings(settings) {
    if (settings.floatingBtnEnabled !== undefined) {
      floatingBtnEnabled = settings.floatingBtnEnabled;
      const btn = document.getElementById('lt-floating-btn');
      if (floatingBtnEnabled && !btn) {
        createFloatingButton();
      } else if (!floatingBtnEnabled && btn) {
        btn.remove();
      }
    }
    if (settings.floatingBtnPosition) {
      floatingBtnPosition = settings.floatingBtnPosition;
      positionFloatingButton();
    }
    if (settings.floatingBtnSize) {
      floatingBtnSize = settings.floatingBtnSize;
      applyButtonSize();
    }
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
      <div class="lt-btn-inner" id="lt-btn-inner">
        <span class="lt-btn-icon">🇮🇷</span>
        <span class="lt-btn-text" id="lt-btn-text">ترجمه</span>
      </div>
    `;

    btn.addEventListener('click', (e) => {
      if (btn.classList.contains('lt-dragging')) return;
      if (isTranslating) return;
      if (translationEnabled) {
        revertTranslation();
      } else {
        startTranslation();
      }
    });

    // Make draggable
    makeDraggable(btn);

    document.body.appendChild(btn);
    positionFloatingButton();
    applyButtonSize();
    updateFloatingButton();
  }

  function positionFloatingButton() {
    const btn = document.getElementById('lt-floating-btn');
    if (!btn) return;

    // Reset all positioning
    btn.style.top = '';
    btn.style.bottom = '';
    btn.style.left = '';
    btn.style.right = '';

    if (customBtnPosition.x !== null && floatingBtnPosition === 'custom') {
      btn.style.left = customBtnPosition.x + 'px';
      btn.style.top = customBtnPosition.y + 'px';
      return;
    }

    switch (floatingBtnPosition) {
      case 'above-messaging':
        positionAboveMessaging(btn);
        break;
      case 'bottom-left':
        btn.style.bottom = '24px';
        btn.style.left = '24px';
        break;
      case 'bottom-right':
        btn.style.bottom = '24px';
        btn.style.right = '24px';
        break;
      case 'top-left':
        btn.style.top = '80px';
        btn.style.left = '24px';
        break;
      case 'top-right':
        btn.style.top = '80px';
        btn.style.right = '24px';
        break;
      default:
        btn.style.bottom = '24px';
        btn.style.left = '24px';
    }
  }

  function positionAboveMessaging(btn) {
    // Find LinkedIn messaging button
    const messagingBar = document.querySelector('.msg-overlay-bubble-header') ||
                         document.querySelector('[data-control-name="overlay.messaging_compose_new"]') ||
                         document.querySelector('.msg-overlay-list-bubble') ||
                         document.querySelector('.msg-overlay-container');

    // Find the messaging icon at bottom-right
    const msgElement = document.querySelector('.application-outlet .msg-overlay-bubble-header') ||
                       document.querySelector('.msg-overlay-list-bubble--is-minimized') ||
                       document.querySelector('.msg-overlay-list-bubble');

    if (msgElement) {
      const rect = msgElement.getBoundingClientRect();
      btn.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
      btn.style.right = (window.innerWidth - rect.right) + 'px';
    } else {
      // Default: above where messaging usually is (bottom-right)
      btn.style.bottom = '60px';
      btn.style.right = '24px';
    }
  }

  function applyButtonSize() {
    const btn = document.getElementById('lt-floating-btn');
    if (!btn) return;

    btn.classList.remove('lt-size-small', 'lt-size-medium', 'lt-size-large');
    btn.classList.add('lt-size-' + floatingBtnSize);
  }

  function makeDraggable(el) {
    let isDragging = false;
    let startX, startY, origX, origY;
    let dragDistance = 0;

    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      isDragging = true;
      dragDistance = 0;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      origX = rect.left;
      origY = rect.top;
      el.style.transition = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      dragDistance = Math.sqrt(dx * dx + dy * dy);

      if (dragDistance > 5) {
        el.classList.add('lt-dragging');
        const newX = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, origX + dx));
        const newY = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, origY + dy));
        el.style.left = newX + 'px';
        el.style.top = newY + 'px';
        el.style.bottom = 'auto';
        el.style.right = 'auto';
      }
    });

    document.addEventListener('mouseup', (e) => {
      if (!isDragging) return;
      isDragging = false;
      el.style.transition = '';

      if (dragDistance > 5) {
        // Save custom position
        const rect = el.getBoundingClientRect();
        customBtnPosition = { x: rect.left, y: rect.top };
        floatingBtnPosition = 'custom';
        chrome.storage.local.set({
          floatingBtnPosition: 'custom',
          floatingBtnCustomX: rect.left,
          floatingBtnCustomY: rect.top
        });

        // Remove dragging class after a tick to prevent click
        setTimeout(() => el.classList.remove('lt-dragging'), 100);
      } else {
        el.classList.remove('lt-dragging');
      }
    });
  }

  function updateFloatingButton() {
    const btn = document.getElementById('lt-floating-btn');
    if (!btn) return;
    const textEl = btn.querySelector('.lt-btn-text');

    if (isTranslating) {
      btn.classList.add('lt-loading');
      btn.classList.remove('lt-active');
      textEl.textContent = 'در حال ترجمه...';
    } else if (translationEnabled) {
      btn.classList.add('lt-active');
      btn.classList.remove('lt-loading');
      textEl.textContent = 'برگشت به حالت پیشفرض';
    } else {
      btn.classList.remove('lt-active', 'lt-loading');
      textEl.textContent = 'ترجمه';
    }
  }

  // ============================================================
  // Selection Translation Popup (for right-click translate)
  // ============================================================
  function showSelectionPopup(original, translated) {
    // Remove any existing popup
    const existing = document.getElementById('lt-selection-popup');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.id = 'lt-selection-popup';
    popup.innerHTML = `
      <div class="lt-popup-header">
        <span>🇮🇷 ترجمه به فارسی</span>
        <button class="lt-popup-close" id="lt-popup-close">✕</button>
      </div>
      <div class="lt-popup-original">${escapeHtml(original)}</div>
      <div class="lt-popup-arrow">⬇️</div>
      <div class="lt-popup-translated">${escapeHtml(translated)}</div>
      <button class="lt-popup-copy" id="lt-popup-copy">📋 کپی ترجمه</button>
    `;

    document.body.appendChild(popup);

    // Position near selection or center
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      popup.style.top = Math.min(rect.bottom + 10, window.innerHeight - popup.offsetHeight - 20) + 'px';
      popup.style.left = Math.max(10, Math.min(rect.left, window.innerWidth - popup.offsetWidth - 20)) + 'px';
    } else {
      popup.style.top = '50%';
      popup.style.left = '50%';
      popup.style.transform = 'translate(-50%, -50%)';
    }

    // Close button
    popup.querySelector('#lt-popup-close').addEventListener('click', () => popup.remove());

    // Copy button
    popup.querySelector('#lt-popup-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(translated).then(() => {
        popup.querySelector('#lt-popup-copy').textContent = '✅ کپی شد!';
        setTimeout(() => popup.remove(), 1000);
      });
    });

    // Close on click outside
    setTimeout(() => {
      document.addEventListener('click', function handler(e) {
        if (!popup.contains(e.target)) {
          popup.remove();
          document.removeEventListener('click', handler);
        }
      });
    }, 100);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================================
  // Core: Text Node Collection
  // ============================================================
  function collectTextNodes(root) {
    const textNodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (translatedTextNodes.has(node)) return NodeFilter.FILTER_REJECT;
        const text = node.textContent.trim();
        if (text.length < 2) return NodeFilter.FILTER_REJECT;

        if (node.parentElement && node.parentElement.closest('#lt-floating-btn, #lt-selection-popup'))
          return NodeFilter.FILTER_REJECT;

        let parent = node.parentElement;
        while (parent && parent !== root) {
          if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
          if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
          parent = parent.parentElement;
        }

        if (isPersian(text)) return NodeFilter.FILTER_REJECT;
        if (/^[\d\s.,;:!?@#$%^&*()\-+=\[\]{}|\\/<>~`'"]+$/.test(text)) return NodeFilter.FILTER_REJECT;
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
  // Translation Logic
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
              originalTextMap.set(node, node.textContent);
              translatedTextNodes.add(node);

              const leading = node.textContent.match(/^\s*/)[0];
              const trailing = node.textContent.match(/\s*$/)[0];
              node.textContent = leading + translated + trailing;

              const blockParent = getBlockParent(node);
              if (blockParent && !blockParent.hasAttribute('data-lt-done')) {
                blockParent.setAttribute('data-lt-done', '1');
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
        }
      } catch (err) {
        log('Batch error:', err.message);
      }

      if (i + BATCH_SIZE < textNodes.length) {
        await sleep(150);
      }
    }
  }

  function getBlockParent(textNode) {
    let el = textNode.parentElement;
    if (!el) return null;
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
    log('Reverting...');
    translationEnabled = false;
    isTranslating = false;
    stopObserver();

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (originalTextMap.has(node)) {
        node.textContent = originalTextMap.get(node);
        originalTextMap.delete(node);
        translatedTextNodes.delete(node);
      }
    }

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
  // Observer
  // ============================================================
  function startObserver() {
    if (observer) return;

    observer = new MutationObserver((mutations) => {
      if (!translationEnabled || isTranslating) return;
      let hasNew = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          for (const added of mutation.addedNodes) {
            if (added.nodeType === Node.ELEMENT_NODE &&
                !added.closest('#lt-floating-btn, #lt-selection-popup')) {
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

    observer.observe(document.body, { childList: true, subtree: true });

    // Scroll watcher
    let scrollTimer = null;
    window.addEventListener('scroll', () => {
      if (!translationEnabled || isTranslating) return;
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        pendingRoots.push(document.body);
        processPendingRoots();
      }, 1000);
    }, { passive: true });

    // LinkedIn SPA navigation
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

    // Reposition floating button periodically (messaging overlay may load late)
    if (floatingBtnPosition === 'above-messaging') {
      setInterval(() => positionFloatingButton(), 5000);
    }

    log('Observer started');
  }

  function stopObserver() {
    if (observer) { observer.disconnect(); observer = null; }
    if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
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
        if (root.isConnected) await translateRoot(root);
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
