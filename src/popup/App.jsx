import React, { useState, useEffect, useCallback, useRef } from 'react';
import logoSrc from './logo.png';

const MSG = {
  START_RECORDING: 'TESTOCAN::START_RECORDING',
  STOP_RECORDING: 'TESTOCAN::STOP_RECORDING',
  GET_STATUS: 'TESTOCAN::GET_STATUS',
  START_REPLAY: 'TESTOCAN::START_REPLAY',
  STOP_REPLAY: 'TESTOCAN::STOP_REPLAY',
  AI_MODIFY_FLOW: 'TESTOCAN::AI_MODIFY_FLOW',
  RUN_ASSERTION: 'TESTOCAN::RUN_ASSERTION',
  TAKE_SCREENSHOT: 'TESTOCAN::TAKE_SCREENSHOT',
  GENERATE_REPORT: 'TESTOCAN::GENERATE_REPORT',
  JIRA_SAVE_CONFIG: 'TESTOCAN::JIRA_SAVE_CONFIG',
  JIRA_GET_CONFIG: 'TESTOCAN::JIRA_GET_CONFIG',
  JIRA_CREATE_ISSUE: 'TESTOCAN::JIRA_CREATE_ISSUE',
  GET_FLOWS: 'TESTOCAN::GET_FLOWS',
  DELETE_FLOW: 'TESTOCAN::DELETE_FLOW',
  CLEAR_FLOWS: 'TESTOCAN::CLEAR_FLOWS',
  GET_GRAPH: 'TESTOCAN::GET_GRAPH',
  GET_ERRORS: 'TESTOCAN::GET_ERRORS',
  GEMINI_SAVE_KEY: 'TESTOCAN::GEMINI_SAVE_KEY',
  GEMINI_GET_STATUS: 'TESTOCAN::GEMINI_GET_STATUS',
  AI_ENHANCE_REPORT: 'TESTOCAN::AI_ENHANCE_REPORT',
  SAVE_FLOW: 'TESTOCAN::SAVE_FLOW',
  SPLIT_TASK: 'TESTOCAN::SPLIT_TASK',
  SYNTHESIZE_TASK_FLOW: 'TESTOCAN::SYNTHESIZE_TASK_FLOW',
  START_TASK_RUN: 'TESTOCAN::START_TASK_RUN',
  GET_TASK_STATUS: 'TESTOCAN::GET_TASK_STATUS',
  ENHANCE_TASK_REPORT: 'TESTOCAN::ENHANCE_TASK_REPORT',
  ANALYZE_KNOWLEDGE_GAPS: 'TESTOCAN::ANALYZE_KNOWLEDGE_GAPS',
};

const ACTION_ICONS = { click: '🖱️', input: '⌨️', change: '✏️', keydown: '⏎', submit: '📤', navigation: '🧭', scroll: '📜', focus: '🎯' };

function getStepLabel(event) {
  const loc = event.locator || {};
  switch (event.action) {
    case 'click': return `Tıklandı "${loc.innerText?.slice(0, 30) || loc.ariaLabel || loc.id || loc.tagName}"`;
    case 'input': case 'change': {
      const field = loc.placeholder || loc.name || loc.ariaLabel || loc.id || loc.tagName;
      const val = event.value?.length > 20 ? event.value.slice(0, 20) + '…' : event.value;
      return `"${val}" yazıldı → ${field}`;
    }
    case 'keydown': return `Tuşa basıldı: ${event.key}`;
    case 'submit': return `Form gönderildi`;
    case 'navigation': return `Sayfaya geçildi`;
    default: return `${event.action} → <${loc.tagName}>`;
  }
}

function getStepMeta(event) {
  const loc = event.locator || {};
  if (loc.testId) return `data-testid="${loc.testId}"`;
  if (loc.id) return `#${loc.id}`;
  if (loc.name) return `name="${loc.name}"`;
  if (loc.cssSelector) return loc.cssSelector.length > 45 ? loc.cssSelector.slice(0, 45) + '…' : loc.cssSelector;
  return `<${loc.tagName || '?'}>`;
}

const VIEW = { IDLE: 'idle', RECORDING: 'recording', RESULT: 'result', HISTORY: 'history', REPLAY: 'replay', SETTINGS: 'settings', TASKS: 'tasks' };

function sendMsg(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, payload }, (res) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(res);
    });
  });
}

/** Trim large locator fields to keep storage small. */
function slimFlowEvents(events) {
  return (events || []).map(e => {
    if (!e.locator) return e;
    const { innerHTML, outerHTML, innerText, ...rest } = e.locator;
    return { ...e, locator: { ...rest, innerText: innerText ? innerText.slice(0, 100) : undefined } };
  });
}

/** Save a flow directly from the popup (bypasses service worker lifecycle issues). */
async function saveFlowDirect(flow) {
  try {
    const slimmed = { ...flow, events: slimFlowEvents(flow.events) };
    const data = await chrome.storage.local.get('flows');
    const flows = data.flows || [];
    flows.push(slimmed);
    await chrome.storage.local.set({ flows });
    return { ok: true };
  } catch (err) {
    const isQuota = err.message?.includes('QUOTA_BYTES') || err.message?.includes('quota') || err.name === 'QuotaExceededError';
    return { ok: false, error: isQuota ? 'Depolama dolu! History\'den eski ak\u0131\u015flar\u0131 temizleyin.' : err.message };
  }
}

export default function App() {
  const [view, setView] = useState(VIEW.IDLE);
  const [eventCount, setEventCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(null);
  const [tabId, setTabId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastFlow, setLastFlow] = useState(null);
  const [savedFlows, setSavedFlows] = useState([]);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiChanges, setAiChanges] = useState(null);
  const [modifiedEvents, setModifiedEvents] = useState(null);
  const [assertions, setAssertions] = useState([]);
  const [assertionInput, setAssertionInput] = useState('');
  const [replayState, setReplayState] = useState(null);
  const [replaySpeed, setReplaySpeed] = useState('normal');
  const [screenshot, setScreenshot] = useState(null);
  const [bugReport, setBugReport] = useState(null);
  const [aiSource, setAiSource] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const timerRef = useRef(null);
  const bgStartTimeRef = useRef(null);
  const pollRef = useRef(null);

  // Task Orchestration State
  const [tasks, setTasks] = useState([]);
  const [activeTask, setActiveTask] = useState(null);
  const [taskText, setTaskText] = useState('');
  const [taskRunState, setTaskRunState] = useState(null);

  // ── Init ───────────────────────────────────────────────────
  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) { setLoading(false); return; }
      setTabId(tabs[0].id);
      sendMsg(MSG.GET_STATUS, { tabId: tabs[0].id }).then((res) => {
        if (res?.ok) {
          if (res.isRecording) {
            setView(VIEW.RECORDING);
            setEventCount(res.eventCount || 0);
            if (res.startedAt) {
              bgStartTimeRef.current = res.startedAt;
              setElapsed(Math.floor((Date.now() - res.startedAt) / 1000));
            }
          } else if (res.isReplaying) {
            setView(VIEW.REPLAY);
            setReplayState(res.replayState);
          }
        }
        setLoading(false);
      });
    });
    loadFlows();
  }, []);

  function loadFlows() {
    sendMsg(MSG.GET_FLOWS).then((res) => {
      if (res?.ok) setSavedFlows(res.flows || []);
    });
  }

  // ── Polling ────────────────────────────────────────────────
  useEffect(() => {
    if ((view !== VIEW.RECORDING && view !== VIEW.REPLAY) || !tabId) return;
    const interval = setInterval(() => {
      sendMsg(MSG.GET_STATUS, { tabId }).then((res) => {
        if (!res?.ok) return;
        if (view === VIEW.RECORDING) setEventCount(res.eventCount);
        if (view === VIEW.REPLAY && res.taskRunState) {
          setTaskRunState({ ...res.taskRunState });
          if (res.taskRunState.status === 'complete' && !res.isReplaying) {
            setView(VIEW.IDLE);

            // Capture final state asynchronously, then build AI report
            const taskSnap = res.taskRunState;
            ; (async () => {
              try {
                // 1. Take a final screenshot
                const shotRes = await sendMsg(MSG.TAKE_SCREENSHOT, { tabId });
                const finalScreenshot = shotRes?.ok ? shotRes.screenshot : null;

                // 2. Build structured per-flow data for AI
                const tResult = taskSnap.results || [];
                let allPassed = true;
                const flowsData = tResult.map(tr => {
                  const hErr = tr.errors && (tr.errors.networkErrors?.length > 0 || tr.errors.consoleErrors?.length > 0 || tr.errors.jsErrors?.length > 0);
                  const hAss = tr.assertionResults && tr.assertionResults.some(a => !a.passed);
                  const hFail = tr.replayResults && tr.replayResults.some(r => !r.result?.success);
                  const passed = !hErr && !hAss && !hFail;
                  if (!passed) allPassed = false;
                  return {
                    flowName: tr.flowName,
                    passed,
                    failedSteps: (tr.replayResults || []).filter(r => !r.result?.success).map(r => ({
                      action: r.step?.action,
                      label: r.step?.locator?.innerText?.slice(0, 60) || r.step?.locator?.placeholder || r.step?.locator?.id || r.step?.locator?.tagName,
                      cssSelector: r.step?.locator?.cssSelector,
                      error: r.result?.error,
                    })),
                    networkErrors: tr.errors?.networkErrors || [],
                    consoleErrors: tr.errors?.consoleErrors || [],
                    assertionFailures: (tr.assertionResults || []).filter(a => !a.passed),
                  };
                });

                const taskData = {
                  taskName: taskSnap.task?.taskName || 'Bilinmeyen Görev',
                  taskDescription: taskSnap.task?.taskDescription || '',
                  flows: flowsData,
                };

                // 3. Call Gemini to generate comprehensive report
                const enhRes = await sendMsg(MSG.ENHANCE_TASK_REPORT, { taskData });
                const reportMd = enhRes?.ok ? enhRes.description : `# Görev Raporu: ${taskData.taskName}\n\n${flowsData.map((f, i) => `## ${i + 1}. ${f.flowName}\n**Durum:** ${f.passed ? '✅ Başarılı' : '❌ Başarısız'}\n`).join('')}`;

                // 4. Store and open rich report
                const reportPayload = {
                  title: `Görev Raporu: ${taskData.taskName}`,
                  severity: allPassed ? 'Başarılı' : 'Başarısız — Hata Tespit Edildi',
                  description: reportMd,
                  screenshot: finalScreenshot,
                  isTaskReport: true,
                  allPassed,
                  flowSummary: flowsData.map(f => ({ name: f.flowName, passed: f.passed })),
                };

                // 5. Persist lastRunAt + lastReportData to the task so "Görev Raporu Gör" works later
                chrome.storage.local.get(['tasks'], (storageData) => {
                  const currentTasks = storageData.tasks || [];
                  const updatedTasks = currentTasks.map(t => {
                    if (t.taskName === taskData.taskName) {
                      return { ...t, lastRunAt: Date.now(), lastReportData: reportPayload };
                    }
                    return t;
                  });
                  chrome.storage.local.set({ tasks: updatedTasks, report_data_temp: reportPayload }, () => {
                    chrome.tabs.create({ url: chrome.runtime.getURL('report.html') });
                  });
                });

              } catch (err) {
                console.error('[Testocan] Task report generation error:', err);
              }
            })();

            return;
          }
        }

        if (view === VIEW.REPLAY && res.replayState) {
          setReplayState({ ...res.replayState });

          // If we're mid-task-run, individual flow completions are managed by the
          // task orchestrator in the background. Don't switch views or show alerts here.
          const isTaskRunning = res.taskRunState && res.taskRunState.status === 'running';

          if (!isTaskRunning && (res.replayState.status === 'complete' || res.replayState.status === 'cancelled')) {
            setView(VIEW.RESULT);
            setLastFlow({ ...res.replayState.flow, replayResults: res.replayState.results, assertionResults: res.replayState.assertionResults, errors: res.replayState.errors });

            if (res.replayState.status === 'complete') {
              const errs = res.replayState.errors;
              const hasErrors = errs && (errs.networkErrors?.length > 0 || errs.jsErrors?.length > 0 || errs.consoleErrors?.length > 0);
              const hasFailedAssertions = res.replayState.assertionResults && res.replayState.assertionResults.some(a => !a.passed);
              const hasFailedSteps = res.replayState.results && res.replayState.results.some(r => !r.result?.success);

              if (!hasErrors && !hasFailedAssertions && !hasFailedSteps) {
                setTimeout(() => window.alert('🎉 Akış başarıyla tamamlandı. Herhangi bir hataya rastlanmadı!'), 300);
              } else {
                // Background handles replay -> result jump. Launch auto-report without awaiting to avoid blocking UI sync.
                const fullFlow = { ...res.replayState.flow, replayResults: res.replayState.results, assertionResults: res.replayState.assertionResults, errors: errs };

                (async () => {
                  try {
                    setActionLoading('screenshot');
                    const shotRes = await sendMsg(MSG.TAKE_SCREENSHOT, { tabId });
                    let shot = null;
                    if (shotRes?.ok) { shot = shotRes.screenshot; setScreenshot(shot); }

                    setActionLoading('report');
                    const repRes = await sendMsg(MSG.GENERATE_REPORT, {
                      tabId, flow: fullFlow, assertionResults: fullFlow.assertionResults || [], screenshot: shot, prompt: aiPrompt || null
                    });

                    if (repRes?.ok) { setBugReport(repRes.report); }
                    else { setError('Otomatik rapor alınamadı: ' + (repRes?.error || '')); }
                  } catch (e) { console.error(e); }
                  finally { setActionLoading(null); }
                })();
              }
            }
          }
        }

      });
    }, 800);
    return () => clearInterval(interval);
  }, [view, tabId]);

  // ── Timer ──────────────────────────────────────────────────
  useEffect(() => {
    if (view === VIEW.RECORDING && bgStartTimeRef.current) {
      setElapsed(Math.floor((Date.now() - bgStartTimeRef.current) / 1000));
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - bgStartTimeRef.current) / 1000));
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [view]);

  // ── Actions ────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    if (!tabId) { setError('No active tab'); return; }
    setError(null);
    const res = await sendMsg(MSG.START_RECORDING, { tabId });
    if (res?.ok) { setView(VIEW.RECORDING); setEventCount(0); setElapsed(0); bgStartTimeRef.current = Date.now(); }
    else setError(res?.error || 'Failed');
  }, [tabId]);

  const stopRecording = useCallback(async () => {
    if (!tabId) return;
    const res = await sendMsg(MSG.STOP_RECORDING, { tabId });
    if (res?.ok && res.flow) { setLastFlow(res.flow); setView(VIEW.RESULT); loadFlows(); }
    else setView(VIEW.IDLE);
  }, [tabId]);

  const startReplay = useCallback(async (flow, speed = 'normal') => {
    if (!tabId) return;
    const events = modifiedEvents || flow.events;
    const parsedAssertions = [];
    for (const a of assertions) {
      if (typeof a === 'string') {
        // Parse from natural language (done in popup for simplicity)
        const patterns = [
          { regex: /['"]([^'"]+)['"]\s*(?:görünmeli|visible|shown|displayed|var)/i, type: 'textVisible', key: 'text' },
          { regex: /(?:URL|sayfa)\s*.*?['"]?([^\s'"]+)['"]?\s*(?:içermeli|contain)/i, type: 'urlContains', key: 'pattern' },
        ];
        for (const p of patterns) {
          const m = a.match(p.regex);
          if (m) parsedAssertions.push({ type: p.type, [p.key]: m[1] });
        }
        if (parsedAssertions.length === 0) {
          // Default: treat as textVisible
          parsedAssertions.push({ type: 'textVisible', text: a });
        }
      } else {
        parsedAssertions.push(a);
      }
    }

    const res = await sendMsg(MSG.START_REPLAY, { tabId, flow: { ...flow, events }, speed, assertions: parsedAssertions });
    if (res?.ok) { setView(VIEW.REPLAY); setReplayState({ status: 'running', currentStep: 0, totalSteps: events.length }); }
    else setError(res?.error || 'Replay failed');
  }, [tabId, modifiedEvents, assertions]);

  const stopReplay = useCallback(async () => {
    await sendMsg(MSG.STOP_REPLAY, { tabId });
    setView(VIEW.IDLE);
  }, [tabId]);

  const applyAIPrompt = useCallback(async () => {
    if (!aiPrompt || !lastFlow) return;
    setActionLoading('ai');
    setError(null);
    const res = await sendMsg(MSG.AI_MODIFY_FLOW, { prompt: aiPrompt, events: lastFlow.events });
    setActionLoading(null);
    if (res?.ok) {
      setAiChanges(res.changes);
      setModifiedEvents(res.modifiedEvents);
      setAiSource(res.source || 'rule-based');

      // Prompt user to save as a new workflow — done async, directly from popup
      if (res.modifiedEvents && res.modifiedEvents.length > 0) {
        const flowName = window.prompt('AI ile akış başarıyla uyarlandı!\nYeni akışı kaydetmek için bir isim verin (\u0130ptal ederseniz sadece geçici olarak uygulanır):');
        if (flowName && flowName.trim()) {
          const newFlow = {
            ...lastFlow,
            id: crypto.randomUUID(),
            events: res.modifiedEvents,
            aiPrompt: aiPrompt,
            name: flowName.trim()
          };
          const saveRes = await saveFlowDirect(newFlow);
          if (!saveRes.ok) {
            setError(`Akış kaydedilemedi: ${saveRes.error}`);
            return;
          }
          loadFlows();
          setLastFlow(newFlow);
          setAiChanges(null);
          setModifiedEvents(null);
          setAiPrompt('');
        }
      }
    } else {
      setError(res?.error || 'AI parsing failed');
    }
  }, [aiPrompt, lastFlow]);

  const takeScreenshot = useCallback(async () => {
    setActionLoading('screenshot');
    setError(null);
    const res = await sendMsg(MSG.TAKE_SCREENSHOT, { tabId });
    setActionLoading(null);
    if (res?.ok) {
      setScreenshot(res.screenshot);
    } else {
      setError(res?.error || 'Screenshot failed — make sure the tab is active.');
    }
  }, [tabId]);

  const generateReport = useCallback(async () => {
    if (!lastFlow) return;
    setActionLoading('report');
    setError(null);
    const res = await sendMsg(MSG.GENERATE_REPORT, { tabId, flow: lastFlow, assertionResults: lastFlow.assertionResults || [], screenshot, prompt: aiPrompt || null });
    setActionLoading(null);
    if (res?.ok) {
      setBugReport(res.report);
    } else {
      setError(res?.error || 'Bug report generation failed.');
    }
  }, [tabId, lastFlow, screenshot, aiPrompt]);

  const createJiraIssue = useCallback(async () => {
    if (!bugReport) return;
    const res = await sendMsg(MSG.JIRA_CREATE_ISSUE, { report: bugReport });
    if (res?.ok && res.success) {
      setError(null);
      alert(`✅ Jira issue created: ${res.issueKey}\n${res.issueUrl}`);
    } else {
      setError(res?.error || 'Jira creation failed');
    }
  }, [bugReport]);

  const formatTime = (s) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
  const formatDate = (ts) => new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

  if (loading) return <div className="testocan-popup"><Header /><div className="action-section"><p className="hint">Bağlanıyor…</p></div></div>;

  return (
    <div className="testocan-popup">
      <Header
        onHistoryClick={() => setView(view === VIEW.HISTORY ? VIEW.IDLE : VIEW.HISTORY)}
        onSettingsClick={() => setView(view === VIEW.SETTINGS ? VIEW.IDLE : VIEW.SETTINGS)}
        onTasksClick={() => setView(view === VIEW.TASKS ? VIEW.IDLE : VIEW.TASKS)}
        showNav={view !== VIEW.RECORDING && view !== VIEW.REPLAY}
        flowCount={savedFlows.length}
      />

      {view === VIEW.IDLE && (
        <>
          <StatusBar recording={false} />
          <div className="action-section">
            <button className="record-btn start" onClick={startRecording}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor"><circle cx="9" cy="9" r="7" /></svg>
              <span>Kaydı Başlat</span>
            </button>
            <p className="hint">Aktif sekmede kullanıcı etkileşimlerini kaydetmek için tıklayın.</p>
          </div>
        </>
      )}

      {view === VIEW.RECORDING && (
        <>
          <StatusBar recording={true} elapsed={formatTime(elapsed)} eventCount={eventCount} />
          <div className="action-section">
            <button className="record-btn stop" onClick={stopRecording}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor"><rect x="3" y="3" width="12" height="12" rx="2" /></svg>
              <span>Kaydı Durdur</span>
            </button>
            <p className="hint">Sayfayla etkileşin — tüm işlemler kaydediliyor.</p>
          </div>
        </>
      )}

      {view === VIEW.RESULT && lastFlow && (
        <ResultView
          flow={lastFlow}
          aiPrompt={aiPrompt} setAiPrompt={setAiPrompt}
          aiChanges={aiChanges} applyAIPrompt={applyAIPrompt}
          modifiedEvents={modifiedEvents}
          aiSource={aiSource}
          actionLoading={actionLoading}
          assertions={assertions} setAssertions={setAssertions}
          assertionInput={assertionInput} setAssertionInput={setAssertionInput}
          onReplay={(speed) => startReplay(lastFlow, speed)}
          replaySpeed={replaySpeed} setReplaySpeed={setReplaySpeed}
          onNewRecording={() => { setLastFlow(null); setView(VIEW.IDLE); setAiChanges(null); setModifiedEvents(null); setAssertions([]); setBugReport(null); setScreenshot(null); }}
          onScreenshot={takeScreenshot} screenshot={screenshot}
          onGenerateReport={generateReport} bugReport={bugReport}
          onCreateJira={createJiraIssue}
          formatDate={formatDate}
        />
      )}

      {view === VIEW.REPLAY && (
        <ReplayView replayState={replayState} onStop={stopReplay} />
      )}

      {view === VIEW.HISTORY && (
        <HistoryView
          flows={savedFlows}
          onSelect={(flow) => { setLastFlow(flow); setView(VIEW.RESULT); setAiChanges(null); setModifiedEvents(null); }}
          onClearAll={() => { sendMsg(MSG.CLEAR_FLOWS); setSavedFlows([]); }}
          formatDate={formatDate}
        />
      )}

      {view === VIEW.TASKS && (
        <TasksView
          tasks={tasks}
          setTasks={setTasks}
          activeTask={activeTask}
          setActiveTask={setActiveTask}
          taskText={taskText}
          setTaskText={setTaskText}
          actionLoading={actionLoading}
          setActionLoading={setActionLoading}
          setError={setError}
          tabId={tabId}
          setView={setView}
          setLastFlow={setLastFlow}
        />
      )}

      {view === VIEW.SETTINGS && <SettingsView />}

      {error && <div className="error-bar"><span>⚠</span><span>{error}</span></div>}
      <footer className="footer"><span>Testocan AI QA Ajanı</span></footer>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  SUB-COMPONENTS
// ══════════════════════════════════════════════════════════════

function Header({ onHistoryClick, onSettingsClick, onTasksClick, showNav = true, flowCount = 0 }) {
  return (
    <header className="header">
      <div className="logo">
        <div className="logo-icon">
          <img src={logoSrc} alt="Testocan" />
        </div>
        <span className="logo-text">Testocan</span>
      </div>
      <div className="header-actions">
        {showNav && onTasksClick && (
          <button className="icon-btn" onClick={onTasksClick} title="Görevler">
            📋
          </button>
        )}
        {showNav && onHistoryClick && (
          <button className="icon-btn" onClick={onHistoryClick} title="Kaydedilen Akışlar">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4h12M2 8h12M2 12h8" strokeLinecap="round" /></svg>
            {flowCount > 0 && <span className="badge">{flowCount}</span>}
          </button>
        )}
        {showNav && onSettingsClick && (
          <button className="icon-btn" onClick={onSettingsClick} title="Ayarlar">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="2.5" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M3 13l1.5-1.5M11.5 4.5L13 3" strokeLinecap="round" /></svg>
          </button>
        )}
        <span className="version">v0.2.0</span>
      </div>
    </header>
  );
}

function StatusBar({ recording, elapsed, eventCount }) {
  return (
    <div className={`status-bar ${recording ? 'recording' : 'idle'}`}>
      <div className="status-indicator">
        <span className={`dot ${recording ? 'pulse' : ''}`} />
        <span className="status-text">{recording ? 'Kaydediliyor' : 'Hazır'}</span>
      </div>
      {recording && (
        <div className="status-meta">
          <span className="timer">{elapsed}</span>
          <span className="event-count">{eventCount} olay</span>
        </div>
      )}
    </div>
  );
}

function ResultView({ flow, aiPrompt, setAiPrompt, aiChanges, applyAIPrompt, modifiedEvents, aiSource, actionLoading, assertions, setAssertions, assertionInput, setAssertionInput, onReplay, replaySpeed, setReplaySpeed, onNewRecording, onScreenshot, screenshot, onGenerateReport, bugReport, onCreateJira, formatDate }) {
  const duration = flow.stoppedAt && flow.startedAt ? Math.floor((flow.stoppedAt - flow.startedAt) / 1000) : 0;
  const hasReplayResults = flow.replayResults && flow.replayResults.length > 0;
  const hasAssertionResults = flow.assertionResults && flow.assertionResults.length > 0;
  const hasErrors = flow.errors && (flow.errors.networkErrors?.length > 0 || flow.errors.consoleErrors?.length > 0 || flow.errors.jsErrors?.length > 0);

  const addAssertion = () => {
    if (!assertionInput.trim()) return;
    setAssertions([...assertions, assertionInput.trim()]);
    setAssertionInput('');
  };

  return (
    <div className="result-view">
      {/* Summary */}
      <div className={`result-summary ${hasReplayResults ? (flow.assertionResults?.every(a => a.passed) !== false ? 'success' : 'fail') : 'neutral'}`}>
        <div className="result-summary-left">
          <span className="result-icon">{hasReplayResults ? (flow.assertionResults?.every(a => a.passed) !== false ? '✅' : '❌') : '📋'}</span>
          <div>
            <div className="result-title">{hasReplayResults ? 'Replay Complete' : 'Recording Complete'}</div>
            <div className="result-subtitle">{flow.events.length} steps · {Math.floor(duration / 60) > 0 ? Math.floor(duration / 60) + 'm ' : ''}{duration % 60}s · {formatDate(flow.startedAt)}</div>
          </div>
        </div>
      </div>

      {flow.url && (
        <div className="result-url">
          <span className="result-url-label">Flow:</span>
          <span className="result-url-value">{flow.name ? flow.name : flow.url.length > 50 ? flow.url.slice(0, 50) + '…' : flow.url}</span>
        </div>
      )}

      {/* Assertion Results */}
      {hasAssertionResults && (
        <div className="section">
          <div className="steps-header"><span>Kontrol Sonuçları</span></div>
          <div className="assertion-results">
            {flow.assertionResults.map((a, i) => (
              <div key={i} className={`assertion-item ${a.passed ? 'pass' : 'fail'}`}>
                <span className="assertion-status">{a.passed ? '✅' : '❌'}</span>
                <span className="assertion-msg">{a.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Errors */}
      {hasErrors && (
        <div className="section">
          <div className="steps-header error-header"><span>⚠️ Hatalar Tespit Edildi</span></div>
          <div className="error-list">
            {flow.errors.networkErrors?.map((e, i) => (
              <div key={`net-${i}`} className="error-item">
                <span className="error-badge">{e.status}</span>
                <span className="error-url">{e.url?.split('?')[0].slice(-40)}</span>
              </div>
            ))}
            {flow.errors.consoleErrors?.map((e, i) => (
              <div key={`con-${i}`} className="error-item">
                <span className="error-badge console">console</span>
                <span className="error-url">{e.message?.slice(0, 50)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Steps */}
      <div className="steps-list">
        <div className="steps-header"><span>Kaydedilen Adımlar</span><span className="steps-count">{flow.events.length}</span></div>
        {flow.events.length === 0 ? (
          <div className="steps-empty"><span>Etkileşim kaydedilmedi.</span></div>
        ) : (
          <div className="steps-scroll">
            {flow.events.filter(e => e.action !== 'scroll' && e.action !== 'focus').map((event, i) => (
              <div className={`step-item ${flow.replayResults?.[i]?.result?.success === false ? 'step-failed' : ''}`} key={i}>
                <div className="step-number">{i + 1}</div>
                <div className="step-icon">{ACTION_ICONS[event.action] || '❓'}</div>
                <div className="step-content">
                  <div className="step-label">{getStepLabel(event)}</div>
                  <div className="step-meta">{getStepMeta(event)}</div>
                </div>
                {flow.replayResults?.[i] && (
                  <span className="step-status">{flow.replayResults[i].result?.success ? '✅' : '❌'}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI Parameterization */}
      <div className="section">
        <div className="steps-header">
          <span>🤖 AI Parametreleştirme</span>
          {aiSource && <span className={`ai-source-badge ${aiSource}`}>{aiSource === 'gemini' ? '✨ Gemini' : '📐 Kural Tabanlı'}</span>}
        </div>
        <div className="ai-section">
          <input className="ai-input" placeholder="ör. Bayi Kodu B002, Bölge İç Anadolu olarak çalıştır..." value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyAIPrompt()} />
          <button className="ai-btn" onClick={applyAIPrompt} disabled={!aiPrompt || actionLoading === 'ai'}>
            {actionLoading === 'ai' ? '⏳' : 'Uygula'}
          </button>
        </div>
        {aiChanges && aiChanges.length > 0 && (
          <div className="ai-changes">
            {aiChanges.map((c, i) => (
              <div key={i} className="ai-change-item" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.eventIndex === -1 ? (
                  <>
                    <span className="ai-field" style={{ color: '#4facfe' }}>📐 Structure</span>
                    <span className="ai-arrow">→</span>
                    <span className="ai-old">{c.oldValue}</span>
                    <span className="ai-arrow">→</span>
                    <span className="ai-new">{c.newValue}</span>
                  </>
                ) : (
                  <>
                    <span className="ai-field">{c.field}</span>
                    <span className="ai-arrow">→</span>
                    <span className="ai-old">{c.oldValue}</span>
                    <span className="ai-arrow">→</span>
                    <span className="ai-new">{c.newValue}</span>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        {aiChanges && aiChanges.length === 0 && <div className="ai-no-changes">No matching fields found for this prompt.</div>}
      </div>

      {/* Assertions */}
      <div className="section">
        <div className="steps-header"><span>🎯 Göz Kontrolleri</span></div>
        <div className="ai-section">
          <input className="ai-input" placeholder="ör. 'Hoş geldin TEST' görünmeli" value={assertionInput} onChange={(e) => setAssertionInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addAssertion()} />
          <button className="ai-btn" onClick={addAssertion} disabled={!assertionInput}>Ekle</button>
        </div>
        {assertions.length > 0 && (
          <div className="assertion-list">
            {assertions.map((a, i) => (
              <div key={i} className="assertion-tag">
                <span>{typeof a === 'string' ? a : a.text || a.pattern}</span>
                <button className="assertion-remove" onClick={() => setAssertions(assertions.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="result-actions">
        <div className="replay-controls">
          <select className="speed-select" value={replaySpeed} onChange={(e) => setReplaySpeed(e.target.value)}>
            <option value="slow">🐌 Yavaş</option>
            <option value="normal">▶️ Normal</option>
            <option value="fast">⚡ Hızlı</option>
          </select>
          <button className="record-btn replay" onClick={() => onReplay(replaySpeed)}>
            ▶ {modifiedEvents ? 'Değiştirilmişi Oynat' : 'Akışı Oynat'}
          </button>
        </div>
        <div className="action-row">
          <button className="secondary-btn" onClick={onScreenshot} disabled={actionLoading === 'screenshot'}>
            {actionLoading === 'screenshot' ? '⏳ Alınıyor...' : '📸 Ekran Görüntüsü'}
          </button>
          <button className="secondary-btn" onClick={onGenerateReport} disabled={actionLoading === 'report'}>
            {actionLoading === 'report' ? '⏳ Oluşturuluyor...' : '🐛 Hata Raporu'}
          </button>
          <button className="secondary-btn" onClick={onNewRecording}>🔄 Yeni</button>
        </div>
      </div>

      {/* Bug Report Preview */}
      {bugReport && (
        <div className="section">
          <div className="steps-header"><span>🐛 Hata Raporu</span></div>
          <div className="report-preview">
            <div className="report-title">{bugReport.title}</div>
            <div className="report-severity">Severity: <span className={`sev-${bugReport.severity}`}>{bugReport.severity}</span></div>
            {bugReport.labels && <div className="report-labels">{bugReport.labels.map((l, i) => <span key={i} className="report-label">{l}</span>)}</div>}
            <pre className="report-body">{bugReport.description}</pre>
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button className="record-btn jira" onClick={onCreateJira}>🔗 Jira'ya Aktar</button>
              <button className="record-btn" onClick={() => {
                chrome.storage.local.set({ report_data_temp: { ...bugReport, screenshot } }, () => {
                  chrome.tabs.create({ url: chrome.runtime.getURL('report.html') });
                });
              }} style={{ background: '#2c3e50' }}>📄 Yeni Sekmede Aç</button>
            </div>
          </div>
        </div>
      )}

      {screenshot && (
        <div className="section">
          <div className="steps-header"><span>📸 Ekran Görüntüsü</span></div>
          <img src={screenshot} className="screenshot-preview" alt="Screenshot" />
        </div>
      )}
    </div>
  );
}

function ReplayView({ replayState, onStop }) {
  if (!replayState) return null;
  const progress = replayState.totalSteps > 0 ? Math.round((replayState.currentStep / replayState.totalSteps) * 100) : 0;

  return (
    <div className="replay-view">
      <div className="replay-status">
        <div className="replay-icon pulse">▶</div>
        <div>
          <div className="replay-title">Tekrar Ediliyor…</div>
          <div className="replay-progress-text">Adım {replayState.currentStep} / {replayState.totalSteps}</div>
        </div>
      </div>
      <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
      <div className="action-section">
        <button className="record-btn stop" onClick={onStop}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor"><rect x="3" y="3" width="12" height="12" rx="2" /></svg>
          <span>Stop Replay</span>
        </button>
      </div>
    </div>
  );
}

function HistoryView({ flows, onSelect, onClearAll, formatDate }) {
  const sorted = [...flows].reverse();
  const total = flows.length;
  return (
    <div className="history-view">
      <div className="steps-header"><span>Kaydedilen Akışlar</span>{flows.length > 0 && <button className="clear-btn" onClick={onClearAll}>Temizle</button>}</div>
      {sorted.length === 0 ? <div className="steps-empty"><span>Henüz kaydedilmiş akış yok.</span></div> : (
        <div className="steps-scroll">
          {sorted.map((flow, i) => {
            // Assign display name: prefer explicit name, fall back to Akış-N
            const flowNumber = total - i;
            const displayName = flow.name || `Akış-${flowNumber}`;
            return (
              <div className="flow-item" key={flow.id || i} onClick={() => onSelect(flow)}>
                <div className="flow-item-left">
                  <div className="flow-item-title">
                    {displayName}
                    {flow.aiPrompt && <span className="ai-source-badge gemini" style={{ marginLeft: 6 }}>🤖 AI</span>}
                  </div>
                  <div className="flow-item-meta">{flow.events.length} adım · {formatDate(flow.startedAt)}</div>
                </div>
                <svg className="flow-chevron" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 3l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SettingsView() {
  const [config, setConfig] = useState({ baseUrl: '', email: '', apiToken: '', projectKey: '', issueType: 'Bug' });
  const [geminiKey, setGeminiKey] = useState('');
  const [geminiConfigured, setGeminiConfigured] = useState(false);
  const [saved, setSaved] = useState(false);
  const [geminiSaved, setGeminiSaved] = useState(false);

  useEffect(() => {
    sendMsg(MSG.JIRA_GET_CONFIG).then((res) => {
      if (res?.ok && res.config) setConfig(res.config);
    });
    sendMsg(MSG.GEMINI_GET_STATUS).then((res) => {
      if (res?.ok) setGeminiConfigured(res.configured);
    });
  }, []);

  const saveJira = async () => {
    await sendMsg(MSG.JIRA_SAVE_CONFIG, config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const saveGemini = async () => {
    if (!geminiKey.trim()) return;
    await sendMsg(MSG.GEMINI_SAVE_KEY, { apiKey: geminiKey.trim() });
    setGeminiConfigured(true);
    setGeminiSaved(true);
    setGeminiKey('');
    setTimeout(() => setGeminiSaved(false), 2000);
  };

  return (
    <div className="settings-view">
      <div className="steps-header"><span>🤖 Gemini AI</span>{geminiConfigured && <span className="gemini-badge">✅ Bağlı</span>}</div>
      <div className="settings-form">
        <label>Gemini API Anahtarı
          <input
            type="password"
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
            placeholder={geminiConfigured ? '••••••• (kaydedildi)' : 'AIzaSy...'}
          />
        </label>
        <p className="settings-hint">
          API anahtarınızı <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="settings-link">Google AI Studio</a>'dan edinin. Akıllı parametreleştirme ve gelişmiş hata raporları için kullanılır.
        </p>
        <button className="record-btn start small" onClick={saveGemini} disabled={!geminiKey.trim()}>
          {geminiSaved ? '✅ Kaydedildi!' : 'Gemini Anahtarını Kaydet'}
        </button>
      </div>

      <div className="steps-header"><span>🔗 Jira Ayarları</span></div>
      <div className="settings-form">
        <label>Jira URL<input value={config.baseUrl} onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })} placeholder="https://firma.atlassian.net" /></label>
        <label>E-posta<input value={config.email} onChange={(e) => setConfig({ ...config, email: e.target.value })} placeholder="siz@firma.com" /></label>
        <label>API Token<input type="password" value={config.apiToken} onChange={(e) => setConfig({ ...config, apiToken: e.target.value })} placeholder="Jira API token'inız" /></label>
        <label>Proje Kodu<input value={config.projectKey} onChange={(e) => setConfig({ ...config, projectKey: e.target.value })} placeholder="ör. TEST" /></label>
        <label>Konu Türü<select value={config.issueType} onChange={(e) => setConfig({ ...config, issueType: e.target.value })}>
          <option value="Bug">Hata (Bug)</option><option value="Task">Görev (Task)</option><option value="Story">Hikaye (Story)</option>
        </select></label>
        <button className="record-btn start" onClick={saveJira}>{saved ? '✅ Kaydedildi!' : 'Jira Ayarlarını Kaydet'}</button>
      </div>
    </div>
  );
}

function TasksView({ tasks, setTasks, activeTask, setActiveTask, taskText, setTaskText, actionLoading, setActionLoading, setError, tabId, setView, setLastFlow }) {
  // Load tasks on mount — use callback API for MV3 service worker compatibility
  useEffect(() => {
    chrome.storage.local.get(['tasks'], (data) => {
      setTasks(data.tasks || []);
    });
  }, [setTasks]);

  // Flow picker state (serves both primary selection and gap teaching)
  const [flowPickerOpen, setFlowPickerOpen] = React.useState(false);
  const [availableFlows, setAvailableFlows] = React.useState([]);
  const [selectedFlowIdx, setSelectedFlowIdx] = React.useState(null);
  // null = picking primary flow; gap.id string = teaching a specific gap
  const [teachingGapId, setTeachingGapId] = React.useState(null);
  const [analyzingGaps, setAnalyzingGaps] = React.useState(false);

  // Always reads fresh tasks from storage to avoid stale closure bugs
  const saveTaskToStorage = (tasksArr) => {
    return new Promise((resolve) => {
      chrome.storage.local.set({ tasks: tasksArr }, () => {
        setTasks([...tasksArr]);
        resolve();
      });
    });
  };

  const syncActiveTask = (updatedTask) => {
    setActiveTask({ ...updatedTask });
    // Read fresh from storage before updating
    chrome.storage.local.get(['tasks'], (data) => {
      const currentTasks = data.tasks || [];
      const newTasks = currentTasks.map(t => t.id === updatedTask.id ? updatedTask : t);
      chrome.storage.local.set({ tasks: newTasks }, () => setTasks([...newTasks]));
    });
  };

  const handleCreateTask = async () => {
    if (!taskText.trim()) return;
    setActionLoading('task_split');
    setError(null);
    try {
      const res = await sendMsg(MSG.SPLIT_TASK, { prompt: taskText });
      if (res && res.ok && res.task) {
        // Validate the task structure from AI
        const rawTask = res.task;
        if (!rawTask.flows || !Array.isArray(rawTask.flows)) {
          setError('Yapay Zeka geçerli bir görev yapısı oluşturamadı. Tekrar deneyin.');
          return;
        }
        // Filter out any undefined/null flow items and ensure required fields
        const safeFlows = rawTask.flows.filter(f => f && typeof f === 'object' && f.name);
        const newTask = {
          ...rawTask,
          flows: safeFlows,
          id: Date.now().toString()
        };
        // Read fresh tasks from storage before appending
        chrome.storage.local.get(['tasks'], async (data) => {
          const currentTasks = data.tasks || [];
          await saveTaskToStorage([...currentTasks, newTask]);
          setActiveTask(newTask);
          setTaskText('');
        });
      } else {
        setError((res && res.error) || 'Görev çözümlenirken hata oluştu. Gemini API anahtarınızı kontrol edin.');
      }
    } catch (err) {
      setError('Beklenmeyen hata: ' + err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const startTaskRun = async () => {
    if (!activeTask || !Array.isArray(activeTask.flows) || activeTask.flows.length === 0) {
      setError('Görevde çalıştırılabilir akış bulunamadı.');
      return;
    }
    const flowsWithoutEvents = activeTask.flows.filter(f => f && typeof f === 'object' && !f.events);
    if (flowsWithoutEvents.length > 0) {
      setError(`${flowsWithoutEvents.length} akış henüz hazır değil. Önce "Sentezle" butonuna basın.`);
      return;
    }
    if (!tabId) {
      setError('Aktif sekme bulunamadı. Uzantıyı kapatmayı ve tekrar açmayı deneyin.');
      return;
    }
    // tabId MUST be passed so background knows which tab to replay on
    const res = await sendMsg(MSG.START_TASK_RUN, { task: activeTask, speed: 'normal', tabId });
    if (res?.ok) {
      setView(VIEW.REPLAY);
    } else {
      setError(res?.error || 'Görev başlatılamadı.');
    }
  };

  const onRecordPrimary = () => {
    setView(VIEW.IDLE);
    alert("Lütfen ana ekrandan 'Kaydı Başlat' diyerek testinizi yapın. Kayıt bittiğinde Geçmiş (📁) sekmesinden son akışı bulup buraya dönün.");
  };

  // Open the flow picker for primary selection or for teaching a specific gap
  const openFlowPicker = async (gapId = null) => {
    setError(null);
    const data = await new Promise(resolve => chrome.storage.local.get(['flows'], resolve));
    const allFlows = (data.flows || []).slice().reverse();
    if (allFlows.length === 0) {
      setError('Kaydedilmiş akış bulunamadı. Lütfen önce "Kaydı Başlat" ile bir akış kaydedin.');
      return;
    }
    setAvailableFlows(allFlows);
    setSelectedFlowIdx(0);
    setTeachingGapId(gapId);
    setFlowPickerOpen(true);
  };

  // Alias kept for the "Akış Seç & Analiz Et" button
  const triggerSynthesis = () => openFlowPicker(null);

  // Confirm flow picker selection (handles both primary-pick and gap-teach)
  const confirmSynthesis = async () => {
    if (selectedFlowIdx === null || !availableFlows[selectedFlowIdx]) return;
    const selectedFlow = availableFlows[selectedFlowIdx];
    setFlowPickerOpen(false);

    if (teachingGapId === null) {
      // ── Primary flow selection + analyze gaps ───────────────
      const updatedTask = JSON.parse(JSON.stringify(activeTask));
      const primaryDef = updatedTask.flows.find(f => f && f.isPrimary);
      if (primaryDef) primaryDef.events = selectedFlow.events;

      setAnalyzingGaps(true);
      try {
        const gapRes = await sendMsg(MSG.ANALYZE_KNOWLEDGE_GAPS, {
          taskDesc: activeTask.taskDescription,
          taskFlows: activeTask.flows,
          primaryFlowEvents: selectedFlow.events,
        });
        if (gapRes?.ok && gapRes.gaps) {
          updatedTask.knowledgeGaps = gapRes.gaps.map(g => ({ ...g, learnedEvents: null }));
        } else {
          updatedTask.knowledgeGaps = [];
        }
      } finally {
        setAnalyzingGaps(false);
      }
      syncActiveTask(updatedTask);
    } else {
      // ── Gap teaching: assign selected flow to this gap ──────
      const updatedTask = JSON.parse(JSON.stringify(activeTask));
      const gap = (updatedTask.knowledgeGaps || []).find(g => g.id === teachingGapId);
      if (gap) gap.learnedEvents = selectedFlow.events;
      syncActiveTask(updatedTask);
    }
    setTeachingGapId(null);
  };

  // Synthesize all non-primary flows using the full knowledge bank
  const synthesizeFlows = async () => {
    setActionLoading('synthesize');
    setError(null);
    try {
      const updatedTask = JSON.parse(JSON.stringify(activeTask));
      const primaryDef = updatedTask.flows.find(f => f && f.isPrimary);

      // Build knowledge bank: primary + all taught gaps
      const lessonFlows = [
        { id: 'primary', label: 'Birincil Akış', events: primaryDef?.events || [] },
        ...(updatedTask.knowledgeGaps || [])
          .filter(g => g.learnedEvents)
          .map(g => ({ id: g.id, label: g.label, events: g.learnedEvents })),
      ];

      for (let i = 0; i < updatedTask.flows.length; i++) {
        const flow = updatedTask.flows[i];
        if (!flow || flow.isPrimary) continue;
        const res = await sendMsg(MSG.SYNTHESIZE_TASK_FLOW, { lessonFlows, targetFlowDesc: flow });
        if (res && res.ok && res.events) {
          updatedTask.flows[i].events = res.events;
        }
      }
      syncActiveTask(updatedTask);
    } finally {
      setActionLoading(null);
    }
  };

  // Open the last stored report for this task
  const openTaskReport = () => {
    if (!activeTask.lastReportData) return;
    chrome.storage.local.set({ report_data_temp: activeTask.lastReportData }, () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('report.html') });
    });
  };


  if (!activeTask) {
    return (
      <div className="settings-view">
        {/* New Task Input */}
        <div style={{ padding: '16px 16px 0' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#4facfe', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
            📋 Yeni Görev Oluştur
          </div>
          <textarea
            value={taskText}
            onChange={e => setTaskText(e.target.value)}
            placeholder="Görev dökümanını buraya yapıştırın (Örn: Yusuf bey, sisteme TEST şifresiyle girip...)"
            rows={5}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '12px', resize: 'vertical',
              background: 'rgba(0,0,0,0.25)', border: '1px solid #2a2d3a', borderRadius: '8px',
              color: '#e8eaf0', fontSize: '13px', lineHeight: '1.5', outline: 'none',
            }}
          />
          <button
            onClick={handleCreateTask}
            disabled={actionLoading === 'task_split' || !taskText}
            style={{
              width: '100%', padding: '12px', marginTop: '10px', borderRadius: '8px', fontSize: '14px',
              fontWeight: '700', cursor: 'pointer', border: 'none',
              background: (actionLoading === 'task_split' || !taskText) ? '#333' : 'linear-gradient(135deg, #f5a623, #e08c10)',
              color: (actionLoading === 'task_split' || !taskText) ? '#666' : '#000',
            }}
          >
            {actionLoading === 'task_split' ? '⏳ Çözümleniyor...' : 'Yapay Zeka ile Çözümle ✨'}
          </button>
        </div>

        {/* Past Tasks */}
        {tasks.length > 0 && (
          <div style={{ padding: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#a0a5b0', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
              📁 Geçmiş Görevler
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {tasks.map((t, i) => {
                const readyCount = t.flows?.filter(f => f?.events).length || 0;
                const totalFlows = t.flows?.length || 0;
                const allReady = readyCount === totalFlows && totalFlows > 0;
                return (
                  <div
                    key={i}
                    onClick={() => setActiveTask(t)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '12px',
                      padding: '12px 14px', borderRadius: '10px', cursor: 'pointer',
                      background: 'rgba(255,255,255,0.04)', border: '1px solid #2a2d3a',
                      transition: 'border-color 0.2s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = '#3a5068'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = '#2a2d3a'}
                  >
                    <div style={{
                      width: '38px', height: '38px', borderRadius: '10px', flexShrink: 0,
                      background: allReady ? 'rgba(79,172,254,0.15)' : 'rgba(255,255,255,0.06)',
                      border: `1px solid ${allReady ? '#2a5298' : '#2a2d3a'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px',
                    }}>
                      📋
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: '#e8eaf0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {t.taskName}
                      </div>
                      <div style={{ fontSize: '11px', color: '#a0a5b0', marginTop: '3px' }}>
                        {totalFlows} akış
                        {allReady && <span style={{ color: '#4facfe', marginLeft: '6px' }}>· Hazır</span>}
                        {!allReady && readyCount > 0 && <span style={{ color: '#f5a623', marginLeft: '6px' }}>· {readyCount}/{totalFlows} hazır</span>}
                      </div>
                    </div>
                    <span style={{ color: '#3a4050', fontSize: '16px' }}>›</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }


  const alreadyRan = !!activeTask?.lastRunAt;
  const primaryDef = activeTask?.flows?.find(f => f?.isPrimary);
  const hasPrimaryEvents = !!primaryDef?.events;
  const hasKnowledgeGaps = (activeTask?.knowledgeGaps?.length ?? 0) > 0;
  const mandatoryGapsFilled = (activeTask?.knowledgeGaps || []).filter(g => g.mandatory).every(g => g.learnedEvents);
  const allFlowsReady = hasPrimaryEvents && !activeTask?.flows?.some(f => !f?.events);
  const canRun = allFlowsReady && !actionLoading;

  // Step 1: Need to pick primary + analyze
  const needsAnalysis = !hasPrimaryEvents || !hasKnowledgeGaps;
  // Step 2: Need to synthesize secondary flows
  const needsSynthesis = hasPrimaryEvents && hasKnowledgeGaps && mandatoryGapsFilled && !allFlowsReady;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative' }}>
      {/* Sticky Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #1f2736', flexShrink: 0 }}>
        <button onClick={() => setActiveTask(null)}
          style={{ background: 'none', border: 'none', color: '#a0a5b0', cursor: 'pointer', fontSize: '13px' }}>
          ◀ Geri
        </button>
        <span style={{ fontSize: '11px', fontWeight: '700', color: '#4facfe', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right', maxWidth: '60%' }}>
          {activeTask.taskName}
        </span>
      </div>

      {/* Description */}
      <p style={{ fontSize: '12px', color: '#a0a5b0', margin: '10px 16px 6px', lineHeight: '1.5', flexShrink: 0 }}>
        {activeTask.taskDescription}
      </p>

      {/* Scrollable area: Flows + Knowledge Gaps */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>

        {/* ── Flow Cards ── */}
        {activeTask.flows?.map((f, i) => (
          <div key={i} style={{
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${f?.events ? '#2a5298' : '#2a2d3a'}`,
            borderRadius: '10px', padding: '12px 14px',
            display: 'flex', flexDirection: 'column', gap: '6px',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
              <span style={{ fontWeight: '600', fontSize: '13px', lineHeight: '1.4', color: '#e8eaf0', flex: 1 }}>
                {f?.isPrimary ? '🔴' : '🟦'} {f?.name}
              </span>
              <span style={{
                fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px', whiteSpace: 'nowrap',
                background: f?.events ? 'rgba(79,172,254,0.15)' : 'rgba(255,255,255,0.06)',
                color: f?.events ? '#4facfe' : '#666',
              }}>
                {f?.events ? `✅ ${f.events.length} adım` : (f?.isPrimary ? 'Kayıt Bekliyor' : 'Sentez Bekliyor')}
              </span>
            </div>
            <div style={{ fontSize: '11px', color: '#8a8fa8', lineHeight: '1.5' }}>{f?.desc}</div>
            {f?.isPrimary && !f?.events && !alreadyRan && (
              <button onClick={() => onRecordPrimary(f)}
                style={{ marginTop: '4px', fontSize: '12px', padding: '6px 12px', background: '#2c3e50', border: '1px solid #3a5068', borderRadius: '6px', color: '#fff', cursor: 'pointer', alignSelf: 'flex-start' }}>
                ● Kaydı Başlat
              </button>
            )}
          </div>
        ))}

        {/* ── Knowledge Gaps Section ── */}
        {hasPrimaryEvents && (
          <div style={{ marginTop: '4px' }}>
            {analyzingGaps ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 14px', borderRadius: '10px', background: 'rgba(79,172,254,0.06)', border: '1px solid #2a2d3a' }}>
                <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span>
                <span style={{ fontSize: '12px', color: '#a0a5b0' }}>AI eksik eylemleri analiz ediyor...</span>
              </div>
            ) : hasKnowledgeGaps ? (
              <>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#f5a623', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px', marginLeft: '2px' }}>
                  📚 Bilgi Bankası — Eksiği Öğret
                </div>
                {activeTask.knowledgeGaps.map((gap) => (
                  <div key={gap.id} style={{
                    background: gap.learnedEvents ? 'rgba(79,172,254,0.06)' : 'rgba(245,166,35,0.06)',
                    border: `1px solid ${gap.learnedEvents ? '#2a5298' : '#5a3a00'}`,
                    borderRadius: '10px', padding: '11px 13px',
                    display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '6px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                      <span style={{ fontWeight: '600', fontSize: '13px', color: gap.learnedEvents ? '#4facfe' : '#f5a623' }}>
                        {gap.learnedEvents ? '✅' : '❓'} {gap.label}
                        {gap.mandatory && <span style={{ fontSize: '10px', color: '#ff6b6b', marginLeft: '6px' }}>• Zorunlu</span>}
                      </span>
                      {!gap.learnedEvents ? (
                        <button onClick={() => openFlowPicker(gap.id)}
                          style={{ fontSize: '11px', padding: '4px 10px', background: '#2c3e50', border: '1px solid #5a3a00', borderRadius: '6px', color: '#f5a623', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          ● Öğret
                        </button>
                      ) : (
                        <button onClick={() => openFlowPicker(gap.id)}
                          style={{ fontSize: '11px', padding: '4px 10px', background: 'transparent', border: '1px solid #2a5298', borderRadius: '6px', color: '#4facfe', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          Değiştir
                        </button>
                      )}
                    </div>
                    <div style={{ fontSize: '11px', color: '#8a8fa8' }}>{gap.whyNeeded}</div>
                    {gap.learnedEvents && (
                      <div style={{ fontSize: '11px', color: '#4facfe' }}>✅ {gap.learnedEvents.length} adım öğrenildi</div>
                    )}
                  </div>
                ))}
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* ── Flow Picker Panel (overlay) ── */}
      {flowPickerOpen && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(10,12,18,0.97)', zIndex: 50, display: 'flex', flexDirection: 'column', padding: '16px', gap: '8px', overflowY: 'auto' }}>
          <div style={{ fontSize: '13px', fontWeight: '700', color: '#e8eaf0', marginBottom: '2px' }}>
            {teachingGapId
              ? `📚 Öğret: ${activeTask.knowledgeGaps?.find(g => g.id === teachingGapId)?.label || '?'}`
              : '🗻 Birincil Akışı Seç'}
          </div>
          <div style={{ fontSize: '11px', color: '#a0a5b0', marginBottom: '8px' }}>
            {teachingGapId
              ? 'Bu eylemi gösteren kaydı seçin. AI bu kayda bakarak eylemi sentezlemede kullanacak.'
              : 'Birincil test kaydınızı seçin. Diğer akışlar buna göre sentezlenecek.'}
          </div>
          {availableFlows.map((f, i) => (
            <div key={i} onClick={() => setSelectedFlowIdx(i)}
              style={{
                padding: '12px 14px', borderRadius: '10px', cursor: 'pointer',
                background: selectedFlowIdx === i ? 'rgba(79,172,254,0.12)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${selectedFlowIdx === i ? '#2a5298' : '#2a2d3a'}`,
                display: 'flex', flexDirection: 'column', gap: '4px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '13px', fontWeight: '600', color: selectedFlowIdx === i ? '#4facfe' : '#e8eaf0' }}>
                  {selectedFlowIdx === i ? '✅ ' : ''}{f.name || `Akış ${i + 1}`}
                </span>
                <span style={{ fontSize: '11px', color: '#a0a5b0' }}>{f.events?.length || 0} adım</span>
              </div>
              <div style={{ fontSize: '11px', color: '#555' }}>{f.url || ''}</div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button onClick={() => setFlowPickerOpen(false)}
              style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid #2a2d3a', background: 'transparent', color: '#a0a5b0', fontSize: '13px', cursor: 'pointer' }}>
              İptal
            </button>
            <button onClick={confirmSynthesis} disabled={selectedFlowIdx === null}
              style={{ flex: 2, padding: '10px', borderRadius: '8px', border: 'none', background: 'linear-gradient(135deg,#4facfe,#2a7fdb)', color: '#fff', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>
              {teachingGapId ? '📚 Öğrendir' : '✅ Seç & Analiz Et'}
            </button>
          </div>
        </div>
      )}

      {/* ── Action Buttons ── */}
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid #1f2736', flexShrink: 0 }}>

        {/* Step 1: Pick primary + analyze gaps */}
        {(needsAnalysis || analyzingGaps) && !alreadyRan && (
          <button onClick={triggerSynthesis}
            disabled={!!actionLoading || analyzingGaps}
            style={{ width: '100%', padding: '10px', background: '#1e2c3a', border: '1px solid #2a5298', borderRadius: '8px', color: '#4facfe', fontWeight: '600', fontSize: '13px', cursor: 'pointer', opacity: analyzingGaps ? 0.6 : 1 }}>
            {analyzingGaps ? '⏳ AI Analiz Ediyor...' : '🔍 Birincil Akış Seç & Analiz Et'}
          </button>
        )}

        {/* Step 2: Synthesize secondary flows using knowledge bank */}
        {hasPrimaryEvents && !alreadyRan && (
          <button onClick={synthesizeFlows}
            disabled={!!actionLoading || !mandatoryGapsFilled || allFlowsReady}
            style={{
              width: '100%', padding: '10px', borderRadius: '8px', fontWeight: '600', fontSize: '13px', cursor: 'pointer',
              background: (mandatoryGapsFilled && !allFlowsReady && !actionLoading) ? '#1e2c3a' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${(mandatoryGapsFilled && !allFlowsReady && !actionLoading) ? '#2a5298' : '#2a2d3a'}`,
              color: (mandatoryGapsFilled && !allFlowsReady && !actionLoading) ? '#4facfe' : '#555',
            }}>
            {actionLoading === 'synthesize' ? '⏳ Sentezleniyor...' : allFlowsReady ? '✅ Sentezlendi' : '🧬 Alt Akışları Sentezle'}
          </button>
        )}

        {/* Post-run disabled Sentezle placeholder */}
        {alreadyRan && (
          <button disabled style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #2a2d3a', background: 'rgba(255,255,255,0.02)', color: '#444', fontWeight: '600', fontSize: '13px', cursor: 'not-allowed' }}>
            🧬 Alt Akışları Sentezle
          </button>
        )}

        {/* Play / Replay */}
        <button onClick={startTaskRun} disabled={!canRun}
          style={{
            width: '100%', padding: '12px', borderRadius: '8px', fontSize: '14px', fontWeight: '700',
            cursor: canRun ? 'pointer' : 'not-allowed', border: 'none',
            background: canRun ? 'linear-gradient(135deg,#f5a623,#e08c10)' : '#333',
            color: canRun ? '#000' : '#666',
          }}>
          {alreadyRan ? '↺ Görevi Tekrar Oynat' : '▶ Görevi Oynat (Task Run)'}
        </button>

        {/* Report (only post-run) */}
        {alreadyRan && (
          <button onClick={openTaskReport}
            style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #2a5298', background: 'rgba(79,172,254,0.08)', color: '#4facfe', fontWeight: '600', fontSize: '13px', cursor: 'pointer' }}>
            📄 Görev Raporu Gör
          </button>
        )}
      </div>
    </div>
  );
}
