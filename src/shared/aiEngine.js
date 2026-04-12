/**
 * ═══════════════════════════════════════════════════════════════
 *  TESTOCAN — AI Engine (Natural Language Parameterization)
 * ═══════════════════════════════════════════════════════════════
 *  Parses natural language prompts to modify recorded test flows.
 *
 *  Example:
 *    Flow: Typed "YUSUF" in username, typed "TEST1234" in password
 *    Prompt: "Run with ECE as username and test123 as password"
 *    Result: Modified flow with "ECE" and "test123" substituted
 *
 *  Uses rule-based NLP patterns — no external API needed.
 */

class AIEngine {
  /**
   * Parse a user prompt and modify a recorded flow.
   * @param {string} prompt — natural language instruction
   * @param {Array} events — recorded flow events
   * @returns {{ modifiedEvents: Array, changes: Array }}
   */
  static parseAndModify(prompt, events) {
    const changes = [];
    const modifiedEvents = JSON.parse(JSON.stringify(events)); // deep clone

    // Extract parameter pairs from prompt
    const params = AIEngine.extractParameters(prompt);

    if (params.length === 0) {
      return { modifiedEvents, changes, error: 'No parameter changes detected in prompt.' };
    }

    // Match each parameter to a flow event
    for (const param of params) {
      const matchResult = AIEngine.matchToEvent(param, modifiedEvents);
      if (matchResult) {
        changes.push(matchResult);
      }
    }

    return { modifiedEvents, changes };
  }

  /**
   * Extract key-value parameter pairs from a natural language prompt.
   * Handles multiple languages (EN/TR).
   */
  static extractParameters(prompt) {
    const params = [];
    const normalized = prompt.trim();

    // ── Pattern set ──────────────────────────────────────────

    const patterns = [
      // "use X as Y" / "X olarak Y kullan"
      /(?:use|kullan)\s+['"]?([^'"]+?)['"]?\s+(?:as|olarak)\s+(?:the\s+)?['"]?([^'",.]+)['"]?/gi,
      // "Y should be X" / "Y'yi X yap"
      /['"]?([^'"]+?)['"]?\s+(?:should be|olsun|olarak|yap)\s+['"]?([^'",.]+)['"]?/gi,
      // "change Y to X" / "Y'yi X değiştir"
      /(?:change|değiştir|set)\s+(?:the\s+)?['"]?([^'"]+?)['"]?\s+(?:to|ile)\s+['"]?([^'",.]+)['"]?/gi,
      // "X as Y" (simpler)
      /['"]([^'"]+)['"]\s+(?:as|olarak|için)\s+(?:the\s+)?['"]?([^'",.]+)['"]?/gi,
      // "with X as Y" / "X ile Y"
      /(?:with|ile)\s+['"]?([^'"]+?)['"]?\s+(?:as|olarak)\s+(?:the\s+)?['"]?([^'",.]+)['"]?/gi,
      // "Y: X" or "Y = X"
      /['"]?(\w[\w\s]*?)['"]?\s*[:=]\s*['"]?([^'",.]+)['"]?/gi,
      // "run ... but use X for Y"
      /(?:but\s+)?(?:use|enter|type|write|yaz)\s+['"]?([^'"]+?)['"]?\s+(?:for|in|into|için|yerine)\s+(?:the\s+)?['"]?([^'",.]+)['"]?/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(normalized)) !== null) {
        const [, valueOrField1, valueOrField2] = match;
        // Determine which is the value and which is the field
        const pair = AIEngine.classifyPair(valueOrField1.trim(), valueOrField2.trim());
        if (pair && !params.some((p) => p.field === pair.field)) {
          params.push(pair);
        }
      }
    }

    // If no structured patterns matched, try free-form extraction
    if (params.length === 0) {
      const freeFormParams = AIEngine.extractFreeForm(normalized);
      params.push(...freeFormParams);
    }

    return params;
  }

  /**
   * Classify which string is the field name and which is the new value.
   */
  static classifyPair(a, b) {
    // Common field names
    const fieldKeywords = [
      'username', 'user', 'kullanıcı', 'kullanici', 'email', 'e-posta', 'mail',
      'password', 'şifre', 'sifre', 'parola', 'pass',
      'name', 'ad', 'isim', 'first name', 'last name', 'soyad',
      'phone', 'telefon', 'tel', 'cep',
      'address', 'adres', 'city', 'şehir', 'country', 'ülke',
      'tc', 'kimlik', 'identity', 'id number',
      'date', 'tarih', 'birthday', 'doğum',
      'amount', 'tutar', 'miktar', 'price', 'fiyat',
      'search', 'ara', 'arama',
      'title', 'başlık', 'subject', 'konu',
      'description', 'açıklama', 'message', 'mesaj', 'note', 'not',
    ];

    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();

    const aIsField = fieldKeywords.some((kw) => aLower.includes(kw));
    const bIsField = fieldKeywords.some((kw) => bLower.includes(kw));

    if (bIsField && !aIsField) {
      return { field: b, value: a };
    }
    if (aIsField && !bIsField) {
      return { field: a, value: b };
    }

    // Default: first is value, second is field (matches "use X as Y" pattern)
    return { field: b, value: a };
  }

  /**
   * Free-form extraction for prompts like:
   * "username ECE, password test123"
   */
  static extractFreeForm(prompt) {
    const params = [];
    // Match "field value" pairs separated by commas or "and"
    const parts = prompt.split(/[,;]|\band\b|\bve\b/i);
    for (const part of parts) {
      const tokens = part.trim().split(/\s+/);
      if (tokens.length >= 2) {
        const field = tokens[0];
        const value = tokens.slice(1).join(' ').replace(/^['"]|['"]$/g, '');
        if (value) {
          params.push({ field, value });
        }
      }
    }
    return params;
  }

  /**
   * Match an extracted parameter to the correct event in the flow.
   */
  static matchToEvent(param, events) {
    const fieldLower = param.field.toLowerCase();

    // Find input/change events that match this field
    let bestMatch = null;
    let bestScore = 0;

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (event.action !== 'input' && event.action !== 'change') continue;

      const loc = event.locator || {};
      let score = 0;

      // Check name attribute
      if (loc.name && loc.name.toLowerCase().includes(fieldLower)) score += 50;
      // Check placeholder
      if (loc.placeholder && loc.placeholder.toLowerCase().includes(fieldLower)) score += 40;
      // Check aria-label
      if (loc.ariaLabel && loc.ariaLabel.toLowerCase().includes(fieldLower)) score += 40;
      // Check id
      if (loc.id && loc.id.toLowerCase().includes(fieldLower)) score += 35;
      // Check inner text (might be a label nearby)
      if (loc.innerText && loc.innerText.toLowerCase().includes(fieldLower)) score += 20;
      // Check type (e.g., "password" matches type="password")
      if (loc.type && loc.type.toLowerCase() === fieldLower) score += 60;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = { index: i, event, score };
      }
    }

    if (bestMatch && bestScore >= 20) {
      const oldValue = bestMatch.event.value;
      bestMatch.event.value = param.value;
      return {
        field: param.field,
        oldValue,
        newValue: param.value,
        eventIndex: bestMatch.index,
        matchScore: bestScore,
        locator: bestMatch.event.locator,
      };
    }

    return null;
  }

  /**
   * Parse a natural language assertion prompt.
   * Examples:
   *   "Check if 'Hoş geldin ECE' is visible"
   *   "'Welcome' yazısı görünmeli"
   *   "URL should contain /dashboard"
   */
  static parseAssertion(prompt) {
    const assertions = [];
    const normalized = prompt.trim();

    // Text visibility patterns
    const textPatterns = [
      /(?:check|verify|kontrol|doğrula)?\s*(?:if|that|whether)?\s*(?:the\s+)?['"]([^'"]+)['"]\s*(?:is|should be)?\s*(?:visible|displayed|shown|görünür|görünmeli|var)/gi,
      /['"]([^'"]+)['"]\s*(?:yazısı|metni|text)?\s*(?:görünmeli|gözükmeli|olmalı|var mı)/gi,
      /(?:see|gör)\s+['"]([^'"]+)['"]/gi,
      /(?:ekranda|sayfada|page)\s+['"]([^'"]+)['"]/gi,
    ];

    for (const pattern of textPatterns) {
      let match;
      while ((match = pattern.exec(normalized)) !== null) {
        assertions.push({ type: 'textVisible', text: match[1] });
      }
    }

    // URL patterns
    const urlPatterns = [
      /URL\s*(?:should|must)?\s*(?:contain|include|be)\s*['"]?([^\s'"]+)['"]?/gi,
      /(?:sayfa|page)\s*(?:URL'?i?)?\s*['"]?([^\s'"]+)['"]?\s*(?:olmalı|içermeli)/gi,
    ];

    for (const pattern of urlPatterns) {
      let match;
      while ((match = pattern.exec(normalized)) !== null) {
        assertions.push({ type: 'urlContains', pattern: match[1] });
      }
    }

    // No error patterns
    if (/no\s*(?:console)?\s*error|hata\s*(?:olmamalı|yok)/gi.test(normalized)) {
      assertions.push({ type: 'noErrors' });
    }

    return assertions;
  }
}

// Export for different contexts
if (typeof module !== 'undefined') module.exports = { AIEngine };
if (typeof self !== 'undefined') self.AIEngine = AIEngine;
