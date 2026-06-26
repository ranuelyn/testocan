/**
 * ═══════════════════════════════════════════════════════════════
 *  TESTOCAN — Bug Report Generator
 * ═══════════════════════════════════════════════════════════════
 *  Compiles flow data, errors, assertions, and screenshots into
 *  a structured bug report ready for Jira or other issue trackers.
 */

class BugReport {
  static generate({ flow, errors = {}, assertionResults = [], screenshot = null, prompt = null }) {
    const failedAssertions = assertionResults.filter((a) => !a.passed);
    const networkErrors = errors.networkErrors || (errors.requests ? errors.requests.filter(r => r.isError) : []);
    const consoleErrors = errors.consoleErrors || [];
    const jsErrors = errors.jsErrors || [];

    const severity = BugReport.calculateSeverity(networkErrors, jsErrors, failedAssertions);
    const title = BugReport.generateTitle(flow, failedAssertions, networkErrors);
    const labels = BugReport.generateLabels(networkErrors, consoleErrors, jsErrors, failedAssertions);

    return {
      title,
      severity,
      labels,
      description: BugReport.generateDescription({
        flow, networkErrors, consoleErrors, jsErrors,
        failedAssertions, assertionResults, prompt,
      }),
      stepsToReproduce: BugReport.generateSteps(flow),
      environment: BugReport.getEnvironment(flow),
      screenshot,
      timestamp: new Date().toISOString(),
      raw: { flow, errors, assertionResults },
    };
  }

  static generateTitle(flow, failedAssertions, networkErrors) {
    if (networkErrors.length > 0) {
      const first = networkErrors[0];
      const path = BugReport.shortenUrl(first.url);
      return `[BUG] HTTP ${first.status} Hatası — ${first.method || 'GET'} ${path}`;
    }
    if (failedAssertions.length > 0) {
      const first = failedAssertions[0];
      return `[BUG] Doğrulama Başarısız — ${first.message || first.type}`;
    }
    const page = flow?.url || 'Bilinmeyen sayfa';
    return `[BUG] Test başarısız — ${BugReport.shortenUrl(page)}`;
  }

  /**
   * Generates a clean Turkish description:
   * 1. Özet
   * 2. Hata Detayları (API URL + HTTP status + response body)
   * 3. Adımlar (deduplicated, passwords hidden)
   * 4. Ortam
   */
  static generateDescription({ flow, networkErrors, consoleErrors, jsErrors, failedAssertions, assertionResults, prompt }) {
    const lines = [];

    // ── Özet ──────────────────────────────────────────────────
    lines.push('## 📝 Özet');
    const totalSteps = flow?.events?.length || 0;
    lines.push(`Test, **${flow?.url || 'bilinmeyen sayfa'}** üzerinde ${totalSteps} adımlı bir akışla çalıştırıldı.`);
    if (prompt) lines.push(`\n**AI Prompt:** "${prompt}"`);
    lines.push('');

    // ── Hata Detayları ─────────────────────────────────────────
    const hasErrors = networkErrors.length > 0 || jsErrors.length > 0 || failedAssertions.length > 0 || consoleErrors.length > 0;
    if (hasErrors) {
      lines.push('## ❌ Tespit Edilen Hatalar');

      if (networkErrors.length > 0) {
        lines.push('\n### 🌐 Ağ Hataları');
        
        // Deduplicate network errors by method, URL, and status
        const uniqueErrors = new Map();
        for (const err of networkErrors) {
          const path = BugReport.shortenUrl(err.url);
          const key = `${err.method || 'GET'}|${path}|${err.status}`;
          if (!uniqueErrors.has(key)) uniqueErrors.set(key, err);
        }

        for (const err of Array.from(uniqueErrors.values()).slice(0, 8)) {
          const path = BugReport.shortenUrl(err.url);
          const body = err.responseBody ? err.responseBody.slice(0, 150) : '';
          lines.push(`- **${err.method || 'GET'} \`${path}\`** → HTTP **${err.status}** ${err.statusText || ''}`);
          if (body) lines.push(`  > Yanıt: \`${body}\``);
        }
        lines.push('');
      }

      if (jsErrors.length > 0) {
        lines.push('\n### 💥 JavaScript Hataları');
        for (const err of jsErrors.slice(0, 5)) {
          lines.push(`- \`${err.message}\``);
          if (err.url) lines.push(`  *Kaynak: ${BugReport.shortenUrl(err.url)}:${err.lineNumber || '?'}*`);
        }
        lines.push('');
      }

      if (consoleErrors.length > 0) {
        lines.push('\n### 🖥️ Konsol Hataları');
        for (const err of consoleErrors.slice(0, 5)) {
          lines.push(`- ${err.message || err.text || JSON.stringify(err)}`);
        }
        lines.push('');
      }

      if (failedAssertions.length > 0) {
        lines.push('\n### 🎯 Başarısız Doğrulamalar');
        for (const a of failedAssertions) {
          lines.push(`- **${a.type}**: ${a.message}`);
        }
        lines.push('');
      }
    }

    // ── Adımlar ────────────────────────────────────────────────
    lines.push('## 🔁 Yeniden Üretme Adımları');
    lines.push('_Hata oluşana kadar gerçekleştirilen işlemler:_\n');
    const steps = BugReport.generateSteps(flow);
    steps.forEach((step, i) => {
      lines.push(`${i + 1}. ${step}`);
    });
    lines.push('');

    // ── Ortam ─────────────────────────────────────────────────
    lines.push('## 🔧 Ortam Bilgileri');
    const env = BugReport.getEnvironment(flow);
    lines.push(`- **URL:** ${env.url}`);
    lines.push(`- **Tarayıcı:** ${env.browser}`);
    lines.push(`- **Zaman:** ${new Date(env.timestamp).toLocaleString('tr-TR')}`);

    return lines.join('\n');
  }

  /**
   * Generates a clean, deduplicated step list.
   * - Removes duplicate consecutive actions (same action + same label + same value)
   * - Masks passwords
   * - Skips Tab keypresses, scroll, focus noise
   */
  static generateSteps(flow) {
    if (!flow?.events) return ['Sayfaya gidildi'];

    const PASSWORD_FIELDS = ['şifre', 'password', 'parola', 'pin', 'sifre', 'pass'];

    const dedupedEvents = [];
    let prev = null;
    for (const event of flow.events) {
      if (!event) continue;
      if (event.action === 'scroll' || event.action === 'focus') continue;

      const loc = event.locator || {};
      const label = (loc.placeholder || loc.name || loc.ariaLabel || loc.id || loc.innerText?.slice(0, 40) || loc.tagName || '').toLowerCase();
      const key = `${event.action}|${label}|${event.value || ''}`;

      if (prev && prev === key) continue;
      prev = key;
      dedupedEvents.push(event);
    }

    const steps = [];

    for (const event of dedupedEvents) {
      const loc = event.locator || {};
      const rawLabel = (loc.placeholder || loc.name || loc.ariaLabel || loc.id || loc.innerText?.slice(0, 40) || loc.tagName || '?').trim();
      const isPasswordField = PASSWORD_FIELDS.some(p => rawLabel.toLowerCase().includes(p) || loc.type === 'password');

      let stepString = null;
      switch (event.action) {
        case 'navigation':
          stepString = `Sayfaya gidildi: ${event.url || ''}`;
          break;
        case 'click':
          stepString = `"${rawLabel}" butonuna / bağlantısına tıklandı`;
          break;
        case 'input':
        case 'change':
          if (isPasswordField) {
            stepString = `"${rawLabel}" alanına şifre girildi [ŞİFRE GİRİLDİ]`;
          } else {
            stepString = `"${rawLabel}" alanına "${event.value || ''}" yazıldı`;
          }
          break;
        case 'keydown':
          if (event.key && event.key !== 'Tab') stepString = `"${event.key}" tuşuna basıldı`;
          break;
        case 'submit':
          stepString = 'Form gönderildi';
          break;
      }

      if (stepString) {
        // Prevent repeating the same exact step if it occurred in the last 3 steps
        const recentSteps = steps.slice(-3);
        if (!recentSteps.includes(stepString)) {
          steps.push(stepString);
        }
      }
    }

    return steps.length > 0 ? steps : ['Sayfaya gidildi'];
  }

  static getEnvironment(flow) {
    let browser = 'Bilinmiyor';
    try { browser = self?.navigator?.userAgent || 'Bilinmiyor'; } catch {}

    return {
      url: flow?.url || 'Bilinmiyor',
      browser,
      timestamp: new Date().toISOString(),
      viewport: 'Uzantı üzerinden alındı',
    };
  }

  static calculateSeverity(networkErrors, jsErrors, failedAssertions) {
    const has5xx = networkErrors.some((e) => e.status >= 500);
    const hasJsError = jsErrors.length > 0;
    if (has5xx && hasJsError) return 'critical';
    if (has5xx || hasJsError) return 'high';
    if (networkErrors.length > 0) return 'medium';
    if (failedAssertions.length > 0) return 'medium';
    return 'info';
  }

  static generateLabels(networkErrors, consoleErrors, jsErrors, failedAssertions) {
    const labels = ['testocan', 'auto-generated'];
    if (networkErrors.some((e) => e.status >= 500)) labels.push('server-error');
    if (networkErrors.some((e) => e.status >= 400 && e.status < 500)) labels.push('client-error');
    if (jsErrors.length > 0) labels.push('js-exception');
    if (consoleErrors.length > 0) labels.push('console-error');
    if (failedAssertions.some((a) => a.type === 'textVisible')) labels.push('ui-bug');
    if (failedAssertions.some((a) => a.type === 'urlContains')) labels.push('navigation-bug');
    return labels;
  }

  static shortenUrl(url) {
    if (!url) return 'bilinmiyor';
    try {
      const u = new URL(url);
      return u.pathname + u.search;
    } catch {
      return url.slice(0, 80);
    }
  }

  static toJiraMarkup(markdown) {
    return markdown
      .replace(/^## (.+)$/gm, 'h2. $1')
      .replace(/^### (.+)$/gm, 'h3. $1')
      .replace(/\*\*(.+?)\*\*/g, '*$1*')
      .replace(/`([^`]+)`/g, '{{$1}}')
      .replace(/^```$/gm, '{code}')
      .replace(/^```(\w+)$/gm, '{code:language=$1}')
      .replace(/^- /gm, '* ')
      .replace(/^\d+\. /gm, '# ');
  }
}

if (typeof module !== 'undefined') module.exports = { BugReport };
if (typeof self !== 'undefined') self.BugReport = BugReport;
