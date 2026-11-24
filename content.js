// Content script for LinkedIn Persian Translator
// Handles LinkedIn's dynamic DOM, Shadow DOM, and React-rendered content

(function () {
  'use strict';

  // ============================================================
  // State
  // ============================================================
  let isTranslating = false;
  let translationEnabled = false;
  let autoTranslate = false;
  let observer = null;
  const translatedNodes = new WeakSet();
  const originalTexts = new WeakMap();
  const BATCH_INTERVAL = 300;
  let pendingNodes = [];
  let batchTimer = null;

  // Persian detection regex
  const PERSIAN_REGEX = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

  // ============================================================
  // Initialization
  // ============================================================
  function init() {
    // Load settings
    chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
      if (response) {
        translationEnabled = response.translationEnabled;
        autoTranslate = response.autoTranslate;
        if (autoTranslate && translationEnabled) {
          startTranslation();
        }
      }
    });

    // Listen for messages from popup
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
          nodeCount: document.querySelectorAll('[data-lt-translated]').length
        });
      }
      return true;
    });

    // Create floating translate button
    createFloatingButton();
  }

  // ============================================================
  // Floating Button
  // ============================================================
  function createFloatingButton() {
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
    if (translationEnabled) {
      btn.classList.add('lt-active');
      btn.querySelector('.lt-btn-text').textContent = 'بازگشت';
    } else {
      btn.classList.remove('lt-active');
      btn.querySelector('.lt-btn-text').textContent = 'ترجمه';
    }
    if (isTranslating) {
      btn.classList.add('lt-loading');
      btn.querySelector('.lt-btn-text').textContent = '...در حال ترجمه';
    } else {
      btn.classList.remove('lt-loading');
    }
  }

  // ============================================================
  // Translation Logic
  // ============================================================
  async function startTranslation() {
    if (isTranslating) return;
    isTranslating = true;
    translationEnabled = true;
    updateFloatingButton();

    // Save state
    chrome.storage.local.set({ translationEnabled: true });

    try {
      // Translate existing content
      await translatePage();

      // Start observing for new content
      startObserver();
    } catch (err) {
      console.error('[LinkedIn Translator] Error:', err);
    } finally {
      isTranslating = false;
      updateFloatingButton();
    }
  }

  function revertTranslation() {
    translationEnabled = false;
    isTranslating = false;
    stopObserver();

    // Revert all translated nodes
    const translatedElements = document.querySelectorAll('[data-lt-translated]');
    translatedElements.forEach(el => {
      if (originalTexts.has(el)) {
        // Restore original text nodes
        const originals = originalTexts.get(el);
        const textNodes = getTextNodes(el);
        textNodes.forEach((node, i) => {
          if (originals[i] !== undefined) {
            node.textContent = originals[i];
          }
        });
        el.removeAttribute('data-lt-translated');
        el.style.direction = '';
        el.style.textAlign = '';
        translatedNodes.delete(el);
      }
    });

    chrome.storage.local.set({ translationEnabled: false });
    updateFloatingButton();
  }

  async function translatePage() {
    const elements = getTranslatableElements(document.body);
    await translateElements(elements);
  }

  function getTranslatableElements(root) {
    const elements = [];

    // LinkedIn-specific selectors for content areas
    const selectors = [
      // Feed posts
      '.feed-shared-update-v2__description',
      '.feed-shared-text',
      '.feed-shared-text__text-view',
      '.feed-shared-inline-show-more-text',
      // Comments
      '.comments-comment-item__main-content',
      '.comments-comment-texteditor',
      // Profile
      '.pv-about__summary-text',
      '.pv-profile-section__card-item-v2',
      '.text-body-medium',
      '.text-body-small',
      // Job descriptions
      '.jobs-description__content',
      '.jobs-unified-top-card__job-title',
      // Messages
      '.msg-s-event-listitem__body',
      '.msg-s-message-group__meta',
      // Navigation & UI
      '.artdeco-button__text',
      '.t-14', '.t-16', '.t-18', '.t-20', '.t-24',
      '.t-bold',
      // Generic text containers
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'span', 'a', 'li', 'td', 'th',
      'label', 'button',
      // Article content
      '.reader-content',
      '.article-content',
      // Notifications
      '.nt-card__text',
      // Generic LinkedIn classes
      '.ember-view',
    ];

    // Try specific selectors first
    const specificElements = new Set();
    selectors.forEach(selector => {
      try {
        root.querySelectorAll(selector).forEach(el => specificElements.add(el));
      } catch (e) { /* skip invalid selectors */ }
    });

    // Filter and collect translatable elements
    specificElements.forEach(el => {
      if (shouldTranslateElement(el)) {
        elements.push(el);
      }
    });

    // Also walk the DOM for any text-containing elements we might have missed
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => {
          if (specificElements.has(node)) return NodeFilter.FILTER_SKIP;
          if (shouldTranslateElement(node) && hasDirectText(node)) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_SKIP;
        }
      }
    );

    let node;
    while (node = walker.nextNode()) {
      elements.push(node);
    }

    return elements;
  }

  function shouldTranslateElement(el) {
    // Skip if already translated
    if (translatedNodes.has(el) || el.hasAttribute('data-lt-translated')) return false;

    // Skip hidden elements
    if (el.offsetParent === null && el.tagName !== 'BODY') return false;

    // Skip certain elements
    const skipTags = ['SCRIPT', 'STYLE', 'SVG', 'PATH', 'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'CODE', 'PRE', 'INPUT', 'TEXTAREA', 'SELECT', 'IFRAME', 'NOSCRIPT'];
    if (skipTags.includes(el.tagName)) return false;

    // Skip our own elements
    if (el.id === 'lt-floating-btn' || el.closest('#lt-floating-btn')) return false;

    // Skip elements with no meaningful text
    const text = getDirectText(el);
    if (!text || text.trim().length < 2) return false;

    // Skip if already Persian
    if (isPersian(text)) return false;

    return true;
  }

  function hasDirectText(el) {
    return getDirectText(el).trim().length > 1;
  }

  function getDirectText(el) {
    let text = '';
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent;
      }
    }
    return text;
  }

  function getTextNodes(el) {
    const nodes = [];
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent.trim().length > 0) {
        nodes.push(child);
      }
    }
    return nodes;
  }

  function isPersian(text) {
    const persianChars = (text.match(/[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/g) || []).length;
    const totalChars = text.replace(/[\s\d\W]/g, '').length;
    return totalChars > 0 && (persianChars / totalChars) > 0.5;
  }

  async function translateElements(elements) {
    if (elements.length === 0) return;

    // Collect all text nodes and their content
    const translateJobs = [];

    for (const el of elements) {
      const textNodes = getTextNodes(el);
      if (textNodes.length === 0) continue;

      const texts = textNodes.map(n => n.textContent.trim()).filter(t => t.length > 1 && !isPersian(t));
      if (texts.length === 0) continue;

      translateJobs.push({ element: el, textNodes, texts });
    }

    // Process in batches
    const BATCH_SIZE = 15;
    for (let i = 0; i < translateJobs.length; i += BATCH_SIZE) {
      if (!translationEnabled) break;

      const batch = translateJobs.slice(i, i + BATCH_SIZE);
      const allTexts = batch.flatMap(job => job.texts);

      try {
        const response = await chrome.runtime.sendMessage({
          action: 'translateBatch',
          texts: allTexts,
          sourceLang: 'auto'
        });

        if (response && response.success) {
          let translationIndex = 0;
          for (const job of batch) {
            // Store original texts
            const originals = job.textNodes.map(n => n.textContent);
            originalTexts.set(job.element, originals);

            // Apply translations
            for (const textNode of job.textNodes) {
              const originalText = textNode.textContent.trim();
              if (originalText.length > 1 && !isPersian(originalText)) {
                const translated = response.translations[translationIndex];
                if (translated && translated !== originalText) {
                  textNode.textContent = translated;
                }
                translationIndex++;
              }
            }

            // Mark as translated and set RTL direction
            job.element.setAttribute('data-lt-translated', 'true');
            job.element.style.direction = 'rtl';
            job.element.style.textAlign = 'right';
            translatedNodes.add(job.element);
          }
        }
      } catch (err) {
        console.error('[LinkedIn Translator] Batch translation error:', err);
      }

      // Rate limiting delay between batches
      if (i + BATCH_SIZE < translateJobs.length) {
        await sleep(200);
      }
    }
  }

  // ============================================================
  // DOM Observer (for dynamic content)
  // ============================================================
  function startObserver() {
    if (observer) return;

    observer = new MutationObserver((mutations) => {
      if (!translationEnabled) return;

      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              queueNodeForTranslation(node);
            }
          }
        }
        // Handle text changes (LinkedIn often updates text content dynamically)
        if (mutation.type === 'characterData') {
          const parentEl = mutation.target.parentElement;
          if (parentEl && !translatedNodes.has(parentEl)) {
            queueNodeForTranslation(parentEl);
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    // Also watch for LinkedIn's infinite scroll and navigation
    watchLinkedInNavigation();
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function queueNodeForTranslation(node) {
    pendingNodes.push(node);
    if (batchTimer) clearTimeout(batchTimer);
    batchTimer = setTimeout(processPendingNodes, BATCH_INTERVAL);
  }

  async function processPendingNodes() {
    if (!translationEnabled || pendingNodes.length === 0) return;

    const nodes = [...pendingNodes];
    pendingNodes = [];

    const elements = [];
    for (const node of nodes) {
      const els = getTranslatableElements(node);
      elements.push(...els);
    }

    // Deduplicate
    const uniqueElements = [...new Set(elements)];
    if (uniqueElements.length > 0) {
      await translateElements(uniqueElements);
    }
  }

  // ============================================================
  // LinkedIn Navigation Watcher
  // ============================================================
  function watchLinkedInNavigation() {
    // LinkedIn uses client-side routing; watch URL changes
    let lastUrl = location.href;

    const urlObserver = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        // Wait for new content to load, then translate
        setTimeout(() => {
          if (translationEnabled) {
            translatePage();
          }
        }, 1500);
      }
    });

    urlObserver.observe(document.body, { childList: true, subtree: true });

    // Also handle scroll events for lazy-loaded content
    let scrollTimer = null;
    window.addEventListener('scroll', () => {
      if (!translationEnabled) return;
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        translatePage();
      }, 800);
    }, { passive: true });
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
