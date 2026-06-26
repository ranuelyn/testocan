/**
 * ═══════════════════════════════════════════════════════════════
 *  TESTOCAN — Content Script: DOM Event Recorder
 * ═══════════════════════════════════════════════════════════════
 *  Injected into every page. On load, it checks with the
 *  Background worker if recording is active for this tab.
 *  If so, it auto-activates listeners.
 *
 *  Captures: click, input (debounced), change, keydown, submit
 *  Each event includes a semantic locator for self-healing replay.
 */

(function () {
  'use strict';

  // Guard against double injection
  if (window.__testocanInjected) return;
  window.__testocanInjected = true;

  const MSG = {
    START_RECORDING:   'TESTOCAN::START_RECORDING',
    STOP_RECORDING:    'TESTOCAN::STOP_RECORDING',
    DOM_EVENT:         'TESTOCAN::DOM_EVENT',
    GET_STATUS:        'TESTOCAN::GET_STATUS',
  };

  let isRecording = false;

  // ── Locator Builder ────────────────────────────────────────

  function inferRole(el) {
    const tag = el.tagName.toLowerCase();
    const roleMap = {
      button: 'button', a: 'link', input: 'textbox',
      select: 'combobox', textarea: 'textbox', img: 'img',
      nav: 'navigation', main: 'main', form: 'form',
    };
    if (tag === 'input') {
      const type = el.getAttribute('type');
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'submit' || type === 'button') return 'button';
      return 'textbox';
    }
    return roleMap[tag] || null;
  }

  function isStableId(id) {
    if (!id) return false;
    if (/^[0-9a-f]{8,}$/i.test(id)) return false;
    if (/^\d+$/.test(id)) return false;
    if (id.includes(':r') || id.includes('react')) return false;
    return true;
  }

  function getVisibleText(el) {
    // Get short direct text representation
    const text = el.textContent?.trim() || '';
    return text.length > 120 ? text.slice(0, 120) + '…' : text;
  }

  function isInputLike(el) {
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select';
  }

  function getNthOfType(el) {
    if (!el.parentElement) return 0;
    const siblings = Array.from(el.parentElement.children).filter(
      (s) => s.tagName === el.tagName
    );
    return siblings.indexOf(el);
  }

  function buildCssSelector(el) {
    const parts = [];
    let current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      let selector = current.tagName.toLowerCase();
      if (current.id && isStableId(current.id)) {
        selector = `#${current.id}`;
        parts.unshift(selector);
        break;
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (s) => s.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${idx})`;
        }
      }
      parts.unshift(selector);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function buildLocator(el) {
    return {
      tagName:     el.tagName.toLowerCase(),
      testId:      el.getAttribute('data-testid')
                || el.getAttribute('data-cy')
                || el.getAttribute('data-test')
                || null,
      role:        el.getAttribute('role') || inferRole(el),
      ariaLabel:   el.getAttribute('aria-label') || null,
      id:          isStableId(el.id) ? el.id : null,
      innerText:   getVisibleText(el),
      placeholder: el.getAttribute('placeholder') || null,
      title:       el.getAttribute('title') || null,
      alt:         el.getAttribute('alt') || null,
      name:        el.getAttribute('name') || null,
      type:        el.getAttribute('type') || null,
      href:        el.tagName === 'A' ? el.getAttribute('href') : null,
      value:       isInputLike(el) ? el.value : null,
      nthOfType:   getNthOfType(el),
      cssSelector: buildCssSelector(el),
    };
  }

  // ── Debounce for input events ──────────────────────────────
  const inputTimers = new WeakMap();

  function sendEventDebounced(action, el, extra, delay = 400) {
    if (!isRecording) return;

    // Clear previous timer for this element
    const prev = inputTimers.get(el);
    if (prev) clearTimeout(prev);

    inputTimers.set(el, setTimeout(() => {
      inputTimers.delete(el);
      sendEvent(action, el, extra);
    }, delay));
  }

  // ── Event sending ──────────────────────────────────────────

  function sendEvent(action, el, extra = {}) {
    if (!isRecording) return;

    const payload = {
      action,
      url: window.location.href,
      pageTitle: document.title,
      locator: buildLocator(el),
      ...extra,
    };

    try {
      chrome.runtime.sendMessage({
        type: MSG.DOM_EVENT,
        payload,
      });
    } catch (err) {
      // Extension might have been reloaded; stop recording gracefully
      console.warn('[Testocan CS] Failed to send event, stopping:', err);
      isRecording = false;
      detachListeners();
    }
  }

  // ── Event Handlers ─────────────────────────────────────────

  function onClickCapture(e) {
    if (!e.isTrusted) return; // Ignore programmatic clicks

    let el = e.target.closest(
      'a, button, input[type="submit"], input[type="button"], input[type="checkbox"], input[type="radio"], ' +
      'select, option, li, tr, td, th, [role="button"], [role="tab"], [role="menuitem"], [role="link"], [role="option"], [role="combobox"], [role="treeitem"], [role="listbox"], [onclick], ' +
      'label, summary, details, [tabindex]'
    );
    
    // Fallback: if no wrapper found, just use the target itself!
    // Exclude generic wide containers to avoid noise.
    if (!el && e.target !== document.body && e.target !== document.documentElement) {
      el = e.target;
    }

    if (!el) return;

    // Skip if clicking inside an input/textarea (those are handled by input/change)
    const tag = el.tagName.toLowerCase();
    if ((tag === 'input' && !['submit', 'button', 'checkbox', 'radio'].includes(el.type)) || tag === 'textarea') return;

    sendEvent('click', el);
  }

  function onInputCapture(e) {
    if (!e.isTrusted) return; // Ignore programmatic input from JS plugins
    const el = e.target;
    if (!isInputLike(el)) return;
    // Debounced — only send after user stops typing for 400ms
    sendEventDebounced('input', el, { value: el.value });
  }

  function onChangeCapture(e) {
    if (!e.isTrusted) return; // Ignore programmatic change from JS plugins
    const el = e.target;
    if (!isInputLike(el)) return;
    // Text inputs are handled by 'input' event. Only handle change for discrete inputs
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea' || (tag === 'input' && !['checkbox', 'radio', 'file', 'color'].includes(el.type))) {
      return; 
    }
    sendEvent('change', el, { value: el.value });
  }

  function onKeydownCapture(e) {
    if (!e.isTrusted) return;
    const specialKeys = ['Enter', 'Tab', 'Escape'];
    if (!specialKeys.includes(e.key)) return;
    sendEvent('keydown', e.target, { key: e.key });
  }

  function onSubmitCapture(e) {
    if (!e.isTrusted) return;
    const form = e.target;
    if (form.tagName?.toLowerCase() !== 'form') return;
    sendEvent('submit', form);
  }

  // ── Focus/blur tracking for navigation events ─────────────
  function onFocusIn(e) {
    const el = e.target;
    if (!isInputLike(el)) return;
    sendEvent('focus', el);
  }

  // ── Scroll tracking (debounced, coarse) ────────────────────
  let scrollTimer = null;
  function onScrollCapture(e) {
    if (!isRecording || !e?.isTrusted) return;
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      sendEvent('scroll', document.documentElement, {
        scrollX: Math.round(window.scrollX),
        scrollY: Math.round(window.scrollY),
      });
    }, 500);
  }

  // ── Attach / Detach ────────────────────────────────────────

  function attachListeners() {
    document.addEventListener('click',    onClickCapture,   { capture: true, passive: true });
    document.addEventListener('input',    onInputCapture,   { capture: true, passive: true });
    document.addEventListener('change',   onChangeCapture,  { capture: true, passive: true });
    document.addEventListener('keydown',  onKeydownCapture, { capture: true, passive: true });
    document.addEventListener('submit',   onSubmitCapture,  { capture: true });
    document.addEventListener('focusin',  onFocusIn,        { capture: true, passive: true });
    window.addEventListener('scroll',     onScrollCapture,  { capture: true, passive: true });
    console.log('[Testocan CS] Listeners attached — recording active.');
  }

  function detachListeners() {
    document.removeEventListener('click',    onClickCapture,   { capture: true });
    document.removeEventListener('input',    onInputCapture,   { capture: true });
    document.removeEventListener('change',   onChangeCapture,  { capture: true });
    document.removeEventListener('keydown',  onKeydownCapture, { capture: true });
    document.removeEventListener('submit',   onSubmitCapture,  { capture: true });
    document.removeEventListener('focusin',  onFocusIn,        { capture: true });
    window.removeEventListener('scroll',     onScrollCapture,  { capture: true });
    console.log('[Testocan CS] Listeners detached — recording stopped.');
  }

  // ── Message Listener ───────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const { type } = message;

    if (type === MSG.START_RECORDING) {
      isRecording = true;
      attachListeners();
      sendResponse({ ok: true });
      return;
    }

    if (type === MSG.STOP_RECORDING) {
      isRecording = false;
      detachListeners();
      sendResponse({ ok: true });
      return;
    }

    if (type === MSG.SHOW_FLOATING_WIDGET) {
      const position = message.payload?.position || 'bottom-right';
      showFloatingWidget(position);
      sendResponse({ ok: true });
      return;
    }
  });

  // ── Floating Widget ──────────────────────────────────────────
  function showFloatingWidget(position) {
    // If it already exists, remove it first
    let existing = document.getElementById('testocan-floating-widget');
    if (existing) existing.remove();

    const widget = document.createElement('div');
    widget.id = 'testocan-floating-widget';
    
    // Style the widget
    Object.assign(widget.style, {
      position: 'fixed',
      width: '64px',
      height: '64px',
      zIndex: '2147483647', // Max z-index
      cursor: 'pointer',
      backgroundImage: `url(${chrome.runtime.getURL('icons/icon-48.png')})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      borderRadius: '50%',
      filter: 'drop-shadow(0 8px 16px rgba(245, 166, 35, 0.4))',
      transition: 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
      animation: 'testocanFloatGently 3s ease-in-out infinite'
    });

    // Apply positioning
    if (position === 'bottom-right') {
      widget.style.bottom = '24px';
      widget.style.right = '24px';
    } else if (position === 'bottom-left') {
      widget.style.bottom = '24px';
      widget.style.left = '24px';
    } else if (position === 'top-right') {
      widget.style.top = '24px';
      widget.style.right = '24px';
    } else if (position === 'top-left') {
      widget.style.top = '24px';
      widget.style.left = '24px';
    }

    // Hover effect
    widget.addEventListener('mouseenter', () => {
      widget.style.transform = 'scale(1.15) rotate(5deg)';
    });
    widget.addEventListener('mouseleave', () => {
      widget.style.transform = 'scale(1) rotate(0deg)';
    });

    // Click handler
    widget.addEventListener('click', () => {
      // Tell background to open side panel
      chrome.runtime.sendMessage({ type: MSG.OPEN_SIDE_PANEL }).catch(() => {});
      // Remove widget
      widget.remove();
    });

    // Add keyframes for animation if not exists
    if (!document.getElementById('testocan-animations')) {
      const style = document.createElement('style');
      style.id = 'testocan-animations';
      style.textContent = `
        @keyframes testocanFloatGently {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(widget);
  }

  // ═══════════════════════════════════════════════════════════
  //  AUTO-ACTIVATE: On load, ask Background if recording is
  //  active for this tab. This handles page navigations —
  //  when a new page loads, the content script re-checks and
  //  auto-starts recording if needed.
  // ═══════════════════════════════════════════════════════════
  try {
    chrome.runtime.sendMessage(
      { type: MSG.GET_STATUS, payload: {} },
      (res) => {
        if (chrome.runtime.lastError) {
          console.log('[Testocan CS] Could not reach background:', chrome.runtime.lastError.message);
          return;
        }
        if (res?.ok && res.isRecording) {
          console.log('[Testocan CS] Recording is active — auto-attaching listeners.');
          isRecording = true;
          attachListeners();

          // Also send a navigation event so the state machine knows we changed pages
          sendEvent('navigation', document.documentElement, {
            url: window.location.href,
            pageTitle: document.title,
          });
        }
      }
    );
  } catch (err) {
    console.log('[Testocan CS] Auto-activate check failed:', err);
  }

  console.log('[Testocan CS] Content script loaded.');
})();
