import { marked } from 'marked';

document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('root');
  
  try {
    const data = await chrome.storage.local.get(['report_data_temp']);
    const reportData = data.report_data_temp;
    
    if (!reportData) {
      root.innerHTML = '<div class="report-content empty-state">Hata raporu verisi bulunamadı. Lütfen Testocan uzantısını kullanarak yeni bir rapor oluşturun.</div>';
      return;
    }

    // Parse markdown securely using bundled marked
    const parsedHtml = marked.parse(reportData.description || 'Rapor detayı yok.');

    // ── Flow Summary Bar (only for task reports) ──────────────
    let flowSummaryHtml = '';
    if (reportData.isTaskReport && reportData.flowSummary?.length > 0) {
      const items = reportData.flowSummary.map((f, i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:8px;background:${f.passed ? 'rgba(79,172,254,0.08)' : 'rgba(255,107,107,0.08)'};border:1px solid ${f.passed ? '#2a5298' : '#7b2c2c'};">
          <span style="font-size:20px">${f.passed ? '✅' : '❌'}</span>
          <div>
            <div style="font-size:13px;font-weight:600;color:#e8eaf0">${i + 1}. ${f.name}</div>
            <div style="font-size:11px;color:${f.passed ? '#4facfe' : '#ff6b6b'}">${f.passed ? 'Başarılı' : 'Başarısız'}</div>
          </div>
        </div>
      `).join('');

      const totalPassed = reportData.flowSummary.filter(f => f.passed).length;
      const totalFailed = reportData.flowSummary.length - totalPassed;

      flowSummaryHtml = `
        <div style="margin-bottom:28px;padding:20px;border-radius:12px;background:rgba(255,255,255,0.03);border:1px solid #1f2736;">
          <h2 style="margin:0 0 16px;font-size:15px;color:#a0a5b0;text-transform:uppercase;letter-spacing:0.5px">Test Özeti</h2>
          <div style="display:flex;gap:16px;margin-bottom:16px">
            <div style="flex:1;text-align:center;padding:12px;border-radius:8px;background:rgba(79,172,254,0.1);border:1px solid #2a5298">
              <div style="font-size:28px;font-weight:700;color:#4facfe">${totalPassed}</div>
              <div style="font-size:12px;color:#a0a5b0">Başarılı</div>
            </div>
            <div style="flex:1;text-align:center;padding:12px;border-radius:8px;background:rgba(255,107,107,0.1);border:1px solid #7b2c2c">
              <div style="font-size:28px;font-weight:700;color:#ff6b6b">${totalFailed}</div>
              <div style="font-size:12px;color:#a0a5b0">Başarısız</div>
            </div>
            <div style="flex:1;text-align:center;padding:12px;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid #2a2d3a">
              <div style="font-size:28px;font-weight:700;color:#e8eaf0">${reportData.flowSummary.length}</div>
              <div style="font-size:12px;color:#a0a5b0">Toplam</div>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">${items}</div>
        </div>
      `;
    }

    // ── Screenshot ─────────────────────────────────────────────
    let screenshotHtml = '';
    if (reportData.screenshot) {
      const label = reportData.isTaskReport ? 'Son Durum Ekran Görüntüsü' : 'Hata Ekran Görüntüsü';
      screenshotHtml = `
        <div style="margin-top:32px">
          <div style="font-size:13px;color:#a0a5b0;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.5px;">📸 ${label}</div>
          <div class="screenshot-container">
            <img src="${reportData.screenshot}" alt="${label}" style="max-width:100%;border-radius:8px;border:1px solid #2a2d3a" />
          </div>
        </div>
      `;
    }

    // ── Severity Badge ─────────────────────────────────────────────
    const severityColor = reportData.allPassed === true ? '#4facfe' : reportData.allPassed === false ? '#ff6b6b' : '#ff6b6b';
    const severityBg = reportData.allPassed === true ? 'rgba(79,172,254,0.15)' : 'rgba(255,107,107,0.15)';

    root.innerHTML = `
      <div class="report-content">
        <h1>${reportData.title || 'Hata Raporu'}</h1>
        <div style="margin-bottom:24px;">
          <span style="background:${severityBg};padding:4px 12px;border-radius:20px;font-size:13px;font-weight:700;color:${severityColor};">
            ${reportData.severity || 'Değerlendirilmemiş'}
          </span>
        </div>

        ${flowSummaryHtml}

        <div class="markdown-body">
          ${parsedHtml}
        </div>

        ${screenshotHtml}
      </div>
    `;
    
    // Clear the temp data so it doesn't take up space in storage longer than needed
    setTimeout(() => {
      chrome.storage.local.remove(['report_data_temp']);
    }, 5000);
    
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="report-content" style="color: #ff6b6b;">Rapor yüklenirken bir sorun oluştu: ${err.message}</div>`;
  }
});
