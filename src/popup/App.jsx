import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Bug, Camera, FileText, CheckCircle2, XCircle, Globe, Settings, Sparkles, Folder, PlayCircle, StopCircle, RefreshCw, Layers, LayoutList, Database, Circle, Network, History, Settings2, TreePine, ListTodo } from 'lucide-react';
import Tree from 'react-d3-tree';
import logoSrc from './logo.png';
import { logoBase64 } from './logo_base64.js';
import { WorkspaceSync } from '../shared/workspaceSync.js';

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
  GET_KNOWLEDGE_TREE: 'TESTOCAN::GET_KNOWLEDGE_TREE',
  CLEAR_KNOWLEDGE: 'TESTOCAN::CLEAR_KNOWLEDGE',
  SHOW_FLOATING_WIDGET: 'TESTOCAN::SHOW_FLOATING_WIDGET',
  OPEN_SIDE_PANEL: 'TESTOCAN::OPEN_SIDE_PANEL',
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

const VIEW = { IDLE: 'idle', RECORDING: 'recording', RESULT: 'result', HISTORY: 'history', REPLAY: 'replay', SETTINGS: 'settings', TASKS: 'tasks', KNOWLEDGE: 'knowledge' };

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
  
  // Website-centric State
  const [savedDomains, setSavedDomains] = useState([]);
  const [activeTabDomain, setActiveTabDomain] = useState('');
  const [isScanning, setIsScanning] = useState(false);

  // ── Init ───────────────────────────────────────────────────
  useEffect(() => {
    // Load domains
    chrome.storage.local.get(['savedDomains', 'flows'], (data) => {
      let domains = data.savedDomains || [];
      if (domains.length === 0 && data.flows) {
        // Extract domains from existing flows for backward compatibility
        domains = [...new Set(data.flows.filter(f => f.url || f.startUrl).map(f => {
          try { return new URL(f.url || f.startUrl).hostname; } catch(e) { return null; }
        }).filter(Boolean))];
        chrome.storage.local.set({ savedDomains: domains });
      }
      setSavedDomains(domains);
    });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) { setLoading(false); return; }
      setTabId(tabs[0].id);
      
      try {
        const urlObj = new URL(tabs[0].url);
        setActiveTabDomain(urlObj.hostname);
      } catch (e) {
        setActiveTabDomain('');
      }

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
                // 1. Build structured per-flow data for AI
                const tResult = taskSnap.results || [];
                
                // 2. Take a final screenshot or use the failure screenshot
                const firstFailedFlow = tResult.find(tr => tr.failureScreenshot);
                let finalScreenshot = firstFailedFlow ? firstFailedFlow.failureScreenshot : null;
                if (!finalScreenshot) {
                  const shotRes = await sendMsg(MSG.TAKE_SCREENSHOT, { tabId });
                  finalScreenshot = shotRes?.ok ? shotRes.screenshot : null;
                }

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
                const reportMd = enhRes?.ok ? enhRes.description : `# Görev Raporu: ${taskData.taskName}\n\n${flowsData.map((f, i) => `## ${i + 1}. ${f.flowName}\n**Durum:** ${f.passed ? 'Başarılı' : 'Başarısız'}\n`).join('')}`;

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

                // 5. Persist lastRunAt + lastReportData to the task so "<span style={{display:'flex', alignItems:'center', gap:'6px'}}><FileText size={14}/> Görev Raporu Gör</span>" works later
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
                    let shot = res.replayState.failureScreenshot || null;
                    
                    // If no step failed, but we caught a network error, use its precise screenshot
                    if (!shot && errs && errs.requests?.length > 0) {
                      const firstNetErr = errs.requests.find(e => e.isError && e.errorScreenshot);
                      if (firstNetErr) shot = firstNetErr.errorScreenshot;
                    }
                    
                    if (!shot) {
                      const shotRes = await sendMsg(MSG.TAKE_SCREENSHOT, { tabId });
                      if (shotRes?.ok) { shot = shotRes.screenshot; }
                    }
                    setScreenshot(shot);

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

  const handleAddWebsite = async () => {
    if (!activeTabDomain || !tabId) return;
    setIsScanning(true);
    
    // Inject the scanning effect script into the active tab
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          
          // Smooth pseudo-element scanner
          const style = document.createElement('style');
          style.id = 'testocan-scanner-style';
          style.textContent = `
            .testocan-scanner-overlay {
              position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
              pointer-events: none; z-index: 2147483646; overflow: hidden;
            }
            .testocan-scan-beam {
              position: absolute; top: 0; bottom: 0; width: 20vw;
              background: linear-gradient(to right, transparent, rgba(189, 0, 255, 0.1), rgba(255, 0, 128, 0.5), rgba(189, 0, 255, 0.1), transparent);
              box-shadow: 0 0 60px rgba(189, 0, 255, 0.4);
              transform: translateX(-100vw) skewX(-15deg);
              will-change: transform;
            }
            .testocan-scanned-element {
              position: relative !important;
            }
            .testocan-scanned-element::after {
              content: ''; position: absolute; inset: -2px; border-radius: 6px;
              box-shadow: 0 0 20px rgba(189, 0, 255, 0), inset 0 0 10px rgba(189, 0, 255, 0);
              pointer-events: none; z-index: 2147483647;
              transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1);
              opacity: 0; border: 1px solid transparent;
            }
            .testocan-scanned-element.illuminated::after {
              opacity: 1;
              box-shadow: 0 0 25px rgba(189, 0, 255, 0.8), inset 0 0 15px rgba(189, 0, 255, 0.3);
              border-color: rgba(189, 0, 255, 0.8);
              background: rgba(189, 0, 255, 0.05);
            }
          `;
          document.head.appendChild(style);

          const overlay = document.createElement('div');
          overlay.className = 'testocan-scanner-overlay';
          const beam = document.createElement('div');
          beam.className = 'testocan-scan-beam';
          overlay.appendChild(beam);
          document.body.appendChild(overlay);

          const elements = Array.from(document.querySelectorAll('div, a, button, section, header, footer, input, form, span, p, h1, h2, h3, img'))
            .filter(el => {
               const rect = el.getBoundingClientRect();
               return rect.width > 30 && rect.height > 20 && rect.top < window.innerHeight && rect.bottom > 0;
            }).sort(() => 0.5 - Math.random()).slice(0, 60);

          elements.forEach(el => el.classList.add('testocan-scanned-element'));

          let start = null;
          const duration = 2500; // slightly longer for smoothness
          
          const step = (timestamp) => {
            if (!start) start = timestamp;
            const progress = (timestamp - start) / duration;
            if (progress > 1) {
              overlay.remove();
              style.remove();
              elements.forEach(el => {
                  el.classList.remove('testocan-scanned-element');
                  el.classList.remove('illuminated');
              });
              return;
            }
            
            // Move beam from -20vw to 120vw
            const beamX = (progress * 1.4 - 0.2) * window.innerWidth;
            beam.style.transform = `translateX(${beamX}px) skewX(-15deg)`;
            
            // Illuminate elements near the beam
            elements.forEach(el => {
              const rect = el.getBoundingClientRect();
              const elCenter = rect.left + rect.width / 2;
              const distance = Math.abs(elCenter - (beamX + window.innerWidth * 0.1));
              
              if (distance < window.innerWidth * 0.15) {
                el.classList.add('illuminated');
              } else {
                el.classList.remove('illuminated');
              }
            });
            
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }
      });
    } catch (e) {
      console.warn("Could not inject script:", e);
    }

    // Wait 2 seconds for effect to finish
    setTimeout(() => {
      const newDomains = [...savedDomains, activeTabDomain];
      setSavedDomains(newDomains);
      chrome.storage.local.set({ savedDomains: newDomains });
      setIsScanning(false);
    }, 2000);
  };

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
    
    // Quick API Key check before making the background call
    const keyData = await new Promise(resolve => chrome.storage.local.get('geminiApiKey', resolve));
    if (!keyData.geminiApiKey) {
      alert("Yapay Zeka özelliğini kullanabilmek için lütfen 'Ayarlar' ikonuna tıklayıp Google AI Studio API anahtarınızı girin.");
      return;
    }

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
      alert(`Jira issue created: ${res.issueKey}\n${res.issueUrl}`);
    } else {
      setError(res?.error || 'Jira creation failed');
    }
  }, [bugReport]);

  const formatTime = (s) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
  const formatDate = (ts) => new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

  const handleMinimize = async () => {
    const res = await new Promise(r => chrome.storage.local.get(['widgetPosition'], r));
    const position = res.widgetPosition || 'bottom-right';
    if (tabId) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (pos, iconUrl, MSG_OPEN) => {
            let existing = document.getElementById('testocan-floating-widget');
            if (existing) existing.remove();

            const widget = document.createElement('div');
            widget.id = 'testocan-floating-widget';
            widget.style.position = 'fixed';
            widget.style.width = '64px';
            widget.style.height = '64px';
            widget.style.zIndex = '2147483647';
            widget.style.cursor = 'pointer';
            widget.style.borderRadius = '50%';
            widget.style.filter = 'drop-shadow(0 8px 16px rgba(245, 166, 35, 0.4))';
            widget.style.transition = 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)';

            const img = document.createElement('img');
            img.src = iconUrl;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'contain';
            img.style.pointerEvents = 'none';
            widget.appendChild(img);

            if (pos === 'bottom-right') { widget.style.bottom = '24px'; widget.style.right = '24px'; }
            else if (pos === 'bottom-left') { widget.style.bottom = '24px'; widget.style.left = '24px'; }
            else if (pos === 'top-right') { widget.style.top = '24px'; widget.style.right = '24px'; }
            else if (pos === 'top-left') { widget.style.top = '24px'; widget.style.left = '24px'; }

            widget.onmouseenter = () => widget.style.transform = 'scale(1.15) rotate(5deg)';
            widget.onmouseleave = () => widget.style.transform = 'scale(1) rotate(0deg)';
            
            widget.onclick = () => {
              chrome.runtime.sendMessage({ type: MSG_OPEN }).catch(() => {});
              widget.remove();
            };
            document.body.appendChild(widget);
          },
          args: [position, logoBase64, MSG.OPEN_SIDE_PANEL]
        });
      } catch (e) {
        console.error("Widget injection failed:", e);
      }
    }
    window.close();
  };

  if (loading) return <div className="testocan-popup"><Header /><div className="action-section"><p className="hint">Bağlanıyor…</p></div></div>;



  return (
    <div className="testocan-popup">
      <Header
        onLogoClick={handleMinimize}
        onRecordClick={() => setView(VIEW.IDLE)}
        onHistoryClick={() => setView(view === VIEW.HISTORY ? VIEW.IDLE : VIEW.HISTORY)}
        onSettingsClick={() => setView(view === VIEW.SETTINGS ? VIEW.IDLE : VIEW.SETTINGS)}
        onTasksClick={() => setView(view === VIEW.TASKS ? VIEW.IDLE : VIEW.TASKS)}
        onKnowledgeClick={() => setView(view === VIEW.KNOWLEDGE ? VIEW.IDLE : VIEW.KNOWLEDGE)}
        showNav={view !== VIEW.RECORDING && view !== VIEW.REPLAY}
        flowCount={savedFlows.length}
        activeView={view}
      />

      {view === VIEW.IDLE && (
        <>
          <StatusBar recording={false} />
          <div className="action-section">
            {isScanning ? (
              <div style={{ textAlign: 'center', padding: '16px' }}>
                <div style={{ color: 'var(--accent-light)', fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', animation: 'pulse 1s infinite alternate' }}><span style={{display:'flex', alignItems:'center', gap:'6px', justifyContent:'center'}}><RefreshCw size={14} className="spin"/> Site Taranıyor...</span></div>
                <p className="hint">Yapay zeka site bileşenlerini bilgi bankasına ekliyor.</p>
              </div>
            ) : savedDomains.includes(activeTabDomain) ? (
              <>
                <div style={{ marginBottom: '16px', background: 'rgba(245, 166, 35, 0.1)', border: '1px solid var(--accent)', padding: '8px 12px', borderRadius: '8px', color: 'var(--accent-light)', fontSize: '12px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                  <span></span> <span>{activeTabDomain}</span>
                </div>
                <button className="record-btn start" onClick={startRecording}>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor"><circle cx="9" cy="9" r="7" /></svg>
                  <span>Kaydı Başlat</span>
                </button>
                <p className="hint">Site bilgi bankasında kayıtlı. Etkileşimleri kaydetmek için tıklayın.</p>
              </>
            ) : (
              <>
                <button className="record-btn" style={{ background: 'linear-gradient(135deg, #4facfe, #00f2fe)', borderColor: '#4facfe', color: '#fff' }} onClick={handleAddWebsite}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                  <span style={{ marginLeft: '4px' }}>Yeni Web Sitesi Ekle</span>
                </button>
                <p className="hint">Bu site (<b>{activeTabDomain || 'Bilinmeyen'}</b>) henüz bilgi bankasında yok. Başlamadan önce siteyi ekleyin.</p>
              </>
            )}
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

      {view === VIEW.KNOWLEDGE && <KnowledgeTreeView />}

      {error && <div className="error-bar"><span>⚠</span><span>{error}</span></div>}
      <footer className="footer"><span>Testocan AI QA Ajanı</span></footer>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  SUB-COMPONENTS
// ══════════════════════════════════════════════════════════════

function Header({ onLogoClick, onRecordClick, onHistoryClick, onSettingsClick, onTasksClick, onKnowledgeClick, showNav = true, flowCount = 0, activeView = '' }) {
  return (
    <header className="header">
      <div className="logo" onClick={onLogoClick} style={{ cursor: 'pointer' }} title="Uygulamayı Küçült">
        <div className="logo-icon">
          <img src={logoSrc} alt="Testocan" />
        </div>
        <span className="logo-text">Testocan</span>
      </div>
      <div className="header-actions">
        {showNav && onRecordClick && (
          <button className="icon-btn" onClick={onRecordClick} title="Kayıt Ekranı" style={activeView === 'idle' || activeView === 'recording' ? { borderColor: 'var(--accent)', background: 'rgba(245,166,35,0.1)' } : {}}>
            <Circle size={14} color="#f44336" fill="#f44336" />
          </button>
        )}
        {showNav && onKnowledgeClick && (
          <button className="icon-btn" onClick={onKnowledgeClick} title="Bilgi Havuzu" style={activeView === 'knowledge' ? { borderColor: 'var(--accent)', background: 'rgba(245,166,35,0.1)' } : {}}>
            <Network size={16} />
          </button>
        )}
        {showNav && onTasksClick && (
          <button className="icon-btn" onClick={onTasksClick} title="Görevler" style={activeView === 'tasks' ? { borderColor: 'var(--accent)', background: 'rgba(245,166,35,0.1)' } : {}}>
            <ListTodo size={16} />
          </button>
        )}
        {showNav && onHistoryClick && (
          <button className="icon-btn" onClick={onHistoryClick} title="Kaydedilen Akışlar" style={activeView === 'history' ? { borderColor: 'var(--accent)', background: 'rgba(245,166,35,0.1)' } : {}}>
            <History size={16} />
            {flowCount > 0 && <span className="badge">{flowCount}</span>}
          </button>
        )}
        {showNav && onSettingsClick && (
          <button className="icon-btn" onClick={onSettingsClick} title="Ayarlar" style={activeView === 'settings' ? { borderColor: 'var(--accent)', background: 'rgba(245,166,35,0.1)' } : {}}>
            <Settings2 size={16} />
          </button>
        )}
        <span className="version">v0.3.0</span>
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
          <span className="result-icon">{hasReplayResults ? (flow.assertionResults?.every(a => a.passed) !== false ? '' : '') : ''}</span>
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
                <span className="assertion-status">{a.passed ? '' : ''}</span>
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
                <div className="step-icon">{ACTION_ICONS[event.action] || ''}</div>
                <div className="step-content">
                  <div className="step-label">{getStepLabel(event)}</div>
                  <div className="step-meta">{getStepMeta(event)}</div>
                </div>
                {flow.replayResults?.[i] && (
                  <span className="step-status">{flow.replayResults[i].result?.success ? '' : ''}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI Parameterization */}
      <div className="section">
        <div className="steps-header">
          <span><span style={{display:'flex', alignItems:'center', gap:'6px'}}><Sparkles size={14}/> AI Parametreleştirme</span></span>
          {aiSource && <span className={`ai-source-badge ${aiSource}`}>{aiSource === 'gemini' ? 'Gemini' : 'Kural Tabanlı'}</span>}
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
                    <span className="ai-field" style={{ color: '#4facfe' }}>Structure</span>
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
            {actionLoading === 'screenshot' ? '⏳ Alınıyor...' : <span style={{display:'flex', alignItems:'center', gap:'6px'}}><Camera size={14}/> Ekran Görüntüsü</span>}
          </button>
          <button className="secondary-btn" onClick={onGenerateReport} disabled={actionLoading === 'report'}>
            {actionLoading === 'report' ? '⏳ Oluşturuluyor...' : <span style={{display:'flex', alignItems:'center', gap:'6px'}}><Bug size={14}/> Hata Raporu</span>}
          </button>
          <button className="secondary-btn" onClick={onNewRecording}>🔄 Yeni</button>
        </div>
      </div>

      {/* Bug Report Preview */}
      {bugReport && (
        <div className="section">
          <div className="steps-header"><span style={{display:'flex', alignItems:'center', gap:'6px'}}><Bug size={14}/> Hata Raporu</span></div>
          <div className="report-preview">
            <div className="report-title">{bugReport.title}</div>
            <div className="report-severity">Severity: <span className={`sev-${bugReport.severity}`}>{bugReport.severity}</span></div>
            {bugReport.labels && <div className="report-labels">{bugReport.labels.map((l, i) => <span key={i} className="report-label">{l}</span>)}</div>}
            <pre className="report-body">{bugReport.description}</pre>
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button className="record-btn jira" onClick={onCreateJira}><span style={{display:'flex', alignItems:'center', gap:'6px'}}><Settings size={14}/> Jira'ya Aktar</span></button>
              <button className="record-btn" onClick={() => {
                chrome.storage.local.set({ report_data_temp: { ...bugReport, screenshot } }, () => {
                  chrome.tabs.create({ url: chrome.runtime.getURL('report.html') });
                });
              }} style={{ background: '#2c3e50' }}><span style={{display:'flex', alignItems:'center', gap:'6px'}}><FileText size={14}/> Yeni Sekmede Aç</span></button>
            </div>
          </div>
        </div>
      )}

      {screenshot && (
        <div className="section">
          <div className="steps-header"><span style={{display:'flex', alignItems:'center', gap:'6px'}}><Camera size={14}/> Ekran Görüntüsü</span></div>
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
  const [expandedDomains, setExpandedDomains] = useState({});
  const [selectedFilterDomain, setSelectedFilterDomain] = useState('');

  const flowsByDomain = useMemo(() => {
    const groups = {};
    const sorted = [...flows].reverse();
    sorted.forEach((flow, i) => {
      let domain = 'Bilinmeyen Domain';
      if (flow.startUrl || flow.url) {
        try {
          const urlObj = new URL(flow.startUrl || flow.url);
          domain = urlObj.hostname;
        } catch(e) { }
      }
      if (!groups[domain]) groups[domain] = [];
      const flowNumber = flows.length - i;
      groups[domain].push({ ...flow, flowNumber });
    });
    return groups;
  }, [flows]);

  // Auto-expand all domains by default on load
  useEffect(() => {
    const initialExpanded = {};
    Object.keys(flowsByDomain).forEach(domain => initialExpanded[domain] = true);
    setExpandedDomains(initialExpanded);
  }, [flowsByDomain]);

  const toggleDomain = (domain) => {
    setExpandedDomains(prev => ({ ...prev, [domain]: !prev[domain] }));
  };

  const onImportFlow = () => {
    const input = prompt("Lütfen 'TESTOCAN_FLOW_...' ile başlayan akış verisini yapıştırın:");
    if (!input || !input.trim().startsWith('TESTOCAN_FLOW_')) {
      if (input) alert("Geçersiz akış formatı!");
      return;
    }
    try {
      const base64Data = input.replace('TESTOCAN_FLOW_', '');
      const jsonStr = decodeURIComponent(escape(atob(base64Data)));
      const parsedFlow = JSON.parse(jsonStr);
      if (!parsedFlow.id || !parsedFlow.events) throw new Error("Eksik veri");
      
      chrome.storage.local.get(['flows'], (data) => {
        const currentFlows = data.flows || [];
        parsedFlow.id = crypto.randomUUID();
        parsedFlow.name = (parsedFlow.name || 'İçe Aktarılan Akış') + ' (Imported)';
        chrome.storage.local.set({ flows: [...currentFlows, parsedFlow] }, () => {
          alert("Akış başarıyla bilgi bankasına eklendi!");
          window.location.reload(); 
        });
      });
    } catch (err) {
      alert("Akış içe aktarılırken hata oluştu: " + err.message);
    }
  };

  return (
    <div className="history-view">
      <div className="steps-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{display:'flex', alignItems:'center', gap:'6px'}}><Layers size={14}/> Kaydedilen Akışlar</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="clear-btn" style={{ background: 'rgba(76, 175, 80, 0.2)', color: '#4caf50', borderColor: 'rgba(76, 175, 80, 0.3)' }} onClick={onImportFlow}>İçe Aktar</button>
            {flows.length > 0 && <button className="clear-btn" onClick={onClearAll}>Temizle</button>}
          </div>
        </div>
        {Object.keys(flowsByDomain).length > 0 && (
          <select 
            value={selectedFilterDomain} 
            onChange={e => setSelectedFilterDomain(e.target.value)}
            className="modern-select"
          >
            <option value="">-- Tüm Siteler --</option>
            {Object.keys(flowsByDomain).map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
      </div>
      {flows.length === 0 ? <div className="empty-state-card">
          <Folder size={40} className="empty-icon" />
          <h3>Henüz Kayıtlı Akış Yok</h3>
          <p>Hiçbir test akışı kaydetmemişsiniz. Ana ekrandan "Kaydı Başlat" diyerek ilk testinizi oluşturabilirsiniz.</p>
        </div> : (
        <div className="steps-scroll" style={{ padding: '0 8px' }}>
          {Object.entries(flowsByDomain)
            .filter(([domain]) => !selectedFilterDomain || domain === selectedFilterDomain)
            .map(([domain, domainFlows]) => (
            <div key={domain} className="history-domain-group">
              <div className="history-domain-header" onClick={() => toggleDomain(domain)}>
                <span className="history-domain-icon"></span>
                <span className="history-domain-name">{domain}</span>
                <span className="history-domain-count">{domainFlows.length} akış</span>
                <span className="history-domain-toggle">{expandedDomains[domain] ? '▼' : '▶'}</span>
              </div>
              
              {expandedDomains[domain] && (
                <div className="history-domain-flows">
                  {domainFlows.map((flow) => {
                    const displayName = flow.name || `Akış-${flow.flowNumber}`;
                    return (
                      <div className="flow-item" key={flow.id} onClick={() => onSelect(flow)}>
                        <div className="flow-item-left">
                          <div className="flow-item-title">
                            {displayName}
                            {flow.aiPrompt && <span className="ai-source-badge gemini" style={{ marginLeft: 6 }}>AI</span>}
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
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsView() {
  const [config, setConfig] = useState({ baseUrl: '', email: '', apiToken: '', projectKey: '', issueType: 'Bug' });
  const [geminiKey, setGeminiKey] = useState('');
  const [widgetPosition, setWidgetPosition] = useState('bottom-right');
  const [geminiConfigured, setGeminiConfigured] = useState(false);
  const [saved, setSaved] = useState(false);
  const [geminiSaved, setGeminiSaved] = useState(false);
  const [workspaceName, setWorkspaceName] = useState(null);
  const [syncStatus, setSyncStatus] = useState('');

  useEffect(() => {
    sendMsg(MSG.JIRA_GET_CONFIG).then((res) => {
      if (res?.ok && res.config) setConfig(res.config);
    });
    sendMsg(MSG.GEMINI_GET_STATUS).then((res) => {
      if (res?.ok) setGeminiConfigured(res.configured);
    });
    chrome.storage.local.get(['widgetPosition'], (res) => {
      if (res.widgetPosition) setWidgetPosition(res.widgetPosition);
    });
    WorkspaceSync.checkWorkspace().then((res) => {
      if (res.ok) setWorkspaceName(res.name);
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

  const handleSelectWorkspace = async () => {
    const res = await WorkspaceSync.selectWorkspace();
    if (res.ok) setWorkspaceName(res.name);
    else alert(res.error);
  };

  const handleExport = async () => {
    const res = await WorkspaceSync.exportData();
    if (res.ok) { setSyncStatus('Dışa aktarıldı!'); setTimeout(() => setSyncStatus(''), 2000); }
    else alert('Hata: ' + res.error);
  };

  const handleImport = async () => {
    const res = await WorkspaceSync.importData();
    if (res.ok) { 
      setSyncStatus(`İçe aktarıldı (${res.flowsCount || 0} akış)`);
      setTimeout(() => setSyncStatus(''), 2000); 
    }
    else alert('Hata: ' + res.error);
  };

  return (
    <div className="settings-view">
      <div className="steps-header"><span><span style={{display:'flex', alignItems:'center', gap:'6px'}}><Settings2 size={14}/> Genel Ayarlar</span></span></div>
      <div className="settings-form">
        <label>Yüzen Logo (Widget) Konumu
          <select 
            value={widgetPosition} 
            onChange={(e) => {
              setWidgetPosition(e.target.value);
              chrome.storage.local.set({ widgetPosition: e.target.value });
            }}
            className="modern-select"
          >
            <option value="bottom-right">Sağ Alt</option>
            <option value="bottom-left">Sol Alt</option>
            <option value="top-right">Sağ Üst</option>
            <option value="top-left">Sol Üst</option>
          </select>
        </label>
        <p className="settings-hint">Yan paneli küçülttüğünüzde web sayfasında çıkacak olan Testocan logosunun konumu.</p>
      </div>

      <div className="steps-header"><span><span style={{display:'flex', alignItems:'center', gap:'6px'}}><Sparkles size={14}/> Gemini AI</span></span>{geminiConfigured && <span className="gemini-badge">Bağlı</span>}</div>
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
          {geminiSaved ? 'Kaydedildi!' : 'Gemini Anahtarını Kaydet'}
        </button>
      </div>

      <div className="steps-header"><span><span style={{display:'flex', alignItems:'center', gap:'6px'}}><Folder size={14}/> AI Çalışma Alanı (Ajan Entegrasyonu)</span></span>{workspaceName && <span className="gemini-badge">{workspaceName}</span>}</div>
      <div className="settings-form">
        <p className="settings-hint">
          Test akışlarınızı bilgisayarınızdaki bir klasöre (örn: <b>.testocan</b>) bağlayarak Antigravity, Claude Code gibi ajanların doğrudan testleri düzenlemesini sağlayın.
        </p>
        {!workspaceName ? (
          <button className="record-btn start small" onClick={handleSelectWorkspace}>Çalışma Alanı Seç</button>
        ) : (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="record-btn small" onClick={handleSelectWorkspace} style={{ flex: 1, backgroundColor: '#333' }}>Değiştir</button>
            <button className="record-btn start small" onClick={handleExport} style={{ flex: 2 }}>Akışları Aktar (Export)</button>
            <button className="record-btn stop small" onClick={handleImport} style={{ flex: 2, backgroundColor: '#10a37f' }}>Güncellemeleri Al</button>
          </div>
        )}
        {syncStatus && <p className="settings-hint" style={{ color: '#10a37f', marginTop: 8 }}>{syncStatus}</p>}
      </div>

      <div className="steps-header"><span><span style={{display:'flex', alignItems:'center', gap:'6px'}}><Settings size={14}/> Jira Ayarları</span></span></div>
      <div className="settings-form">
        <label>Jira URL<input value={config.baseUrl} onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })} placeholder="https://firma.atlassian.net" /></label>
        <label>E-posta<input value={config.email} onChange={(e) => setConfig({ ...config, email: e.target.value })} placeholder="siz@firma.com" /></label>
        <label>API Token<input type="password" value={config.apiToken} onChange={(e) => setConfig({ ...config, apiToken: e.target.value })} placeholder="Jira API token'inız" /></label>
        <label>Proje Kodu<input value={config.projectKey} onChange={(e) => setConfig({ ...config, projectKey: e.target.value })} placeholder="ör. TEST" /></label>
        <label>Konu Türü<select value={config.issueType} onChange={(e) => setConfig({ ...config, issueType: e.target.value })}>
          <option value="Bug">Hata (Bug)</option><option value="Task">Görev (Task)</option><option value="Story">Hikaye (Story)</option>
        </select></label>
        <button className="record-btn start" onClick={saveJira}>{saved ? 'Kaydedildi!' : 'Jira Ayarlarını Kaydet'}</button>
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
  
  const [domains, setDomains] = React.useState([]);
  const [selectedDomain, setSelectedDomain] = React.useState('');

  React.useEffect(() => {
    chrome.storage.local.get(['savedDomains'], (data) => {
      setDomains(data.savedDomains || []);
    });
  }, []);

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
      // 1. Fetch available flows from KB
      const data = await new Promise(resolve => chrome.storage.local.get(['flows'], resolve));
      const allFlows = data.flows || [];
      const slimFlows = allFlows.map(f => ({ id: f.id, name: f.name, desc: f.desc || '' }));

      const finalPrompt = selectedDomain ? `[Hedef Site: ${selectedDomain}] ${taskText}` : taskText;
      const res = await sendMsg(MSG.SPLIT_TASK, { prompt: finalPrompt, availableFlows: slimFlows });
      
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

        // Auto-match check
        const primaryDef = safeFlows.find(f => f.isPrimary);
        let autoMatchedFlow = null;
        if (primaryDef && primaryDef.matchedPrimaryFlowId) {
          autoMatchedFlow = allFlows.find(f => f.id === primaryDef.matchedPrimaryFlowId);
          if (autoMatchedFlow) {
            primaryDef.events = autoMatchedFlow.events;
            console.log("Auto-matched primary flow from Knowledge Base:", autoMatchedFlow.name);
          }
        }

        // Read fresh tasks from storage before appending
        chrome.storage.local.get(['tasks'], async (taskData) => {
          const currentTasks = taskData.tasks || [];
          await saveTaskToStorage([...currentTasks, newTask]);
          setActiveTask(newTask);
          setTaskText('');

          // If auto-matched, trigger gap analysis immediately
          if (autoMatchedFlow) {
            setAnalyzingGaps(true);
            try {
              const gapRes = await sendMsg(MSG.ANALYZE_KNOWLEDGE_GAPS, {
                taskDesc: newTask.taskDescription,
                taskFlows: newTask.flows,
                primaryFlowEvents: autoMatchedFlow.events,
              });
              
              const updatedTask = JSON.parse(JSON.stringify(newTask));
              if (gapRes?.ok && gapRes.gaps) {
                updatedTask.knowledgeGaps = gapRes.gaps.map(g => ({ ...g, learnedEvents: null }));
              } else {
                updatedTask.knowledgeGaps = [];
              }
              
              // Save updated task back
              chrome.storage.local.get(['tasks'], (d) => {
                const cTasks = d.tasks || [];
                const nTasks = cTasks.map(t => t.id === updatedTask.id ? updatedTask : t);
                chrome.storage.local.set({ tasks: nTasks }, () => {
                  setTasks([...nTasks]);
                  setActiveTask(updatedTask); // ensure active matches storage
                });
              });

            } finally {
              setAnalyzingGaps(false);
            }
          }
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
    alert("Lütfen ana ekrandan 'Kaydı Başlat' diyerek testinizi yapın. Kayıt bittiğinde Geçmiş () sekmesinden son akışı bulup buraya dönün.");
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

      // Build knowledge bank: primary + all taught gaps + domain history
      const data = await new Promise(resolve => chrome.storage.local.get(['flows'], resolve));
      const allFlows = data.flows || [];
      const domainFlows = allFlows.filter(f => {
        try {
          if (!f.url && !f.startUrl) return false;
          const u = new URL(f.url || f.startUrl);
          return u.hostname === selectedDomain;
        } catch(e) { return false; }
      });

      const lessonFlows = [
        { id: 'primary', label: 'Birincil Akış', events: primaryDef?.events || [] },
        ...(updatedTask.knowledgeGaps || [])
          .filter(g => g.learnedEvents)
          .map(g => ({ id: g.id, label: g.label, events: g.learnedEvents })),
        ...domainFlows.map(df => ({
          id: `hist_${df.id}`,
          label: `Geçmiş Akış: ${df.name || 'İsimsiz'}`,
          events: df.events || []
        }))
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
            Yeni Görev Oluştur
          </div>
          {domains.length === 0 ? (
            <div className="empty-state-card" style={{ marginBottom: '16px' }}>
              <Globe size={40} className="empty-icon" />
              <h3>Kayıtlı Site Bulunamadı</h3>
              <p>Görev oluşturabilmek için öncelikle ana ekrandan test edilecek bir web sitesini bilgi bankanıza eklemelisiniz.</p>
            </div>
          ) : (
            <select
              value={selectedDomain}
              onChange={e => setSelectedDomain(e.target.value)}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '10px', marginBottom: '12px',
                background: 'rgba(0,0,0,0.25)', border: '1px solid #2a2d3a', borderRadius: '8px',
                color: selectedDomain ? '#e8eaf0' : '#7a849e', fontSize: '13px', outline: 'none'
              }}
            >
              <option value="">-- Hedef Site Seçin (Zorunlu) --</option>
              {domains.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
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
            disabled={actionLoading === 'task_split' || !taskText || !selectedDomain || domains.length === 0}
            style={{
              width: '100%', padding: '12px', marginTop: '10px', borderRadius: '8px', fontSize: '14px',
              fontWeight: '700', cursor: 'pointer', border: 'none',
              background: (actionLoading === 'task_split' || !taskText) ? '#333' : 'linear-gradient(135deg, #f5a623, #e08c10)',
              color: (actionLoading === 'task_split' || !taskText) ? '#666' : '#000',
            }}
          >
            {actionLoading === 'task_split' ? '⏳ Çözümleniyor...' : 'Yapay Zeka ile Çözümle '}
          </button>
        </div>

        {/* Past Tasks */}
        {tasks.length > 0 && (
          <div style={{ padding: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#a0a5b0', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
              <span style={{display:'flex', alignItems:'center', gap:'6px'}}><Folder size={14}/> Geçmiş Görevler</span>
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
                {f?.events ? `${f.events.length} adım` : (f?.isPrimary ? 'Kayıt Bekliyor' : 'Sentez Bekliyor')}
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
                  Bilgi Bankası — Eksiği Öğret
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
                        {gap.learnedEvents ? '' : ''} {gap.label}
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
                      <div style={{ fontSize: '11px', color: '#4facfe' }}>{gap.learnedEvents.length} adım öğrenildi</div>
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
              ? `Öğret: ${activeTask.knowledgeGaps?.find(g => g.id === teachingGapId)?.label || '?'}`
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
                  {selectedFlowIdx === i ? '' : ''}{f.name || `Akış ${i + 1}`}
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
              {teachingGapId ? 'Öğrendir' : 'Seç & Analiz Et'}
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
            {actionLoading === 'synthesize' ? '⏳ Sentezleniyor...' : allFlowsReady ? 'Sentezlendi' : 'Alt Akışları Sentezle'}
          </button>
        )}

        {/* Post-run disabled Sentezle placeholder */}
        {alreadyRan && (
          <button disabled style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #2a2d3a', background: 'rgba(255,255,255,0.02)', color: '#444', fontWeight: '600', fontSize: '13px', cursor: 'not-allowed' }}>
            Alt Akışları Sentezle
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
            <span style={{display:'flex', alignItems:'center', gap:'6px'}}><FileText size={14}/> Görev Raporu Gör</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  KNOWLEDGE TREE VIEW — Bilgi Havuzu Görüntüleyicisi
// ══════════════════════════════════════════════════════════════

function TreeNode({ node, depth = 0, searchQuery = '', selectedNodeId, onSelectNode }) {
  const [expanded, setExpanded] = useState(depth < 2); // Auto-expand first 2 levels
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedNodeId === node.id;

  // Check if this node or any descendant matches the search
  const matchesSearch = searchQuery && node.label?.toLowerCase().includes(searchQuery.toLowerCase());
  const hasMatchingDescendant = searchQuery && hasChildren && nodeTreeMatchesSearch(node, searchQuery);

  // Auto-expand nodes that have matching descendants
  useEffect(() => {
    if (hasMatchingDescendant && !expanded) {
      setExpanded(true);
    }
  }, [searchQuery, hasMatchingDescendant]);

  // If searching and this node doesn't match and has no matching descendants, hide it
  if (searchQuery && !matchesSearch && !hasMatchingDescendant) {
    return null;
  }

  const handleClick = () => {
    if (hasChildren) {
      setExpanded(!expanded);
    }
    onSelectNode(isSelected ? null : node.id);
  };

  // Highlight search matches in label
  const renderLabel = () => {
    if (!searchQuery || !matchesSearch) return node.label;
    const idx = node.label.toLowerCase().indexOf(searchQuery.toLowerCase());
    if (idx === -1) return node.label;
    return (
      <>
        {node.label.slice(0, idx)}
        <span className="search-highlight">{node.label.slice(idx, idx + searchQuery.length)}</span>
        {node.label.slice(idx + searchQuery.length)}
      </>
    );
  };

  const formatRelativeTime = (ts) => {
    if (!ts) return '';
    const diff = Date.now() - ts;
    if (diff < 60000) return 'az önce';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}dk önce`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}sa önce`;
    return `${Math.floor(diff / 86400000)}g önce`;
  };

  return (
    <div className="tree-node">
      <div
        className={`tree-node-header ${isSelected ? 'active' : ''}`}
        onClick={handleClick}
      >
        <span className={`tree-node-toggle ${hasChildren ? (expanded ? 'expanded' : '') : 'leaf'}`}>
          ▶
        </span>
        <span className="tree-node-icon">{node.icon}</span>
        <span className={`tree-node-label ${node.type}`} title={node.label}>
          {renderLabel()}
        </span>

        {/* Type badge for interactions */}
        {(node.type === 'click' || node.type === 'input' || node.type === 'change' || node.type === 'submit' || node.type === 'navigation') && (
          <span className={`tree-node-type-badge ${node.type}`}>{node.typeLabel}</span>
        )}

        {/* Count badge */}
        {node.count > 1 && (
          <span className="tree-node-badge highlight">{node.count}×</span>
        )}

        {/* Page visit count */}
        {node.type === 'page' && node.visitCount > 1 && (
          <span className="tree-node-badge">{node.visitCount} ziyaret</span>
        )}

        {/* Domain page count */}
        {node.type === 'domain' && (
          <span className="tree-node-badge highlight">{node.pageCount} sayfa</span>
        )}

        {/* Page interaction count */}
        {node.type === 'page' && node.interactionCount > 0 && (
          <span className="tree-node-badge">{node.interactionCount} etkileşim</span>
        )}
      </div>

      {/* Detail popover when selected */}
      {isSelected && (node.type === 'page' || node.type === 'click' || node.type === 'input' || node.type === 'change' || node.type === 'submit') && (
        <div className="tree-node-detail">
          {node.url && (
            <div className="tree-node-detail-row">
              <span className="tree-node-detail-key">URL</span>
              <span className="tree-node-detail-value">{node.url}</span>
            </div>
          )}
          {node.locator && node.locator.id && (
            <div className="tree-node-detail-row">
              <span className="tree-node-detail-key">ID</span>
              <span className="tree-node-detail-value">#{node.locator.id}</span>
            </div>
          )}
          {node.locator && node.locator.testId && (
            <div className="tree-node-detail-row">
              <span className="tree-node-detail-key">Test ID</span>
              <span className="tree-node-detail-value">{node.locator.testId}</span>
            </div>
          )}
          {node.locator && node.locator.role && (
            <div className="tree-node-detail-row">
              <span className="tree-node-detail-key">Rol</span>
              <span className="tree-node-detail-value">{node.locator.role}</span>
            </div>
          )}
          {node.locator && node.locator.tagName && (
            <div className="tree-node-detail-row">
              <span className="tree-node-detail-key">Element</span>
              <span className="tree-node-detail-value">&lt;{node.locator.tagName}&gt;</span>
            </div>
          )}
          {node.firstSeen && (
            <div className="tree-node-detail-row">
              <span className="tree-node-detail-key">İlk Görülme</span>
              <span className="tree-node-detail-value">{new Date(node.firstSeen).toLocaleString('tr-TR')}</span>
            </div>
          )}
          {node.lastSeen && (
            <div className="tree-node-detail-row">
              <span className="tree-node-detail-key">Son Görülme</span>
              <span className="tree-node-detail-value">{formatRelativeTime(node.lastSeen)}</span>
            </div>
          )}
        </div>
      )}

      {/* Children */}
      {hasChildren && (
        <div className={`tree-node-children ${expanded ? 'expanded' : 'collapsed'}`}
          style={{ maxHeight: expanded ? `${node.children.length * 200}px` : '0px' }}
        >
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              searchQuery={searchQuery}
              selectedNodeId={selectedNodeId}
              onSelectNode={onSelectNode}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function nodeTreeMatchesSearch(node, query) {
  const q = query.toLowerCase();
  if (node.label?.toLowerCase().includes(q)) return true;
  if (node.children) {
    return node.children.some(child => nodeTreeMatchesSearch(child, q));
  }
  return false;
}

// ── Graph View (D3) ─────────────────────────────────────────

function KnowledgeGraphView({ treeData }) {
  const d3Data = useMemo(() => {
    function mapNode(node) {
      return {
        name: node.label,
        attributes: {
          type: node.type,
          icon: node.icon,
          count: node.count,
        },
        children: node.children && node.children.length > 0 ? node.children.map(mapNode) : undefined,
      };
    }
    if (!treeData || !treeData.children) return null;
    return {
      name: 'Testocan Hafızası',
      attributes: { type: 'root', icon: '🧠' },
      children: treeData.children.map(mapNode),
    };
  }, [treeData]);

  if (!d3Data) return null;

  return (
    <div style={{ width: '100%', height: 'calc(100vh - 160px)', background: 'var(--bg-primary)' }}>
      <Tree 
        data={d3Data} 
        orientation="horizontal"
        pathFunc="step"
        translate={{ x: 40, y: 200 }}
        nodeSize={{ x: 250, y: 60 }}
        renderCustomNodeElement={({ nodeDatum, toggleNode }) => (
          <g onClick={toggleNode} style={{ cursor: 'pointer' }}>
            <foreignObject x="-15" y="-15" width="250" height="50" style={{ overflow: 'visible' }}>
              <div style={{ 
                display: 'flex', alignItems: 'center', background: 'var(--bg-elevated)', 
                border: nodeDatum.attributes?.type === 'root' ? '1px solid var(--accent)' : '1px solid var(--border)', 
                borderRadius: '20px', padding: '6px 12px', width: 'max-content',
                boxShadow: '0 4px 6px rgba(0,0,0,0.3)', color: 'var(--text-primary)',
                transition: 'transform 0.1s ease',
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
              >
                <span style={{ marginRight: '8px', fontSize: '14px' }}>{nodeDatum.attributes?.icon || '🌳'}</span>
                <span style={{ fontSize: '13px', fontWeight: '500' }}>
                  {nodeDatum.name.length > 30 ? nodeDatum.name.slice(0, 30) + '…' : nodeDatum.name}
                </span>
                {nodeDatum.attributes?.count > 1 && (
                  <span style={{ marginLeft: '8px', background: 'var(--accent)', color: '#000', borderRadius: '10px', padding: '0 6px', fontSize: '11px', fontWeight: 'bold' }}>
                    {nodeDatum.attributes.count}×
                  </span>
                )}
                {nodeDatum.children && nodeDatum.children.length > 0 && (
                  <span style={{ marginLeft: '8px', fontSize: '10px', opacity: 0.5 }}>
                    ({nodeDatum.children.length})
                  </span>
                )}
              </div>
            </foreignObject>
          </g>
        )}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────

function KnowledgeTreeView() {
  const [treeData, setTreeData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [isGraphView, setIsGraphView] = useState(false);

  const loadTree = useCallback(() => {
    setLoading(true);
    sendMsg(MSG.GET_KNOWLEDGE_TREE).then((res) => {
      if (res?.ok) {
        setTreeData(res.tree);
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  const handleClearKnowledge = () => {
    if (window.confirm('Tüm bilgi havuzu silinecek. Emin misiniz?')) {
      sendMsg(MSG.CLEAR_KNOWLEDGE).then(() => {
        setTreeData({ children: [], stats: { pages: 0, interactions: 0, totalVisits: 0 } });
      });
    }
  };

  if (loading) {
    return (
      <div className="knowledge-view">
        <div className="knowledge-empty">
          <div style={{ fontSize: '24px', animation: 'pulse 1s ease-in-out infinite' }}>🌳</div>
          <div className="knowledge-empty-desc">Bilgi havuzu yükleniyor…</div>
        </div>
      </div>
    );
  }

  const stats = treeData?.stats || { pages: 0, interactions: 0, totalVisits: 0 };
  const isEmpty = !treeData?.children || treeData.children.length === 0;

  return (
    <div className="knowledge-view">
      {/* Stats Bar (Compact) */}
      <div className="knowledge-stats-compact">
        <div className="knowledge-stat-badge">
          <span className="stat-val">{treeData.children.length}</span> Site
        </div>
        <div className="knowledge-stat-badge">
          <span className="stat-val">{stats.pages}</span> Sayfa
        </div>
        <div className="knowledge-stat-badge">
          <span className="stat-val">{stats.interactions}</span> Etkileşim
        </div>
        <div className="knowledge-stat-badge">
          <span className="stat-val">{stats.totalVisits}</span> Ziyaret
        </div>
      </div>

      {/* Domain Cards */}
      {!isEmpty && !isGraphView && (
        <div className="domain-cards-container">
          <div className="domain-cards-title">Kaydedilen Siteler</div>
          <div className="domain-cards-scroll">
            {treeData.children.map(domain => (
              <div className={`domain-card ${selectedNodeId === domain.id ? 'active' : ''}`} key={domain.id} onClick={() => setSelectedNodeId(domain.id)}>
                <div className="domain-card-icon">{domain.icon || <Globe size={14}/>}</div>
                <div className="domain-card-info">
                  <div className="domain-card-name">{domain.label}</div>
                  <div className="domain-card-stats">{domain.count || 0} Etkileşim</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search & Actions */}
      {!isEmpty && (
        <div className="knowledge-toolbar">
          {!isGraphView ? (
            <div className="knowledge-search-wrapper">
              <span className="knowledge-search-icon">🔍</span>
              <input
                className="knowledge-search"
                placeholder="Sayfa veya element ara…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          ) : (
            <div style={{ flex: 1, fontSize: '12px', color: 'var(--text-tertiary)' }}>
              Ağaçta gezinmek için sürükleyin, tekerlek ile yakınlaştırın. Düğümlere tıklayarak açıp kapatabilirsiniz.
            </div>
          )}
          
          <button className="knowledge-clear-btn" onClick={() => setIsGraphView(!isGraphView)} title="Görünümü Değiştir" style={{ color: isGraphView ? 'var(--accent-light)' : 'inherit', borderColor: isGraphView ? 'var(--accent)' : 'var(--border)' }}>
            {isGraphView ? '📃 Liste' : '🕸️ Görsel Ağaç'}
          </button>
          <button className="knowledge-clear-btn" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') })} title="<span style={{display:'flex', alignItems:'center', gap:'6px'}}><FileText size={14}/> Yeni Sekmede Aç</span>">
            ↗️ Yeni Sekme
          </button>
          <button className="knowledge-clear-btn" onClick={loadTree} title="Yenile" style={{ color: 'var(--accent-light)', borderColor: 'rgba(245,166,35,0.2)' }}>
            🔄
          </button>
        </div>
      )}

      {/* Tree or Empty State */}
      {isEmpty ? (
        <div className="knowledge-empty">
          <div className="knowledge-empty-icon">🌳</div>
          <div className="knowledge-empty-title">Bilgi Havuzu Boş</div>
          <div className="knowledge-empty-desc">
            Kayıt yaptıkça Testocan siteyi otomatik öğrenir. Butonlar, inputlar, sayfalar — her etkileşim bu ağaçta görünecek.
          </div>
          <div className="knowledge-empty-hint">
            ● İlk kaydınızı başlatın
          </div>
        </div>
      ) : isGraphView ? (
        <KnowledgeGraphView treeData={treeData} />
      ) : (
        <div className="knowledge-tree-container">
          {treeData.children.map((domainNode) => (
            <TreeNode
              key={domainNode.id}
              node={domainNode}
              depth={0}
              searchQuery={searchQuery}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
