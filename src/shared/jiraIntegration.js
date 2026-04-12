/**
 * ═══════════════════════════════════════════════════════════════
 *  TESTOCAN — Jira Integration
 * ═══════════════════════════════════════════════════════════════
 *  Jira Cloud REST API client for creating issues.
 *  Settings stored in chrome.storage.local.
 */

class JiraClient {
  /**
   * Save Jira configuration.
   */
  static async saveConfig(config) {
    await chrome.storage.local.set({
      jiraConfig: {
        baseUrl: config.baseUrl,     // e.g. "https://mycompany.atlassian.net"
        email: config.email,          // Jira account email
        apiToken: config.apiToken,    // API token from id.atlassian.com
        projectKey: config.projectKey, // e.g. "TEST"
        issueType: config.issueType || 'Bug',
      },
    });
  }

  /**
   * Load Jira configuration.
   */
  static async getConfig() {
    const { jiraConfig } = await chrome.storage.local.get('jiraConfig');
    return jiraConfig || null;
  }

  /**
   * Check if Jira is configured.
   */
  static async isConfigured() {
    const config = await JiraClient.getConfig();
    return !!(config?.baseUrl && config?.email && config?.apiToken && config?.projectKey);
  }

  /**
   * Create a Jira issue from a bug report.
   * @param {Object} bugReport — from BugReport.generate()
   * @returns {Object} — { success, issueKey, issueUrl, error }
   */
  static async createIssue(bugReport) {
    const config = await JiraClient.getConfig();
    if (!config) {
      return { success: false, error: 'Jira not configured' };
    }

    const auth = btoa(`${config.email}:${config.apiToken}`);

    // Build Jira issue payload
    const payload = {
      fields: {
        project: { key: config.projectKey },
        summary: bugReport.title,
        description: {
          type: 'doc',
          version: 1,
          content: JiraClient.markdownToADF(bugReport.description),
        },
        issuetype: { name: config.issueType || 'Bug' },
        priority: { name: JiraClient.severityToPriority(bugReport.severity) },
        labels: bugReport.labels,
      },
    };

    try {
      const response = await fetch(`${config.baseUrl}/rest/api/3/issue`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errBody = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${errBody}` };
      }

      const result = await response.json();
      const issueKey = result.key;
      const issueUrl = `${config.baseUrl}/browse/${issueKey}`;

      // Attach screenshot if available
      if (bugReport.screenshot) {
        await JiraClient.attachScreenshot(config, auth, issueKey, bugReport.screenshot);
      }

      return { success: true, issueKey, issueUrl };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Attach a base64 screenshot to a Jira issue.
   */
  static async attachScreenshot(config, auth, issueKey, base64Data) {
    try {
      // Convert base64 to blob
      const byteString = atob(base64Data.split(',')[1] || base64Data);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ab], { type: 'image/png' });

      const formData = new FormData();
      formData.append('file', blob, `testocan-screenshot-${Date.now()}.png`);

      await fetch(`${config.baseUrl}/rest/api/3/issue/${issueKey}/attachments`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'X-Atlassian-Token': 'no-check',
        },
        body: formData,
      });
    } catch (err) {
      console.warn('[Testocan Jira] Failed to attach screenshot:', err);
    }
  }

  /**
   * Map severity to Jira priority.
   */
  static severityToPriority(severity) {
    const map = {
      critical: 'Highest',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
      info: 'Lowest',
    };
    return map[severity] || 'Medium';
  }

  /**
   * Convert markdown to Atlassian Document Format (simplified).
   */
  static markdownToADF(markdown) {
    const content = [];
    const lines = markdown.split('\n');

    let inCodeBlock = false;
    let codeLines = [];

    for (const line of lines) {
      if (line.startsWith('```')) {
        if (inCodeBlock) {
          // End code block
          content.push({
            type: 'codeBlock',
            content: [{ type: 'text', text: codeLines.join('\n') }],
          });
          codeLines = [];
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
        }
        continue;
      }

      if (inCodeBlock) {
        codeLines.push(line);
        continue;
      }

      if (line.startsWith('## ')) {
        content.push({
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: line.replace('## ', '') }],
        });
      } else if (line.startsWith('- ')) {
        content.push({
          type: 'bulletList',
          content: [{
            type: 'listItem',
            content: [{
              type: 'paragraph',
              content: [{ type: 'text', text: line.replace('- ', '') }],
            }],
          }],
        });
      } else if (/^\d+\. /.test(line)) {
        content.push({
          type: 'orderedList',
          content: [{
            type: 'listItem',
            content: [{
              type: 'paragraph',
              content: [{ type: 'text', text: line.replace(/^\d+\. /, '') }],
            }],
          }],
        });
      } else if (line.trim()) {
        content.push({
          type: 'paragraph',
          content: [{ type: 'text', text: line }],
        });
      }
    }

    return content;
  }
}

if (typeof module !== 'undefined') module.exports = { JiraClient };
if (typeof self !== 'undefined') self.JiraClient = JiraClient;
