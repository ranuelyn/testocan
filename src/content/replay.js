/**
 * ═══════════════════════════════════════════════════════════════
 *  TESTOCAN — Replay Engine (Content Script)
 * ═══════════════════════════════════════════════════════════════
 *  Replays recorded flows by:
 *    1. Finding elements via multi-strategy semantic matching
 *    2. Dispatching native browser events (not synthetic)
 *    3. Waiting for page transitions and DOM mutations
 *
 *  This runs inside the content script context.
 */

(function () {
  'use strict';

  if (window.__testocanReplayInjected) return;
  window.__testocanReplayInjected = true;

  const MSG = {
    REPLAY_STEP:      'TESTOCAN::REPLAY_STEP',
    REPLAY_RESULT:    'TESTOCAN::REPLAY_RESULT',
    REPLAY_COMPLETE:  'TESTOCAN::REPLAY_COMPLETE',
    RUN_ASSERTION:    'TESTOCAN::RUN_ASSERTION',
    ASSERTION_RESULT: 'TESTOCAN::ASSERTION_RESULT',
  };

  // ── Element Finder (Self-Healing) ──────────────────────────

  /**
   * Finds the best matching element for a given semantic locator.
   * Uses a scoring system across multiple strategies.
   * @param {Object} locator — semantic locator from recording
   * @returns {HTMLElement|null}
   */
  function findElement(locator) {
    const candidates = [];

    // Strategy 1: data-testid (highest priority)
    if (locator.testId) {
      const el = document.querySelector(
        `[data-testid="${locator.testId}"], [data-cy="${locator.testId}"], [data-test="${locator.testId}"]`
      );
      if (el) return el;
    }

    // Strategy 2: ID
    if (locator.id) {
      const el = document.getElementById(locator.id);
      if (el) candidates.push({ el, score: 90 });
    }

    // Strategy 3: ARIA role + label
    if (locator.role && locator.ariaLabel) {
      const els = document.querySelectorAll(`[role="${locator.role}"][aria-label="${locator.ariaLabel}"]`);
      els.forEach((el) => candidates.push({ el, score: 85 }));
    }

    // Strategy 4: Name attribute (for form fields)
    if (locator.name && locator.tagName) {
      const els = document.querySelectorAll(`${locator.tagName}[name="${locator.name}"]`);
      els.forEach((el) => candidates.push({ el, score: 80 }));
    }

    // Strategy 5: Placeholder
    if (locator.placeholder) {
      const els = document.querySelectorAll(`[placeholder="${locator.placeholder}"]`);
      els.forEach((el) => candidates.push({ el, score: 75 }));
    }

    // Strategy 6: Type + tag combo
    if (locator.type && locator.tagName) {
      const els = document.querySelectorAll(`${locator.tagName}[type="${locator.type}"]`);
      els.forEach((el) => {
        let score = 40;
        // Boost if text matches too
        if (locator.innerText && el.textContent?.trim().includes(locator.innerText.replace('…', ''))) {
          score += 30;
        }
        candidates.push({ el, score });
      });
    }

    // Strategy 7: Visible text matching
    if (locator.innerText && locator.innerText.length > 1) {
      const searchText = locator.innerText.replace('…', '').trim();
      const tag = locator.tagName || '*';
      const els = document.querySelectorAll(tag);
      els.forEach((el) => {
        const elText = el.textContent?.trim() || '';
        if (elText === searchText) {
          candidates.push({ el, score: 70 });
        } else if (elText.includes(searchText) || searchText.includes(elText)) {
          candidates.push({ el, score: 50 });
        }
      });
    }

    // Strategy 8: CSS selector fallback
    if (locator.cssSelector) {
      try {
        const el = document.querySelector(locator.cssSelector);
        if (el) candidates.push({ el, score: 30 });
      } catch { /* invalid selector */ }
    }

    // Strategy 9: href for links
    if (locator.href && locator.tagName === 'a') {
      const els = document.querySelectorAll(`a[href="${locator.href}"]`);
      els.forEach((el) => candidates.push({ el, score: 65 }));
      // Also try partial href match
      if (candidates.length === 0) {
        document.querySelectorAll('a').forEach((el) => {
          if (el.href?.includes(locator.href) || locator.href?.includes(el.getAttribute('href'))) {
            candidates.push({ el, score: 45 });
          }
        });
      }
    }

    // Sort by score, pick best
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);

    // Deduplicate
    const seen = new Set();
    const unique = candidates.filter((c) => {
      if (seen.has(c.el)) return false;
      seen.add(c.el);
      return true;
    });

    return unique[0]?.el || null;
  }

  // ── Native Event Dispatch ──────────────────────────────────

  /**
   * Simulate a real mouse click.
   */
  function dispatchClick(el) {
    // Scroll into view
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const commonProps = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
    };

    el.dispatchEvent(new MouseEvent('mouseover', commonProps));
    el.dispatchEvent(new MouseEvent('mousedown', { ...commonProps, button: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...commonProps, button: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...commonProps, button: 0 }));

    // For checkboxes / radio buttons
    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
      el.checked = !el.checked;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  /**
   * Simulate typing into an input field with native events.
   * SPAs (React, Vue, Angular) need this specific sequence.
   */
  function dispatchInput(el, value) {
    if (!el) return;

    if (el.tagName === 'SELECT') {
      const match = Array.from(el.options).find(o => o.value === String(value) || o.text === String(value));
      if (match) {
        el.value = match.value;
      } else {
        el.value = value;
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
      // Trying to input into a non-input element (e.g. wrapper div for custom select).
      // Fallback: try finding an input inside it
      const inner = el.querySelector('input, textarea');
      if (inner) {
        dispatchInput(inner, value);
      }
      return;
    }

    // Focus
    el.focus();
    el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    // Clear existing value
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));

    // Use native input setter to bypass React's synthetic event system
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set || Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;

    if (nativeInputValueSetter && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      try {
        nativeInputValueSetter.call(el, value);
      } catch (e) {
        el.value = value;
      }
    } else {
      el.value = value;
    }

    // Dispatch input event (React listens for this)
    try {
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: value,
      }));
    } catch (e) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Dispatch change event
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Simulate a keyboard keypress.
   */
  function dispatchKeydown(el, key) {
    const props = {
      key,
      code: key === 'Enter' ? 'Enter' : key === 'Tab' ? 'Tab' : key === 'Escape' ? 'Escape' : key,
      bubbles: true,
      cancelable: true,
      view: window,
    };

    el.dispatchEvent(new KeyboardEvent('keydown', props));
    el.dispatchEvent(new KeyboardEvent('keypress', props));
    el.dispatchEvent(new KeyboardEvent('keyup', props));

    // If Enter and inside a form, trigger submit
    if (key === 'Enter') {
      const form = el.closest('form');
      if (form) {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    }
  }

  /**
   * Simulate form submit.
   */
  function dispatchSubmit(el) {
    const form = el.tagName === 'FORM' ? el : el.closest('form');
    if (form) {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      // Also try clicking the submit button if present
      const submitBtn = form.querySelector('[type="submit"], button:not([type])');
      if (submitBtn) dispatchClick(submitBtn);
    }
  }

  // ── Waiting utilities ──────────────────────────────────────

  /**
   * Wait for an element to appear in the DOM.
   */
  function waitForElement(locator, timeout = 10000) {
    return new Promise((resolve, reject) => {
      // Check immediately
      const found = findElement(locator);
      if (found) return resolve(found);

      const startTime = Date.now();
      const observer = new MutationObserver(() => {
        const el = findElement(locator);
        if (el) {
          observer.disconnect();
          resolve(el);
        } else if (Date.now() - startTime > timeout) {
          observer.disconnect();
          reject(new Error(`Element not found within ${timeout}ms`));
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
      });

      // Fallback timeout
      setTimeout(() => {
        observer.disconnect();
        const el = findElement(locator);
        if (el) resolve(el);
        else reject(new Error(`Element not found within ${timeout}ms`));
      }, timeout);
    });
  }

  /**
   * Wait a specified number of milliseconds.
   */
  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ── Highlight element during replay ────────────────────────

  function highlightElement(el) {
    const overlay = document.createElement('div');
    overlay.id = '__testocan-highlight';
    overlay.style.cssText = `
      position: fixed;
      pointer-events: none;
      border: 2px solid #6c5ce7;
      background: rgba(108, 92, 231, 0.1);
      border-radius: 4px;
      z-index: 2147483647;
      transition: all 0.2s ease;
      box-shadow: 0 0 12px rgba(108, 92, 231, 0.3);
    `;

    document.body.appendChild(overlay);

    const rect = el.getBoundingClientRect();
    overlay.style.left = rect.left - 2 + 'px';
    overlay.style.top = rect.top - 2 + 'px';
    overlay.style.width = rect.width + 4 + 'px';
    overlay.style.height = rect.height + 4 + 'px';

    setTimeout(() => overlay.remove(), 800);
  }

  // ── Step Executor ──────────────────────────────────────────

  async function executeStep(step) {
    const { action, locator, value, key } = step;

    // Skip navigation events — handled by the background via URL monitoring
    if (action === 'navigation' || action === 'scroll' || action === 'focus') {
      return { success: true, skipped: true, action };
    }

    let el;
    try {
      el = await waitForElement(locator, 8000);
    } catch (err) {
      return {
        success: false,
        error: `Element not found: ${err.message}`,
        locator,
        action,
      };
    }

    // Highlight
    highlightElement(el);
    await wait(200);

    try {
      switch (action) {
        case 'click':
          dispatchClick(el);
          break;

        case 'input':
        case 'change':
          dispatchInput(el, value || '');
          break;

        case 'keydown':
          dispatchKeydown(el, key || 'Enter');
          break;

        case 'submit':
          dispatchSubmit(el);
          break;

        default:
          return { success: true, skipped: true, action };
      }

      return { success: true, action, element: describeElement(el) };
    } catch (err) {
      return { success: false, error: err.message, action };
    }
  }

  function describeElement(el) {
    return {
      tag: el.tagName.toLowerCase(),
      text: el.textContent?.trim().slice(0, 50),
      id: el.id || null,
    };
  }

  // ── Message Handler ────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const { type, payload } = message;

    if (type === MSG.REPLAY_STEP) {
      executeStep(payload.step)
        .then((result) => {
          chrome.runtime.sendMessage({
            type: MSG.REPLAY_RESULT,
            payload: {
              stepIndex: payload.stepIndex,
              result,
            },
          });
        })
        .catch((err) => {
          chrome.runtime.sendMessage({
            type: MSG.REPLAY_RESULT,
            payload: {
              stepIndex: payload.stepIndex,
              result: { success: false, error: err.message },
            },
          });
        });

      sendResponse({ ok: true });
      return true;
    }

    if (type === MSG.RUN_ASSERTION) {
      const result = runAssertion(payload.assertion);
      sendResponse({ ok: true, result });
      return false;
    }
  });

  // ── Assertion Runner ───────────────────────────────────────

  function runAssertion(assertion) {
    switch (assertion.type) {
      case 'textVisible': {
        const found = document.body.innerText.includes(assertion.text);
        return {
          type: 'textVisible',
          expected: assertion.text,
          passed: found,
          message: found
            ? `Text "${assertion.text}" is visible on page`
            : `Text "${assertion.text}" was NOT found on page`,
        };
      }

      case 'elementExists': {
        const el = findElement(assertion.locator);
        return {
          type: 'elementExists',
          passed: !!el,
          message: el
            ? `Element found`
            : `Element not found`,
        };
      }

      case 'urlContains': {
        const found = window.location.href.includes(assertion.pattern);
        return {
          type: 'urlContains',
          expected: assertion.pattern,
          passed: found,
          message: found
            ? `URL contains "${assertion.pattern}"`
            : `URL does NOT contain "${assertion.pattern}" (actual: ${window.location.href})`,
        };
      }

      case 'elementHasText': {
        const el = findElement(assertion.locator);
        if (!el) return { type: 'elementHasText', passed: false, message: 'Element not found' };
        const hasText = el.textContent?.includes(assertion.text);
        return {
          type: 'elementHasText',
          passed: !!hasText,
          message: hasText
            ? `Element contains "${assertion.text}"`
            : `Element does NOT contain "${assertion.text}" (actual: "${el.textContent?.trim().slice(0, 50)}")`,
        };
      }

      default:
        return { type: assertion.type, passed: false, message: 'Unknown assertion type' };
    }
  }

  console.log('[Testocan Replay] Replay engine loaded.');
})();
