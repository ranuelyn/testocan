/**
 * ═══════════════════════════════════════════════════════════════
 *  TESTOCAN — Semantic Locator Builder
 * ═══════════════════════════════════════════════════════════════
 *  Instead of fragile CSS selectors or XPaths, we build a
 *  multi-signal "fingerprint" for each element. This enables
 *  self-healing tests: if a class name changes but the button
 *  still says "Login", we can still find it.
 *
 *  Locator priority (most → least reliable):
 *    1. data-testid / data-cy / data-test
 *    2. ARIA role + label
 *    3. id (only if it looks stable — no auto-generated hashes)
 *    4. Visible text content
 *    5. Placeholder / title / alt attributes
 *    6. Tag + nth-of-type (fallback)
 */

/**
 * Builds a semantic locator object for a given DOM element.
 * @param {HTMLElement} el
 * @returns {Object} locator fingerprint
 */
export function buildLocator(el) {
  const locator = {
    tagName: el.tagName.toLowerCase(),
    // ── Tier 1: Explicit test attributes ───────────────────
    testId:      el.getAttribute('data-testid')
              || el.getAttribute('data-cy')
              || el.getAttribute('data-test')
              || null,
    // ── Tier 2: ARIA semantics ─────────────────────────────
    role:        el.getAttribute('role') || inferRole(el),
    ariaLabel:   el.getAttribute('aria-label') || null,
    // ── Tier 3: ID (skip auto-generated) ───────────────────
    id:          isStableId(el.id) ? el.id : null,
    // ── Tier 4: Visible text (trimmed, max 120 chars) ──────
    innerText:   getVisibleText(el),
    // ── Tier 5: Semantic attributes ────────────────────────
    placeholder: el.getAttribute('placeholder') || null,
    title:       el.getAttribute('title') || null,
    alt:         el.getAttribute('alt') || null,
    name:        el.getAttribute('name') || null,
    type:        el.getAttribute('type') || null,
    href:        el.tagName === 'A' ? el.getAttribute('href') : null,
    value:       isInputLike(el) ? el.value : null,
    // ── Tier 6: Structural fallback ────────────────────────
    nthOfType:   getNthOfType(el),
    // ── CSS selector as absolute fallback ──────────────────
    cssSelector: buildCssSelector(el),
  };

  return locator;
}

// ── Helpers ──────────────────────────────────────────────────

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
  // Skip IDs that look auto-generated (hashes, UUIDs, numeric-only)
  if (/^[0-9a-f]{8,}$/i.test(id)) return false;
  if (/^\d+$/.test(id)) return false;
  if (id.includes(':r') || id.includes('react')) return false; // React auto-ids
  return true;
}

function getVisibleText(el) {
  // Only get direct text, not nested children's text
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
      break; // ID is unique, stop traversing
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
