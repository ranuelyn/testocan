/**
 * ═══════════════════════════════════════════════════════════════
 *  TESTOCAN — Network Monitor (chrome.debugger)
 * ═══════════════════════════════════════════════════════════════
 *  Attaches to a tab via chrome.debugger API to monitor:
 *    • HTTP responses (4xx, 5xx → flag as errors)
 *    • Request timing and payloads
 *    • Console messages (errors, warnings)
 *
 *  Used during both recording and replay to capture environment
 *  errors for bug reports and assertions.
 */

class NetworkMonitor {
  constructor() {
    // Map<tabId, { requests: [], consoleErrors: [], attached: boolean }>
    this.tabs = new Map();
    this._onEvent = this._onEvent.bind(this);
    this._onDetach = this._onDetach.bind(this);
  }

  _getTabData(tabId) {
    if (!this.tabs.has(tabId)) {
      this.tabs.set(tabId, {
        requests: [],
        consoleErrors: [],
        jsErrors: [],
        attached: false,
      });
    }
    return this.tabs.get(tabId);
  }

  /**
   * Attach debugger to a tab and start monitoring.
   */
  async attach(tabId) {
    const data = this._getTabData(tabId);
    if (data.attached) return;

    try {
      await chrome.debugger.attach({ tabId }, '1.3');
      data.attached = true;

      // Enable domains
      await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {});
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable', {});

      // Listen for events
      if (!chrome.debugger.onEvent.hasListener(this._onEvent)) {
        chrome.debugger.onEvent.addListener(this._onEvent);
      }
      if (!chrome.debugger.onDetach.hasListener(this._onDetach)) {
        chrome.debugger.onDetach.addListener(this._onDetach);
      }

      console.log(`[Testocan Net] Debugger attached to tab ${tabId}`);
    } catch (err) {
      console.warn(`[Testocan Net] Failed to attach debugger:`, err);
      data.attached = false;
    }
  }

  /**
   * Detach debugger from a tab.
   */
  async detach(tabId) {
    const data = this._getTabData(tabId);
    if (!data.attached) return;

    try {
      await chrome.debugger.detach({ tabId });
    } catch (err) {
      // May already be detached
    }
    data.attached = false;
    console.log(`[Testocan Net] Debugger detached from tab ${tabId}`);
  }

  /**
   * Handle debugger events.
   */
  _onEvent(source, method, params) {
    const tabId = source.tabId;
    if (!tabId) return;
    const data = this._getTabData(tabId);

    switch (method) {
      case 'Network.responseReceived': {
        const { response, requestId } = params;
        const entry = {
          requestId,
          url: response.url,
          status: response.status,
          statusText: response.statusText,
          mimeType: response.mimeType,
          method: response.requestHeaders?.method || 'GET',
          timestamp: Date.now(),
          isError: response.status >= 400,
        };
        data.requests.push(entry);

        if (entry.isError) {
          console.log(`[Testocan Net] HTTP ${response.status} → ${response.url}`);
          // Try to get response body for error details
          this._captureResponseBody(tabId, requestId, entry);
          
          // Capture a screenshot after a short delay to allow UI to render the error
          setTimeout(() => {
            chrome.tabs.get(tabId, (tab) => {
              if (tab && tab.windowId) {
                chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 })
                  .then(dataUrl => {
                    entry.errorScreenshot = dataUrl;
                  }).catch(err => console.warn('NetMonitor screenshot failed:', err));
              }
            });
          }, 800);
        }
        break;
      }

      case 'Network.loadingFailed': {
        const entry = {
          requestId: params.requestId,
          url: 'unknown',
          status: 0,
          errorText: params.errorText,
          canceled: params.canceled,
          timestamp: Date.now(),
          isError: true,
          type: params.type,
        };
        data.requests.push(entry);
        break;
      }

      case 'Runtime.consoleAPICalled': {
        if (params.type === 'error' || params.type === 'warning') {
          const message = params.args
            ?.map((arg) => arg.value || arg.description || '')
            .join(' ');
          data.consoleErrors.push({
            type: params.type,
            message,
            timestamp: Date.now(),
            stackTrace: params.stackTrace,
          });
        }
        break;
      }

      case 'Runtime.exceptionThrown': {
        const ex = params.exceptionDetails;
        data.jsErrors.push({
          message: ex.text || ex.exception?.description || 'Unknown error',
          url: ex.url,
          lineNumber: ex.lineNumber,
          columnNumber: ex.columnNumber,
          stackTrace: ex.stackTrace,
          timestamp: Date.now(),
        });
        break;
      }
    }
  }

  /**
   * Try to capture response body for failed requests.
   */
  async _captureResponseBody(tabId, requestId, entry) {
    try {
      const result = await chrome.debugger.sendCommand(
        { tabId },
        'Network.getResponseBody',
        { requestId }
      );
      if (result?.body) {
        entry.responseBody = result.body.slice(0, 2000); // Cap at 2KB
      }
    } catch {
      // Body may not be available
    }
  }

  /**
   * Handle debugger detach.
   */
  _onDetach(source, reason) {
    const tabId = source.tabId;
    if (!tabId) return;
    const data = this._getTabData(tabId);
    data.attached = false;
    console.log(`[Testocan Net] Debugger detached from tab ${tabId}: ${reason}`);
  }

  /**
   * Get all errors (network + console + JS) for a tab.
   */
  getErrors(tabId) {
    const data = this._getTabData(tabId);
    return {
      networkErrors: data.requests.filter((r) => r.isError),
      consoleErrors: data.consoleErrors,
      jsErrors: data.jsErrors,
    };
  }

  /**
   * Get all captured data for a tab.
   */
  getAll(tabId) {
    const data = this._getTabData(tabId);
    return {
      requests: [...data.requests],
      consoleErrors: [...data.consoleErrors],
      jsErrors: [...data.jsErrors],
    };
  }

  /**
   * Clear captured data for a tab.
   */
  clear(tabId) {
    const data = this._getTabData(tabId);
    data.requests = [];
    data.consoleErrors = [];
    data.jsErrors = [];
  }

  /**
   * Cleanup when tab is removed.
   */
  cleanup(tabId) {
    this.detach(tabId);
    this.tabs.delete(tabId);
  }
}

// Singleton
self.networkMonitor = new NetworkMonitor();
