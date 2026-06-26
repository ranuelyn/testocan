/**
 * ═══════════════════════════════════════════════════════════════
 *  TESTOCAN — Background Service Worker (Full Orchestrator)
 * ═══════════════════════════════════════════════════════════════
 *  Central brain of the extension:
 *    • Recording lifecycle (start/stop, per-tab state)
 *    • State Machine graph (incremental site mapping)
 *    • Replay orchestration (step-by-step, cross-page)
 *    • Network monitoring (chrome.debugger)
 *    • AI parameterization bridge
 *    • Screenshot capture
 *    • Bug report generation
 *    • Jira integration
 */

// ── Load dependencies (inline for service worker) ────────────
importScripts(
  '../shared/stateGraph.js',
  '../shared/aiEngine.js',
  '../shared/bugReport.js',
  '../shared/jiraIntegration.js',
  '../shared/geminiClient.js',
  './networkMonitor.js'
);

// ── Message Constants ────────────────────────────────────────
const MSG = Object.freeze({
  START_RECORDING:   'TESTOCAN::START_RECORDING',
  STOP_RECORDING:    'TESTOCAN::STOP_RECORDING',
  DOM_EVENT:         'TESTOCAN::DOM_EVENT',
  GET_STATUS:        'TESTOCAN::GET_STATUS',

  START_REPLAY:      'TESTOCAN::START_REPLAY',
  REPLAY_STEP:       'TESTOCAN::REPLAY_STEP',
  REPLAY_RESULT:     'TESTOCAN::REPLAY_RESULT',
  REPLAY_COMPLETE:   'TESTOCAN::REPLAY_COMPLETE',
  STOP_REPLAY:       'TESTOCAN::STOP_REPLAY',

  AI_MODIFY_FLOW:    'TESTOCAN::AI_MODIFY_FLOW',
  RUN_ASSERTION:     'TESTOCAN::RUN_ASSERTION',
  ASSERTION_RESULT:  'TESTOCAN::ASSERTION_RESULT',
  TAKE_SCREENSHOT:   'TESTOCAN::TAKE_SCREENSHOT',
  GENERATE_REPORT:   'TESTOCAN::GENERATE_REPORT',

  JIRA_SAVE_CONFIG:  'TESTOCAN::JIRA_SAVE_CONFIG',
  JIRA_GET_CONFIG:   'TESTOCAN::JIRA_GET_CONFIG',
  JIRA_CREATE_ISSUE: 'TESTOCAN::JIRA_CREATE_ISSUE',

  GET_FLOWS:         'TESTOCAN::GET_FLOWS',
  DELETE_FLOW:       'TESTOCAN::DELETE_FLOW',
  CLEAR_FLOWS:       'TESTOCAN::CLEAR_FLOWS',
  GET_GRAPH:         'TESTOCAN::GET_GRAPH',
  GET_ERRORS:        'TESTOCAN::GET_ERRORS',

  GEMINI_SAVE_KEY:   'TESTOCAN::GEMINI_SAVE_KEY',
  GEMINI_GET_STATUS: 'TESTOCAN::GEMINI_GET_STATUS',
  AI_ENHANCE_REPORT: 'TESTOCAN::AI_ENHANCE_REPORT',

  SPLIT_TASK:           'TESTOCAN::SPLIT_TASK',
  SYNTHESIZE_TASK_FLOW: 'TESTOCAN::SYNTHESIZE_TASK_FLOW',
  START_TASK_RUN:       'TESTOCAN::START_TASK_RUN',
  GET_TASK_STATUS:      'TESTOCAN::GET_TASK_STATUS',
  ENHANCE_TASK_REPORT:    'TESTOCAN::ENHANCE_TASK_REPORT',
  ANALYZE_KNOWLEDGE_GAPS: 'TESTOCAN::ANALYZE_KNOWLEDGE_GAPS',
  GET_KNOWLEDGE_TREE:     'TESTOCAN::GET_KNOWLEDGE_TREE',
  CLEAR_KNOWLEDGE:        'TESTOCAN::CLEAR_KNOWLEDGE',
  SHOW_FLOATING_WIDGET:   'TESTOCAN::SHOW_FLOATING_WIDGET',
  OPEN_SIDE_PANEL:        'TESTOCAN::OPEN_SIDE_PANEL',
});

// ── Per-tab state ────────────────────────────────────────────
const tabState = new Map();
let stateGraph = new StateGraph();

// Load persisted graph
chrome.storage.local.get('stateGraph', (data) => {
  if (data.stateGraph) {
    stateGraph = new StateGraph(data.stateGraph);
    console.log(`[Testocan BG] Loaded state graph: ${stateGraph.stats.nodeCount} nodes, ${stateGraph.stats.edgeCount} edges`);
  }
});

function getTabState(tabId) {
  if (!tabState.has(tabId)) {
    tabState.set(tabId, {
      isRecording: false,
      isReplaying: false,
      events: [],
      startedAt: null,
      lastUrl: null,
      replayState: null,
      taskRunState: null,
    });
  }
  return tabState.get(tabId);
}

function persistGraph() {
  chrome.storage.local.set({ stateGraph: stateGraph.serialize() });
}

// ── Message Router ───────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message;
  const tabId = sender.tab?.id || payload?.tabId;

  switch (type) {
    case MSG.START_RECORDING:
      handleStartRecording(tabId, sendResponse);
      return true;

    case MSG.STOP_RECORDING:
      handleStopRecording(tabId, sendResponse);
      return true;

    case MSG.DOM_EVENT:
      handleDomEvent(tabId, payload);
      sendResponse({ ok: true });
      return false;

    case MSG.GET_STATUS:
      handleGetStatus(tabId, sendResponse);
      return false;

    case MSG.START_REPLAY:
      handleStartReplay(tabId, payload, sendResponse);
      return true;

    case MSG.STOP_REPLAY:
      handleStopReplay(tabId, sendResponse);
      return false;

    case MSG.REPLAY_RESULT:
      handleReplayResult(tabId || sender.tab?.id, payload);
      sendResponse({ ok: true });
      return false;

    case MSG.AI_MODIFY_FLOW:
      handleAIModify(payload, sendResponse);
      return true;

    case MSG.GEMINI_SAVE_KEY:
      GeminiClient.saveApiKey(payload.apiKey).then(() => sendResponse({ ok: true }));
      return true;

    case MSG.GEMINI_GET_STATUS:
      GeminiClient.isConfigured().then((configured) => sendResponse({ ok: true, configured }));
      return true;

    case MSG.AI_ENHANCE_REPORT:
      handleEnhanceReport(payload, sendResponse);
      return true;

    case MSG.RUN_ASSERTION:
      handleRunAssertion(tabId, payload, sendResponse);
      return true;

    case MSG.TAKE_SCREENSHOT:
      handleTakeScreenshot(tabId, sendResponse);
      return true;

    case MSG.GENERATE_REPORT:
      handleGenerateReport(tabId, payload, sendResponse);
      return true;

    case MSG.JIRA_SAVE_CONFIG:
      JiraClient.saveConfig(payload).then(() => sendResponse({ ok: true }));
      return true;

    case MSG.JIRA_GET_CONFIG:
      JiraClient.getConfig().then((config) => sendResponse({ ok: true, config }));
      return true;

    case MSG.JIRA_CREATE_ISSUE:
      handleJiraCreate(payload, sendResponse);
      return true;

    case MSG.GET_FLOWS:
      chrome.storage.local.get('flows', (data) => {
        sendResponse({ ok: true, flows: data.flows || [] });
      });
      return true;

    case MSG.OPEN_SIDE_PANEL:
      // Open the side panel for the current tab
      const tabToOpen = sender.tab?.id || tabId;
      if (tabToOpen && chrome.sidePanel && chrome.sidePanel.open) {
        chrome.sidePanel.open({ tabId: tabToOpen }).catch(err => console.error("SidePanel open err:", err));
      }
      sendResponse({ ok: true });
      return false;

    case MSG.DELETE_FLOW:
      handleDeleteFlow(payload, sendResponse);
      return true;

    case MSG.SAVE_FLOW:
      handleSaveFlow(payload, sendResponse);
      return true;

    case MSG.CLEAR_FLOWS:
      chrome.storage.local.set({ flows: [] });
      sendResponse({ ok: true });
      return false;

    case MSG.GET_GRAPH:
      sendResponse({
        ok: true,
        graph: stateGraph.serialize(),
        stats: stateGraph.stats,
        mermaid: stateGraph.toMermaid(),
      });
      return false;

    case MSG.GET_ERRORS:
      sendResponse({ ok: true, errors: self.networkMonitor.getErrors(tabId) });
      return false;

    // ── Tasks ──
    case MSG.SPLIT_TASK:
      GeminiClient.splitTask(payload.prompt, payload.availableFlows || []).then(sendResponse);
      return true;

    case MSG.SYNTHESIZE_TASK_FLOW:
      // payload.lessonFlows: [{ id, label, events }] — multi-source knowledge bank
      GeminiClient.synthesizeTaskFlow(payload.lessonFlows, payload.targetFlowDesc).then(sendResponse);
      return true;

    case MSG.START_TASK_RUN:
      handleStartTaskRun(tabId, payload, sendResponse);
      return true;

    case MSG.GET_TASK_STATUS:
      sendResponse({ ok: true, taskRunState: getTabState(tabId).taskRunState });
      return false;

    case MSG.ENHANCE_TASK_REPORT:
      GeminiClient.enhanceTaskReport(payload.taskData).then(sendResponse);
      return true;

    case MSG.ANALYZE_KNOWLEDGE_GAPS:
      GeminiClient.analyzeKnowledgeGaps(payload.taskDesc, payload.taskFlows, payload.primaryFlowEvents).then(sendResponse);
      return true;

    case MSG.GET_KNOWLEDGE_TREE:
      sendResponse({
        ok: true,
        tree: stateGraph.toTree(),
        stats: stateGraph.stats,
      });
      return false;

    case MSG.CLEAR_KNOWLEDGE:
      stateGraph = new StateGraph();
      persistGraph();
      sendResponse({ ok: true });
      return false;

    default:
      return false;
  }
});

// ── Recording Handlers ───────────────────────────────────────

async function handleStartRecording(tabId, sendResponse) {
  if (!tabId) { sendResponse({ ok: false, error: 'No tabId' }); return; }

  const state = getTabState(tabId);
  state.isRecording = true;
  state.events = [];
  state.startedAt = Date.now();
  state.lastUrl = null;

  // Inject content script
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/index.js'],
    });
  } catch (err) {
    console.warn('[Testocan BG] Inject note:', err.message);
  }

  await new Promise((r) => setTimeout(r, 100));

  // Attach network monitor
  await self.networkMonitor.attach(tabId);
  self.networkMonitor.clear(tabId);

  // Tell content script to start
  try {
    await chrome.tabs.sendMessage(tabId, { type: MSG.START_RECORDING });
    console.log(`[Testocan BG] Recording started on tab ${tabId}`);
    sendResponse({ ok: true });
  } catch (err) {
    console.error('[Testocan BG] Failed to start:', err);
    state.isRecording = false;
    sendResponse({ ok: false, error: err.message });
  }
}

async function handleStopRecording(tabId, sendResponse) {
  if (!tabId) { sendResponse({ ok: false, error: 'No tabId' }); return; }

  const state = getTabState(tabId);
  state.isRecording = false;

  try {
    await chrome.tabs.sendMessage(tabId, { type: MSG.STOP_RECORDING });
  } catch (err) {
    console.warn('[Testocan BG] Stop message failed:', err);
  }

  // Detach network monitor
  await self.networkMonitor.detach(tabId);

  // Get captured errors
  const errors = self.networkMonitor.getAll(tabId);

  // Build the recorded flow
  const flow = {
    id: crypto.randomUUID(),
    tabId,
    startedAt: state.startedAt,
    stoppedAt: Date.now(),
    events: [...state.events],
    url: state.events[0]?.url || null,
    errors,
  };

  // Save flow (slimmed to avoid Chrome 5 MB storage quota)
  try {
    const { flows = [] } = await chrome.storage.local.get('flows');
    flows.push(slimFlow(flow));
    await chrome.storage.local.set({ flows });
    console.log(`[Testocan BG] Flow saved: ${flow.events.length} events, id=${flow.id}`);
  } catch (err) {
    console.error('[Testocan BG] Failed to save flow:', err);
  }

  // Persist graph
  persistGraph();

  sendResponse({ ok: true, flow });
}

function handleDomEvent(tabId, payload) {
  const state = getTabState(tabId);
  if (!state.isRecording) return;

  const event = {
    ...payload,
    timestamp: Date.now(),
    sequence: state.events.length,
  };

  state.events.push(event);

  // State machine: track navigation edges
  if (payload.action === 'navigation' && state.lastUrl && payload.url !== state.lastUrl) {
    stateGraph.addNode(state.lastUrl, '');
    stateGraph.addNode(payload.url, payload.pageTitle);
    stateGraph.addEdge(state.lastUrl, payload.url, 'navigate');
  }

  if (payload.action === 'click' && payload.locator) {
    const label = payload.locator.innerText?.slice(0, 30) || payload.locator.ariaLabel || 'click';
    // Edge will be created when navigation happens next
    state._pendingAction = { action: `click: ${label}`, url: payload.url };

    // Knowledge Tree: record click interaction on current page
    stateGraph.addInteraction(
      payload.url,
      'click',
      label,
      payload.locator
    );
  }

  // Knowledge Tree: record input/change interactions
  if ((payload.action === 'input' || payload.action === 'change') && payload.locator) {
    const fieldLabel = payload.locator.placeholder || payload.locator.name || payload.locator.ariaLabel || payload.locator.id || payload.locator.tagName || 'field';
    stateGraph.addInteraction(
      payload.url,
      payload.action,
      fieldLabel,
      payload.locator
    );
  }

  // Knowledge Tree: record form submit
  if (payload.action === 'submit' && payload.locator) {
    stateGraph.addInteraction(
      payload.url,
      'submit',
      'Form Gönderimi',
      payload.locator
    );
  }

  if (payload.url) {
    // Track pending click → navigation edge
    if (state._pendingAction && state._pendingAction.url !== payload.url) {
      stateGraph.addEdge(state._pendingAction.url, payload.url, state._pendingAction.action);
      state._pendingAction = null;
    }
    state.lastUrl = payload.url;
    stateGraph.addNode(payload.url, payload.pageTitle || '');
  }

  console.log(
    `[Testocan BG] Event #${event.sequence}: ${event.action} on <${event.locator?.tagName}>`,
    event.locator?.innerText?.slice(0, 30) || ''
  );
}

function handleGetStatus(tabId, sendResponse) {
  if (!tabId) {
    // Try to find any recording tab
    for (const [tid, state] of tabState) {
      if (state.isRecording) {
        sendResponse({
          ok: true,
          isRecording: true,
          isReplaying: state.isReplaying,
          eventCount: state.events.length,
          startedAt: state.startedAt,
        });
        return;
      }
    }
    sendResponse({ ok: true, isRecording: false, isReplaying: false, eventCount: 0 });
    return;
  }

  const state = getTabState(tabId);
  sendResponse({
    ok: true,
    isRecording: state.isRecording,
    isReplaying: state.isReplaying,
    eventCount: state.events.length,
    startedAt: state.startedAt,
    replayState: state.replayState,
    taskRunState: state.taskRunState,
  });
}

// ── Replay Handlers ──────────────────────────────────────────

async function handleStartReplay(tabId, payload, sendResponse) {
  if (!tabId) { sendResponse({ ok: false, error: 'No tabId' }); return; }

  const { flow, speed = 'normal', assertions = [] } = payload;
  if (!flow || !flow.events) {
    sendResponse({ ok: false, error: 'No flow provided' });
    return;
  }

  const state = getTabState(tabId);
  state.isReplaying = true;

  // Filter out non-replayable events and deduplicate input/change
  const replayableEvents = filterReplayableEvents(flow.events);

  state.replayState = {
    flow,
    events: replayableEvents,
    currentStep: 0,
    totalSteps: replayableEvents.length,
    results: [],
    speed,
    assertions,
    status: 'running',
  };

  // Inject replay engine
  try {
    const currentTab = await chrome.tabs.get(tabId);
    const startUrl = flow.url || (replayableEvents[0] && replayableEvents[0].url);
    
    if (startUrl && currentTab.url !== startUrl) {
      try {
        const _currU = new URL(currentTab.url);
        const _startU = new URL(startUrl);
        // Compare origins/paths; you can just compare hrefs. If it's a new tab, url is chrome://newtab
        if (_currU.href !== _startU.href) {
          console.log(`[Testocan BG] Navigating to start URL: ${startUrl}`);
          await new Promise((resolve) => {
            let handled = false;
            const timeout = setTimeout(() => {
              if (!handled) { handled = true; resolve(); }
            }, 5000);
            
            const listener = (uTabId, changeInfo) => {
              if (uTabId === tabId && changeInfo.status === 'complete' && !handled) {
                chrome.tabs.onUpdated.removeListener(listener);
                handled = true;
                clearTimeout(timeout);
                setTimeout(resolve, 800); // Allow DOM to settle
              }
            };
            chrome.tabs.onUpdated.addListener(listener);
            chrome.tabs.update(tabId, { url: startUrl });
          });
        }
      } catch (err) {
        if (currentTab.url === 'chrome://newtab/' || currentTab.url === '') {
          await chrome.tabs.update(tabId, { url: startUrl });
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/replay.js'],
    });
  } catch (err) {
    console.warn('[Testocan BG] Replay inject/navigate note:', err.message);
  }

  // Attach network monitor for error capture during replay
  await self.networkMonitor.attach(tabId);
  self.networkMonitor.clear(tabId);

  sendResponse({ ok: true });

  // Start executing steps
  await executeNextReplayStep(tabId);
}

function filterReplayableEvents(events) {
  const replayable = [];
  const seen = new Map(); // track last input per element key

  for (const event of events) {
    if (event.action === 'scroll' || event.action === 'focus' || event.action === 'navigation') {
      continue;
    }

    // For input events, only keep the last value per element
    if (event.action === 'input') {
      const key = event.locator?.name || event.locator?.id || event.locator?.cssSelector || JSON.stringify(event.locator);
      seen.set(key, event);
      continue;
    }

    // If we have a pending input for a different element, flush it
    if (event.action === 'change') {
      const key = event.locator?.name || event.locator?.id || event.locator?.cssSelector || JSON.stringify(event.locator);
      seen.delete(key); // change replaces input for same field
      replayable.push(event);
      continue;
    }

    // Flush any pending inputs before adding this event
    for (const [, inputEvent] of seen) {
      replayable.push(inputEvent);
    }
    seen.clear();

    replayable.push(event);
  }

  // Flush remaining inputs
  for (const [, inputEvent] of seen) {
    replayable.push(inputEvent);
  }

  return replayable;
}

async function executeNextReplayStep(tabId) {
  const state = getTabState(tabId);
  if (!state.isReplaying || !state.replayState) return;

  const rs = state.replayState;
  if (rs.currentStep >= rs.events.length) {
    // Replay complete — run assertions
    await runPostReplayAssertions(tabId);
    return;
  }

  // Wait for the tab to finish loading if a navigation is in progress
  try {
    let tab = await chrome.tabs.get(tabId);
    let waitCycles = 0;
    while (tab.status === 'loading' && waitCycles < 30) { // Max 15 seconds wait
      console.log(`[Testocan BG] Tab is loading, waiting before step ${rs.currentStep}...`);
      await new Promise((r) => setTimeout(r, 500));
      tab = await chrome.tabs.get(tabId);
      waitCycles++;
    }
    // Give it a tiny extra breathing room after status turns complete
    if (waitCycles > 0) {
      await new Promise((r) => setTimeout(r, 800));
    }
  } catch (err) {
    console.warn('[Testocan BG] Error checking tab status:', err);
  }

  const step = rs.events[rs.currentStep];
  const delayMs = rs.speed === 'fast' ? 300 : rs.speed === 'slow' ? 1500 : 700;

  // Send step to content script
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: MSG.REPLAY_STEP,
      payload: { step, stepIndex: rs.currentStep },
    });
  } catch (err) {
    // Content script might not be ready (page navigation or still loading)
    console.log(`[Testocan BG] Content script missing for step ${rs.currentStep}, waiting for page load...`);
    
    try {
      let tab = await chrome.tabs.get(tabId);
      let waitCycles = 0;
      while (tab.status === 'loading' && waitCycles < 20) { // Max 10 seconds wait
        await new Promise((r) => setTimeout(r, 500));
        tab = await chrome.tabs.get(tabId);
        waitCycles++;
      }
    } catch (e) {}

    // Wait extra time and re-inject
    await new Promise((r) => setTimeout(r, 1000));
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/replay.js'],
      });
      await new Promise((r) => setTimeout(r, 200));
      await chrome.tabs.sendMessage(tabId, {
        type: MSG.REPLAY_STEP,
        payload: { step, stepIndex: rs.currentStep },
      });
    } catch (retryErr) {
      rs.results.push({
        stepIndex: rs.currentStep,
        result: { success: false, error: 'Content script unreachable: ' + retryErr.message },
      });
      rs.currentStep++;
      setTimeout(() => executeNextReplayStep(tabId), delayMs);
    }
  }
}

async function handleReplayResult(tabId, payload) {
  const state = getTabState(tabId);
  if (!state.replayState) return;

  const rs = state.replayState;
  rs.results.push(payload);

  if (payload.result && payload.result.success === false) {
    console.log('[Testocan BG] Replay step failed, aborting flow to capture exact moment:', payload.result.error);
    try {
      const tab = await chrome.tabs.get(tabId);
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
      rs.failureScreenshot = dataUrl;
    } catch (e) {
      console.warn('Could not capture failure screenshot:', e);
    }
    // Fast-forward to the end to stop executing further steps
    rs.currentStep = rs.events.length;
  } else {
    rs.currentStep = payload.stepIndex + 1;
  }

  const delayMs = rs.speed === 'fast' ? 300 : rs.speed === 'slow' ? 1500 : 700;
  setTimeout(() => executeNextReplayStep(tabId), delayMs);
}

async function runPostReplayAssertions(tabId) {
  const state = getTabState(tabId);
  const rs = state.replayState;

  const assertionResults = [];

  if (rs.assertions && rs.assertions.length > 0) {
    for (const assertion of rs.assertions) {
      try {
        const response = await chrome.tabs.sendMessage(tabId, {
          type: MSG.RUN_ASSERTION,
          payload: { assertion },
        });
        if (response?.result) {
          assertionResults.push(response.result);
        }
      } catch (err) {
        assertionResults.push({
          type: assertion.type,
          passed: false,
          message: 'Failed to run assertion: ' + err.message,
        });
      }
    }
  }

  // Check for network errors
  const errors = self.networkMonitor.getErrors(tabId);
  if (errors.networkErrors.length > 0) {
    assertionResults.push({
      type: 'noNetworkErrors',
      passed: false,
      message: `${errors.networkErrors.length} network error(s) detected`,
    });
  }

  // Detach monitor
  await self.networkMonitor.detach(tabId);

  // Mark replay complete
  rs.status = 'complete';
  rs.assertionResults = assertionResults;
  rs.errors = self.networkMonitor.getAll(tabId);
  console.log(`[Testocan BG] Replay complete: ${rs.results.length} steps, ${assertionResults.length} assertions`);

  // Handle Orchestrator Queue if running a Task
  if (state.taskRunState && state.taskRunState.status === 'running') {
    state.taskRunState.results.push({
      flowId: rs.flow.id,
      flowName: rs.flow.name,
      assertionResults,
      errors: rs.errors,
      replayResults: rs.results,
      failureScreenshot: rs.failureScreenshot,
    });
    
    state.taskRunState.currentFlowIndex++;
    
    if (state.taskRunState.currentFlowIndex >= state.taskRunState.task.flows.length) {
      // Task finished completely
      state.taskRunState.status = 'complete';
      state.isReplaying = false;
      console.log('[Testocan BG] Task Run completely finished.');
    } else {
      // We have more flows to run, start the next one
      state.isReplaying = false; // Reset lock to allow next start
      const nextFlow = state.taskRunState.task.flows[state.taskRunState.currentFlowIndex];
      console.log(`[Testocan BG] Starting next flow in Task Queue: ${nextFlow.name}`);
      
      // Artificial delay before triggering the next flow to give UI/DOM breathing room after logout
      setTimeout(() => {
        handleStartReplay(tabId, { flow: nextFlow, speed: state.taskRunState.speed, assertions: [] }, () => {});
      }, 1500);
    }
  } else {
    // Normal single-flow replay finish
    state.isReplaying = false;
  }
}

async function handleStartTaskRun(tabId, payload, sendResponse) {
  const state = getTabState(tabId);
  if (state.isRecording || state.isReplaying) {
    sendResponse({ ok: false, error: 'Bir eylem zaten çalışıyor.' });
    return;
  }

  const { task, speed = 'normal' } = payload;
  if (!task || !task.flows || task.flows.length === 0) {
    sendResponse({ ok: false, error: 'Geçersiz görev akışı.' });
    return;
  }

  state.taskRunState = {
    task,
    currentFlowIndex: 0,
    speed,
    status: 'running',
    results: []
  };

  sendResponse({ ok: true });
  // Start the very first flow in the queue
  handleStartReplay(tabId, { flow: task.flows[0], speed, assertions: [] }, () => {});
}

function handleStopReplay(tabId, sendResponse) {
  const state = getTabState(tabId);
  state.isReplaying = false;
  if (state.replayState) {
    state.replayState.status = 'cancelled';
  }
  self.networkMonitor.detach(tabId);
  sendResponse({ ok: true });
}

// ── AI Modification (Gemini-powered with rule-based fallback) ──

async function handleAIModify(payload, sendResponse) {
  const { prompt, events } = payload;

  // Try Gemini first
  const geminiConfigured = await GeminiClient.isConfigured();
  if (geminiConfigured) {
    console.log('[Testocan BG] Using Gemini AI for flow modification...');
    const geminiResult = await GeminiClient.modifyFlow(prompt, events);
    if (geminiResult.ok) {
      sendResponse({ ok: true, modifiedEvents: geminiResult.modifiedEvents, changes: geminiResult.changes, source: 'gemini' });
      return;
    }
    console.warn('[Testocan BG] Gemini failed:', geminiResult.error);
    sendResponse({ ok: false, error: 'Gemini API Error: ' + geminiResult.error });
    return;
  }

  // Fallback to rule-based NLP ONLY if API key is not configured
  console.log('[Testocan BG] Using rule-based NLP for flow modification...');
  const result = AIEngine.parseAndModify(prompt, events);
  sendResponse({ ok: true, ...result, source: 'rule-based' });
}

// ── Assertions ───────────────────────────────────────────────

async function handleRunAssertion(tabId, payload, sendResponse) {
  try {
    // Inject replay engine (which has assertion runner)
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/replay.js'],
    });
    await new Promise((r) => setTimeout(r, 100));

    const response = await chrome.tabs.sendMessage(tabId, {
      type: MSG.RUN_ASSERTION,
      payload: { assertion: payload.assertion },
    });
    sendResponse({ ok: true, result: response?.result });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

// ── Screenshot ───────────────────────────────────────────────

async function handleTakeScreenshot(tabId, sendResponse) {
  if (!tabId) {
    sendResponse({ ok: false, error: 'No active tab for screenshot' });
    return;
  }
  try {
    const tab = await chrome.tabs.get(tabId);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'png',
      quality: 90,
    });
    console.log('[Testocan BG] Screenshot captured, size:', dataUrl?.length);
    sendResponse({ ok: true, screenshot: dataUrl });
  } catch (err) {
    console.error('[Testocan BG] Screenshot failed:', err);
    sendResponse({ ok: false, error: 'Screenshot failed: ' + err.message });
  }
}

// ── Bug Report ───────────────────────────────────────────────

async function handleGenerateReport(tabId, payload, sendResponse) {
  try {
    const { flow, assertionResults = [], screenshot = null, prompt = null } = payload;

    // Get errors from network monitor (may be empty if monitor was detached)
    let errors = { requests: [], consoleErrors: [], jsErrors: [] };
    if (tabId) {
      try { errors = self.networkMonitor.getAll(tabId); } catch (e) {}
    }
    // Also use errors stored in the flow itself
    if (flow?.errors) {
      errors = { ...errors, ...flow.errors };
    }

    let report = BugReport.generate({
      flow, errors, assertionResults, screenshot, prompt,
    });

    console.log('[Testocan BG] Bug report generated:', report.title);

    // Auto-enhance with Gemini if configured
    if (await GeminiClient.isConfigured()) {
      console.log('[Testocan BG] Auto-enhancing bug report with Gemini...');
      report = await GeminiClient.enhanceBugReport(report);
    }

    sendResponse({ ok: true, report });
  } catch (err) {
    console.error('[Testocan BG] Report generation failed:', err);
    sendResponse({ ok: false, error: 'Report generation failed: ' + err.message });
  }
}

// ── AI Enhance Report ────────────────────────────────────────

async function handleEnhanceReport(payload, sendResponse) {
  try {
    const enhanced = await GeminiClient.enhanceBugReport(payload.report);
    sendResponse({ ok: true, report: enhanced });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

// ── Jira ─────────────────────────────────────────────────────

async function handleJiraCreate(payload, sendResponse) {
  const result = await JiraClient.createIssue(payload.report);
  sendResponse({ ok: true, ...result });
}

// ── Flow Management ──────────────────────────────────────────

async function handleDeleteFlow(payload, sendResponse) {
  const { flows = [] } = await chrome.storage.local.get('flows');
  const filtered = flows.filter((f) => f.id !== payload.flowId);
  await chrome.storage.local.set({ flows: filtered });
  sendResponse({ ok: true });
}

/**
 * Strip large/redundant fields from events before persisting to Chrome storage.
 * Chrome storage limit is 5 MB total — locators can contain large innerText/HTML.
 */
function slimFlow(flow) {
  // Guard: if flow is falsy or has no events array, return as-is
  if (!flow) return flow;
  const slimmedEvents = (flow.events || []).map(e => {
    if (!e || !e.locator) return e;
    const { innerHTML, outerHTML, innerText, ...rest } = e.locator;
    return {
      ...e,
      locator: {
        ...rest,
        innerText: innerText ? innerText.slice(0, 100) : undefined,
      }
    };
  });
  return { ...flow, events: slimmedEvents };
}

async function handleSaveFlow(payload, sendResponse) {
  if (!payload || !payload.flow) {
    console.error('[Testocan BG] handleSaveFlow called without a valid flow payload');
    sendResponse({ ok: false, error: 'Geçersiz akış verisi: flow tanımlanmamış.' });
    return;
  }
  try {
    const { flows = [] } = await chrome.storage.local.get('flows');
    const slimmed = slimFlow(payload.flow);
    flows.push(slimmed);
    await chrome.storage.local.set({ flows });
    console.log(`[Testocan BG] Flow saved: ${slimmed.id} (${slimmed.name || 'unnamed'})`);
    sendResponse({ ok: true });
  } catch (err) {
    const isQuota = err.message?.includes('QUOTA_BYTES') || err.message?.includes('quota') || err.name === 'QuotaExceededError';
    const msg = isQuota
      ? 'Depolama dolu! History sayfasından eski akışları temizleyin ve tekrar deneyin.'
      : err.message;
    console.error('[Testocan BG] Save flow error:', err.message);
    sendResponse({ ok: false, error: msg });
  }
}

// ── Tab cleanup ──────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  self.networkMonitor.cleanup(tabId);
  tabState.delete(tabId);
});

// ── Re-inject content script on navigation during recording ──
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  const state = tabState.get(tabId);
  if (!state) return;

  if (state.isRecording) {
    // Re-inject content script on every page load while recording
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/index.js'],
    }).catch(() => {});
  }

  if (state.isReplaying) {
    // Re-inject replay engine on navigation
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/replay.js'],
    }).catch(() => {});
  }
});

// ── Side Panel: open on action icon click ────────────────────
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch(err => console.warn('[Testocan BG] setPanelBehavior failed:', err));

console.log('[Testocan BG] Service worker initialized (v3 — side panel + knowledge tree).');
