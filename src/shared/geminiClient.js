/**
 * ═══════════════════════════════════════════════════════════════
 *  TESTOCAN — Gemini AI Client
 * ═══════════════════════════════════════════════════════════════
 *  Integrates Google Gemini AI for:
 *    1. Intelligent flow parameterization (complex NL prompts)
 *    2. Smart assertion generation from natural language
 *    3. Enhanced bug report descriptions
 *
 *  Falls back to rule-based AIEngine when API key is not set.
 */

class GeminiClient {
  static API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
  static MODEL = 'gemini-3.1-flash-lite-preview';

  /**
   * Save Gemini API key.
   */
  static async saveApiKey(apiKey) {
    await chrome.storage.local.set({ geminiApiKey: apiKey });
  }

  /**
   * Get Gemini API key.
   */
  static async getApiKey() {
    const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
    return geminiApiKey || null;
  }

  /**
   * Check if Gemini is configured.
   */
  static async isConfigured() {
    const key = await GeminiClient.getApiKey();
    return !!key;
  }

  /**
   * Make a Gemini API call.
   */
  static async generate(prompt, systemInstruction = null, isJson = false) {
    try {
      const apiKey = await this.getApiKey();
      if (!apiKey) return { ok: false, error: 'Gemini API anahtarı ayarlanmamış.' };

      const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      };

      if (systemInstruction) {
        body.systemInstruction = { parts: [{ text: systemInstruction }] };
      }

      body.generationConfig = {
        temperature: 0.2,
        topP: 0.8,
        maxOutputTokens: 2000,
      };
      
      if (isJson) {
        body.generationConfig.responseMimeType = "application/json";
      }

      const response = await fetch(
        `${GeminiClient.API_BASE}/${GeminiClient.MODEL}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        return { ok: false, error: `HTTP ${response.status}: ${errText}` };
      }

      const result = await response.json();
      const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return { ok: false, error: 'Empty response from Gemini' };

      return { ok: true, text };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  static async modifyFlow(prompt, events) {
    // Build a simplified timeline of ALL events so Gemini understands the flow structure
    const simplifiedEvents = events.map((e, index) => {
      const loc = e.locator || {};
      const simplified = {
        index,
        action: e.action,
        label: (loc.innerText?.slice(0, 50) || loc.placeholder || loc.name || loc.ariaLabel || loc.id || loc.tagName || 'unknown').trim(),
      };
      if (e.action === 'input' || e.action === 'change') {
        simplified.currentValue = e.value || '';
        simplified.type = loc.type || 'text';
      }
      if (e.key) simplified.key = e.key;
      return simplified;
    });

    if (events.length === 0) {
      return { ok: true, modifiedEvents: events, changes: [], message: 'No events to modify.' };
    }

    const systemInstruction = `You are Testocan, an AI test automation agent. You analyze recorded test flows and modify them based on user instructions.
The user might ask you to run the same test with a different email, password, or other values.

IMPORTANT: You MUST respond with ONLY a valid JSON object.

The response format MUST be exactly:
{
  "newFlow": [
    { "sourceIndex": 0 },
    { "sourceIndex": 1, "newValue": "new_email@test.com" }
  ],
  "message": "I updated the email as requested."
}

Rules:
1. "newFlow" is an array that represents the final timeline sequence of events.
2. Every item must have a "sourceIndex" pointing to the original event index.
3. You MUST include ALL steps from the original flow! If the user just wants to change a login email, you must output ALL original steps in order, but add "newValue" to the 'input' or 'change' step where the email is typed.
4. "newValue" ONLY applies to 'input' or 'change' actions to overwrite their typed value.
5. If the user instruction is irrelevant, return the original sequence.`;

    const userPrompt = `Here is the recorded test flow timeline:
${JSON.stringify(simplifiedEvents, null, 2)}

User's instruction: "${prompt}"

Analyze and construct the new flow timeline array as JSON.`;

    const result = await GeminiClient.generate(userPrompt, systemInstruction, true);
    if (!result.ok) return result;

    try {
      // Parse AI response (robustly just in case responseMimeType is ignored by some endpoint)
      const cleaned = result.text.replace(/```(?:json)?\n?/gi, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      const newFlowDesc = parsed.newFlow || [];

      if (newFlowDesc.length === 0) {
        return { ok: true, modifiedEvents: events, changes: [], message: 'No relevant changes understood by AI.' };
      }

      const modifiedEvents = [];
      const appliedChanges = [];

      for (let i = 0; i < newFlowDesc.length; i++) {
        const instruction = newFlowDesc[i];
        const originalEvent = events[instruction.sourceIndex];
        
        if (!originalEvent) continue;
        
        // Deep clone the original event
        const clonedEvent = JSON.parse(JSON.stringify(originalEvent));
        
        if (instruction.newValue !== undefined && (clonedEvent.action === 'input' || clonedEvent.action === 'change')) {
          const oldVal = clonedEvent.value;
          clonedEvent.value = instruction.newValue;
          
          appliedChanges.push({
            field: simplifiedEvents[instruction.sourceIndex].label,
            oldValue: oldVal,
            newValue: instruction.newValue,
            eventIndex: i, // new index in the modified array
          });
        }
        modifiedEvents.push(clonedEvent);
      }

      // If appliedChanges is empty but length changed, it means we duplicated/deleted blocks
      if (appliedChanges.length === 0 && modifiedEvents.length !== events.length) {
        appliedChanges.push({
          field: 'Flow Structure',
          oldValue: `${events.length} steps`,
          newValue: `${modifiedEvents.length} steps`,
          eventIndex: -1
        });
      }

      return { ok: true, modifiedEvents, changes: appliedChanges, message: parsed.message };
    } catch (parseErr) {
      return { ok: false, error: `Failed to parse AI response: ${parseErr.message}` };
    }
  }

  /**
   * AI-powered assertion generation from natural language.
   */
  static async generateAssertions(prompt, flowContext = null) {
    const systemInstruction = `You are Testocan, an AI test automation agent. You convert natural language test expectations into structured assertion objects.

IMPORTANT: You MUST respond with ONLY a valid JSON array, no markdown, no code blocks.

Available assertion types:
- textVisible: { "type": "textVisible", "text": "<text to look for on page>" }
- urlContains: { "type": "urlContains", "pattern": "<string the URL should contain>" }
- elementExists: { "type": "elementExists", "locator": { "id": "<id>", "testId": "<test-id>", "innerText": "<text>" } }
- elementHasText: { "type": "elementHasText", "locator": { ... }, "text": "<expected text>" }

Return a JSON array of assertion objects.`;

    const userPrompt = flowContext
      ? `Test flow URL: ${flowContext.url}\nUser's assertion: "${prompt}"\n\nGenerate assertion objects.`
      : `User's assertion: "${prompt}"\n\nGenerate assertion objects.`;

    const result = await GeminiClient.generate(userPrompt, systemInstruction, true);
    if (!result.ok) return result;

    try {
      const cleaned = result.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const assertions = JSON.parse(cleaned);
      return { ok: true, assertions: Array.isArray(assertions) ? assertions : [assertions] };
    } catch {
      // Fallback: treat as simple text visibility check
      return { ok: true, assertions: [{ type: 'textVisible', text: prompt }] };
    }
  }

  /**
   * AI-enhanced bug report description.
   */
  static async enhanceBugReport(report) {
    const systemInstruction = `Sen Testocan'sın, uzman bir yapay zeka QA mühendisisin.
Sana ham bir hata raporu (Markdown) verilecek. Bunu aşağıdaki kurallara uyarak yeniden yaz:

1. **Türkçe yaz.** HTTP, API, URL gibi teknik terimleri aynen kullanabilirsin.
2. **Özet bölümü:** "Kullanıcı X işlemini yaptı, ardından Y adımında Z hatası oluştu" formatında kısa bir anlatı yaz. Tüm adımları listeleme, sadece hatayı tetikleyen ana eylemi anlat.
3. **Hata bölümü:** Hangi API endpoint'inin, hangi HTTP kodu ile hata verdiğini açıkça belirt. Yanıt body'si varsa özetle.
4. **Adımlar bölümü:** Yalnızca hatayı tetikleyecek minimum adımları listele. Tekrarlayan adımları birleştir.
5. **Şifre ve hassas bilgiler:** Asla gösterme. Bunlar zaten raporda "[ŞİFRE GİRİLDİ]" olarak geçiyor, aynen bırak.
6. **Ekran görüntüsü notu:** Ekran görüntüsü hatanın yaşandığı anı göstermektedir — bunu özette belirt.
7. Doğrudan Markdown çıktısı ver — JSON değil.`;

    const result = await GeminiClient.generate(
      `Şu hata raporunu geliştir:\n\n${report.description}`,
      systemInstruction,
      false
    );

    if (!result.ok) return report;

    return {
      ...report,
      description: result.text,
      aiEnhanced: true,
    };
  }

  /**
   * Splits a raw task description into a structured Task object with sub-flows.
   */
  static async splitTask(prompt, availableFlows = []) {
    let flowsContext = '';
    if (availableFlows.length > 0) {
      flowsContext = `
Ayrıca Bilgi Bankasında (Knowledge Base) daha önceden kaydedilmiş şu akışlar (flows) mevcut:
${JSON.stringify(availableFlows, null, 2)}

Eğer belirlediğin YALNIZCA BİR TANE OLAN ANA AKIŞ (isPrimary: true olan akış), bu bilgi bankasındaki akışlardan biriyle (ismi veya açıklaması itibarıyla) doğrudan eşleşiyorsa, o ana akışın JSON nesnesine "matchedPrimaryFlowId" adlı bir alan ekle ve değerini bilgi bankasındaki eşleşen akışın "id"si yap.
`;
    }

    const systemInstruction = `Sen Testocan'sın, uzman bir AI test orkestratörüsün. Kullanıcının verdiği genel "Görevi (Task)" analiz et ve test edilmesi gereken senaryoları (flows) parçalara ayır.
    
ÇIKTI FORMU KESİNLİKLE AŞAĞIDAKİ GİBİ BİR JSON OLMALIDIR:
{
  "taskName": "Kısa ve öz görev başlığı",
  "taskDescription": "Görevin genel özeti",
  "flows": [
    {
      "id": "benzersiz-bir-id",
      "name": "Alt senaryo adı (Örn: YUSUFTEST ile Geçersiz Karakter Testi)",
      "desc": "Bu akışta tam olarak ne test edilecek detaylı açıklama",
      "isPrimary": boolean, // YALNIZCA BİR TANESİ TRUE OLMALIDIR.
      "matchedPrimaryFlowId": "eğer-eşleşme-varsa-id" // Opsiyonel: Sadece isPrimary: true ise ve bilgi bankasındaki bir akışla eşleşiyorsa ekle.
    }
  ]
}

Önemli kural: 'isPrimary: true' olan akış, testin kalbini oluşturan, kullanıcının en çok etkileşime gireceği akış olmalıdır. Diğer akışlar bu ana akış baz alınarak kopyalanıp yapılacaktır.${flowsContext}`;

    const result = await GeminiClient.generate(prompt, systemInstruction, true);
    if (!result.ok) return result;

    try {
      const cleaned = result.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const taskObj = JSON.parse(cleaned);
      return { ok: true, task: taskObj };
    } catch {
      return { ok: false, error: 'Görev çözümlenemedi (JSON ayrıştırma hatası).' };
    }
  }
  /**
   * AI-driven flow synthesis based on a primary flow and a target flow description.
   */
  /**
   * Analyzes what actions AI has learned from the primary flow and what is still missing
   * to execute the secondary flows in the task.
   * Returns a list of "knowledge gaps" the user should teach via mini-recordings.
   */
  static async analyzeKnowledgeGaps(taskDesc, taskFlows, primaryFlowEvents) {
    const simplePrimary = (primaryFlowEvents || []).map((e, i) => ({
      i,
      action: e.action,
      label: (e.locator?.innerText?.slice(0, 40) || e.locator?.placeholder || e.locator?.name || e.locator?.id || e.locator?.tagName || '?').trim(),
      ...(e.action === 'input' || e.action === 'change' ? { value: e.value } : {}),
    }));

    const secondaryFlowDescs = (taskFlows || [])
      .filter(f => !f.isPrimary && f)
      .map(f => `- ${f.name}: ${f.desc}`)
      .join('\n');

    const systemInstruction = `Sen Testocan'sın. Uzman bir QA otomasyon m\u00fchendisisin.
Sana bir test g\u00f6revinin birincil ak\u0131\u015f kay\u0131tlar\u0131 ve sentezlenmesi gereken di\u011fer ak\u0131\u015flar verilecek.
G\u00f6rev: Birincil ak\u0131\u015fta BULUNMAYAN ancak di\u011fer ak\u0131\u015flar i\u00e7in gerekli olan eylemleri tespit et.

D\u00d6NECEK JSON FORMAT\u0130:
{
  "gaps": [
    {
      "id": "gap_logout",
      "label": "\u00c7\u0131k\u0131\u015f Yapma",
      "whyNeeded": "TEST kullan\u0131c\u0131s\u0131ndan YUSUFTEST'e ge\u00e7i\u015f i\u00e7in",
      "relatedFlows": ["YUSUFTEST ile Bayi Talebini Onaylama"],
      "mandatory": true
    }
  ]
}

KURALLAR:
- Sadece ger\u00e7ekten eksik olan eylemleri listele (giri\u015f yapma varsa ekleme).
- id alan\u0131 k\u0131sa ve benzersiz olmal\u0131 (\u00f6rn: gap_logout, gap_notification).
- E\u011fer hi\u00e7 gap yoksa bo\u015f array d\u00f6n: { "gaps": [] }`;

    const userPrompt = `G\u00f6rev A\u00e7\u0131klamas\u0131:\n${taskDesc}\n\nSentezlenecek Ak\u0131\u015flar:\n${secondaryFlowDescs}\n\nBirincil Ak\u0131\u015f (\u00d6\u011frenilen Eylemler):\n${JSON.stringify(simplePrimary, null, 2)}\n\nHangi eylemler hala eksik?`;

    const result = await GeminiClient.generate(userPrompt, systemInstruction, true);
    if (!result.ok) return { ok: false, error: result.error };

    try {
      const cleaned = result.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return { ok: true, gaps: parsed.gaps || [] };
    } catch (e) {
      return { ok: false, error: 'Analiz parse edilemedi: ' + e.message };
    }
  }

  /**
   * Synthesizes a new flow using a knowledge bank of multiple lesson flows.
   * lessonFlows: [{ id: 'primary'|'gap_xxx', label: '...', events: [...] }]
   */
  static async synthesizeTaskFlow(lessonFlows, targetFlowDesc) {
    // Build structured knowledge bank for AI
    const knowledgeBank = (lessonFlows || []).map(lf => ({
      id: lf.id,
      label: lf.label,
      events: (lf.events || []).map((e, i) => {
        const loc = e.locator || {};
        const ev = {
          index: i,
          action: e.action,
          label: (loc.innerText?.slice(0, 50) || loc.placeholder || loc.name || loc.ariaLabel || loc.id || loc.tagName || 'unknown').trim(),
        };
        if (e.action === 'input' || e.action === 'change') {
          ev.currentValue = e.value || '';
          ev.type = loc.type || 'text';
        }
        return ev;
      }),
    }));

    const systemInstruction = `Sen Testocan'sın. Uzman bir QA test otomatikleştiricisisin.
Sana birden fazla "Ders Akışı" (Lesson Flow) içeren bir Bilgi Bankası ve bir Hedef Akış açıklaması verilecek.
Görev: Bilgi bankasındaki doğru lesson flow'lardan doğru event'leri seçerek Hedef Akış için yeni bir event listesi oluştur.

ÇIKTI SADECE AŞAĞIDAKİ JSON FORMATINDA OLMALIDIR:
{
  "newFlow": [
    { "flowId": "primary", "sourceIndex": 0 },
    { "flowId": "gap_logout", "sourceIndex": 2 },
    { "flowId": "primary", "sourceIndex": 5, "newValue": "TEST" }
  ]
}

KURALLAR:
- flowId: hangi lesson flow'dan alındığını belirtir (örn: "primary", "gap_logout")
- sourceIndex: o lesson flow'un kaçıncı event'i
- newValue: sadece input/change event'leri için kullanıcı adı, şifre gibi değerlerin değişmesi gerekiyorsa yaz
- Her adımı mantıklı sırayla al, akışın doğal olmasına dikkat et`;

    const userPrompt = `Bilgi Bankası (Lesson Flows):\n${JSON.stringify(knowledgeBank, null, 2)}\n\nHedef Akış: "${targetFlowDesc.name}"\nAçıklama: "${targetFlowDesc.desc}"\n\nYeni akışı yukarıdaki formatla döndür.`;

    const result = await GeminiClient.generate(userPrompt, systemInstruction, true);
    if (!result.ok) return result;

    try {
      const cleaned = result.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      const newFlowDesc = parsed.newFlow || [];

      // Build a lookup map from flowId to events array
      const flowMap = {};
      for (const lf of lessonFlows || []) {
        flowMap[lf.id] = lf.events || [];
      }

      const synthesizedEvents = [];
      for (const instruction of newFlowDesc) {
        const sourceEvents = flowMap[instruction.flowId];
        if (!sourceEvents) continue;
        const originalEvent = sourceEvents[instruction.sourceIndex];
        if (!originalEvent) continue;
        const clonedEvent = JSON.parse(JSON.stringify(originalEvent));
        if (instruction.newValue !== undefined && (clonedEvent.action === 'input' || clonedEvent.action === 'change')) {
          clonedEvent.value = instruction.newValue;
        }
        synthesizedEvents.push(clonedEvent);
      }

      return { ok: true, events: synthesizedEvents };
    } catch (parseErr) {
      return { ok: false, error: 'Ak\u0131\u015f sentezi ba\u015far\u0131lamad\u0131: ' + parseErr.message };
    }
  }

  /**
   * Generates a comprehensive AI-enhanced task report in Turkish Markdown.
   * Takes raw task execution data and produces a professional QA report.
   */
  static async enhanceTaskReport(taskData) {
    const systemInstruction = `Sen Testocan'sın — uzman bir Türk Yazılım QA Mühendisisin.
Sana bir test görevinin tüm akış sonuçları (başarılı/başarısız adımlar, ağ hataları, konsol hataları, assertion sonuçları) verilecek.
Bunları profesyonel, ayrıntılı bir Markdown QA Test Raporu'na dönüştür.

KURALLAR:
- Sadece Türkçe yaz.
- Şifre, parola, token gibi hassas bilgileri ASLA gösterme. Bunları [GÜVENLİK NEDENİYLE GİZLENDİ] olarak yaz.
- Her başarısız akış için ayrı bir "Hata Analizi" bölümü oluştur.
- Ağ hatalarını (URL, HTTP kodu, metot) açıkça listele.
- Console/JS hatalarını açıkça listele.
- Başarısız olan adımları (hangi elemente tıklanmaya çalışıldı, ne yapılmak istendi) detaylı anlat.
- Bir "Genel Değerlendirme" ve "Öneriler" bölümü ekle.
- Rapor sonunda "Test Edilenler Özeti" tablosu ekle.
- Markdown formatında olsun. Başlıklar için #, ##, ### kullan.`;

    // Build a structured raw report for AI to enhance
    let rawReport = `Görev: ${taskData.taskName}\nAçıklama: ${taskData.taskDescription}\nToplam Akış: ${taskData.flows.length}\n\n`;

    for (const [i, flow] of (taskData.flows || []).entries()) {
      rawReport += `=== AKİŞ ${i + 1}: ${flow.flowName} ===\n`;
      rawReport += `Durum: ${flow.passed ? 'BAŞARILI' : 'BAŞARISIZ'}\n`;

      if (flow.failedSteps && flow.failedSteps.length > 0) {
        rawReport += `Başarısız Adımlar:\n`;
        flow.failedSteps.forEach(s => {
          rawReport += `  - [${s.action || '?'}] "${s.label || s.cssSelector || 'Bilinmeyen element'}" — Hata: ${s.error || 'Adım gerçekleştirilemedi'}\n`;
        });
      }

      if (flow.networkErrors && flow.networkErrors.length > 0) {
        rawReport += `Ağ Hataları:\n`;
        flow.networkErrors.forEach(e => {
          rawReport += `  - ${e.method || 'GET'} ${e.url} → HTTP ${e.status || '?'} — ${e.statusText || ''}\n`;
        });
      }

      if (flow.consoleErrors && flow.consoleErrors.length > 0) {
        rawReport += `Konsol Hataları:\n`;
        flow.consoleErrors.slice(0, 5).forEach(e => {
          rawReport += `  - ${e.text || e.message || JSON.stringify(e)}\n`;
        });
      }

      if (flow.assertionFailures && flow.assertionFailures.length > 0) {
        rawReport += `Doğrulama (Assertion) Hataları:\n`;
        flow.assertionFailures.forEach(a => {
          rawReport += `  - ${a.type}: "${a.text || a.pattern || JSON.stringify(a)}" — BAŞARISIZ\n`;
        });
      }

      rawReport += '\n';
    }

    const result = await GeminiClient.generate(
      `Aşağıdaki ham test sonuçlarını profesyonel bir QA raporuna dönüştür:\n\n${rawReport}`,
      systemInstruction,
      false
    );

    if (!result.ok) {
      // If AI fails, return the raw report in a basic format
      return { ok: true, description: `# Görev Raporu: ${taskData.taskName}\n\n${rawReport}`, aiEnhanced: false };
    }

    return { ok: true, description: result.text, aiEnhanced: true };
  }

}

if (typeof module !== 'undefined') module.exports = { GeminiClient };
if (typeof self !== 'undefined') self.GeminiClient = GeminiClient;
