/**
 * ═══════════════════════════════════════════════════════════════
 *  TESTOCAN — AI Workspace Sync (File System Access API)
 * ═══════════════════════════════════════════════════════════════
 *  Allows Testocan to sync its flows to a local directory so that
 *  external AI agents (Antigravity, Claude Code, Copilot) can 
 *  read and modify them directly.
 */

// Simple IndexedDB wrapper to store the directory handle
const DB_NAME = 'TestocanWorkspaceDB';
const STORE_NAME = 'handles';

function getDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function setHandle(key, handle) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(handle, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function getHandle(key) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function verifyPermission(fileHandle, readWrite) {
  const options = {};
  if (readWrite) {
    options.mode = 'readwrite';
  }
  // Check if permission was already granted. If so, return true.
  if ((await fileHandle.queryPermission(options)) === 'granted') {
    return true;
  }
  // Request permission. If the user grants permission, return true.
  if ((await fileHandle.requestPermission(options)) === 'granted') {
    return true;
  }
  // The user didn't grant permission, so return false.
  return false;
}

export class WorkspaceSync {
  /**
   * Prompts the user to select a directory and stores the handle.
   */
  static async selectWorkspace() {
    try {
      const dirHandle = await window.showDirectoryPicker({
        mode: 'readwrite',
      });
      await setHandle('workspaceDir', dirHandle);
      return { ok: true, name: dirHandle.name };
    } catch (err) {
      if (err.name === 'AbortError') return { ok: false, error: 'İptal edildi.' };
      return { ok: false, error: err.message };
    }
  }

  /**
   * Checks if a workspace is already selected and we have permission.
   */
  static async checkWorkspace() {
    try {
      const dirHandle = await getHandle('workspaceDir');
      if (!dirHandle) return { ok: false, error: 'Çalışma alanı seçilmedi.' };
      
      const hasPerm = await verifyPermission(dirHandle, true);
      if (!hasPerm) return { ok: false, error: 'Klasör izni verilmedi.' };

      return { ok: true, name: dirHandle.name };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Cleans flow data by removing null/undefined properties to save AI tokens.
   */
  static cleanFlowData(flows) {
    if (!Array.isArray(flows)) return flows;
    return flows.map(flow => {
      const cleanFlow = { ...flow };
      if (cleanFlow.events) {
        cleanFlow.events = cleanFlow.events.map(e => {
          const cleanEvent = {};
          for (const key in e) {
            if (e[key] !== null && e[key] !== undefined && e[key] !== '') {
              cleanEvent[key] = e[key];
            }
          }
          if (cleanEvent.locator) {
            const cleanLoc = {};
            for (const key in cleanEvent.locator) {
              if (cleanEvent.locator[key] !== null && cleanEvent.locator[key] !== undefined && cleanEvent.locator[key] !== '') {
                // If it's a very long innerText, truncate it more aggressively for AI
                if (key === 'innerText' && typeof cleanEvent.locator[key] === 'string' && cleanEvent.locator[key].length > 50) {
                  cleanLoc[key] = cleanEvent.locator[key].slice(0, 50) + '...';
                } else {
                  cleanLoc[key] = cleanEvent.locator[key];
                }
              }
            }
            cleanEvent.locator = cleanLoc;
          }
          return cleanEvent;
        });
      }
      return cleanFlow;
    });
  }

  /**
   * Exports flows and tasks from chrome.storage to the workspace.
   */
  static async exportData() {
    try {
      const dirHandle = await getHandle('workspaceDir');
      if (!dirHandle) throw new Error('Çalışma alanı seçilmedi.');
      
      const hasPerm = await verifyPermission(dirHandle, true);
      if (!hasPerm) throw new Error('Klasör izni verilmedi.');

      // Get data from chrome storage
      const data = await new Promise((resolve) => {
        chrome.storage.local.get(['flows', 'tasks'], resolve);
      });

      // Write flows (cleaned for AI) into separate files
      const cleanedFlows = this.cleanFlowData(data.flows || []);
      const flowsDir = await dirHandle.getDirectoryHandle('flows', { create: true });
      
      // Delete existing files in the flows directory to avoid orphans
      for await (const entry of flowsDir.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.json')) {
          await flowsDir.removeEntry(entry.name);
        }
      }

      for (const flow of cleanedFlows) {
        // Safe filename: flowName_idPrefix.json
        const safeName = flow.name ? flow.name.replace(/[^a-z0-9ğüşöçiIĞÜŞÖÇİ]/gi, '_').substring(0, 30) : 'flow';
        const filename = `${safeName}_${flow.id.split('-')[0]}.json`;
        const flowHandle = await flowsDir.getFileHandle(filename, { create: true });
        const writable = await flowHandle.createWritable();
        await writable.write(JSON.stringify(flow, null, 2));
        await writable.close();
      }

      // Write tasks
      const tasksHandle = await dirHandle.getFileHandle('testocan_tasks.json', { create: true });
      const tasksWritable = await tasksHandle.createWritable();
      await tasksWritable.write(JSON.stringify(data.tasks || [], null, 2));
      await tasksWritable.close();

      // Export the AI Skill
      await this.exportSkill(dirHandle);

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Generates an Antigravity SKILL.md file so the AI automatically knows how to edit flows.
   */
  static async exportSkill(dirHandle) {
    try {
      // Create .agents/skills/testocan directory structure
      const agentsHandle = await dirHandle.getDirectoryHandle('.agents', { create: true });
      const skillsHandle = await agentsHandle.getDirectoryHandle('skills', { create: true });
      const testocanHandle = await skillsHandle.getDirectoryHandle('testocan', { create: true });
      
      const skillFile = await testocanHandle.getFileHandle('SKILL.md', { create: true });
      const skillWritable = await skillFile.createWritable();

      const skillContent = `---
name: testocan
description: "Düzenle, analiz et ve Testocan UI test akışlarını yönet. Kullanıcı bir testi değiştirmek, farklı bir veriyle denemek veya test akışını güncellemek istediğinde tetiklenir."
---

# Testocan Flow Editor Skill

Sen uzman bir QA Otomasyon Mühendisisin. Kullanıcı Testocan isimli bir test kayıt aracı kullanıyor. 
Senin görevin kullanıcının verdiği direktiflere göre \`testocan_flows.json\` dosyasındaki test akışlarını düzenlemektir.

## Görev ve Kurallar

Kullanıcı senden bir testi düzenlemeni istediğinde (Örn: "Şifreyi 123456 olarak güncelle" veya "Login testini ahmet@test.com ile yapacak şekilde değiştir"):

1. \`flows/\` klasörünün içindeki JSON dosyalarına bakarak bahsedilen testi (flow) isminden veya içindeki olaylardan bul. Her test ayrı bir JSON dosyasıdır.
2. Değiştirilmesi gereken adımı (event) bul. Bu genellikle \`action: "input"\` veya \`action: "change"\` olan ve \`locator\` objesi içindeki \`tagName\` değeri "input" olan bir adımdır.
3. O adımın \`value\` değerini kullanıcının istediği yeni değerle değiştir.
4. **DİKKAT:** Orijinal akıştaki hiçbir adımı silme veya sırasını bozma. Sadece ilgili adımın değerlerini güncelle.
5. Eğer kullanıcı bir tıklama (click) adımının hatalı olduğunu veya kaldırılması gerektiğini söylerse, o zaman o adımı \`events\` dizisinden silebilirsin.
6. Düzenlemeyi bitirdikten sonra dosyayı aynı formatta (JSON olarak) ait olduğu JSON dosyasının içerisine geri kaydet.
7. Kullanıcıya işlemin tamamlandığını ve Testocan eklentisindeki "Güncellemeleri Al" butonuna basabileceğini söyle.

## JSON Şeması (Özet)
- \`id\`: Akışın benzersiz kimliği
- \`name\`: Akışın adı
- \`events\`: Akıştaki adımların dizisi
  - \`action\`: Eylem türü ("click", "input", "scroll", vb.)
  - \`value\`: Sadece input/change eylemlerinde girilen metin
  - \`locator\`: Elementi bulmaya yarayan CSS seçiciler ve özellikler (tagName, innerText, cssSelector)
`;

      await skillWritable.write(skillContent);
      await skillWritable.close();
    } catch (e) {
      console.error("Skill export failed:", e);
      // We don't throw here to avoid failing the main export if folder creation fails
    }
  }

  /**
   * Imports flows and tasks from the workspace into chrome.storage.
   */
  static async importData() {
    try {
      const dirHandle = await getHandle('workspaceDir');
      if (!dirHandle) throw new Error('Çalışma alanı seçilmedi.');
      
      const hasPerm = await verifyPermission(dirHandle, true);
      if (!hasPerm) throw new Error('Klasör izni verilmedi.');

      const result = {};

      // Read flows from the 'flows' directory
      try {
        const flowsDir = await dirHandle.getDirectoryHandle('flows');
        const importedFlows = [];
        for await (const entry of flowsDir.values()) {
          if (entry.kind === 'file' && entry.name.endsWith('.json')) {
            const file = await entry.getFile();
            const text = await file.text();
            try {
              const flow = JSON.parse(text);
              // basic validation
              if (flow && flow.id && Array.isArray(flow.events)) {
                importedFlows.push(flow);
              }
            } catch (parseErr) {
              console.warn("Failed to parse flow file:", entry.name);
            }
          }
        }
        
        if (importedFlows.length > 0) {
          // Sort them by timestamp if available to keep history order
          importedFlows.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
          await new Promise((resolve) => chrome.storage.local.set({ flows: importedFlows }, resolve));
          result.flowsCount = importedFlows.length;
        }
      } catch (e) {
        // flows directory might not exist yet
        console.warn("Could not read flows directory", e);
      }

      // Read tasks
      try {
        const tasksHandle = await dirHandle.getFileHandle('testocan_tasks.json');
        const file = await tasksHandle.getFile();
        const text = await file.text();
        const tasks = JSON.parse(text);
        if (Array.isArray(tasks)) {
          await new Promise((resolve) => chrome.storage.local.set({ tasks }, resolve));
          result.tasksCount = tasks.length;
        }
      } catch (e) {
        // file might not exist, ignore
      }

      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}
