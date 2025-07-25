const { ipcRenderer, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const remote = require('@electron/remote');

let saveDir = localStorage.getItem('wb_save_dir') || '';

function ensureSaveDir() {
  if (!saveDir) {
    // По умолчанию создаём папку в Documents
    const userDocs = remote.app.getPath('documents');
    saveDir = path.join(userDocs, 'WB_Parser_Results');
    if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir);
    localStorage.setItem('wb_save_dir', saveDir);
  }
}

const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const fileList = document.getElementById('file-list');
const previewTitle = document.getElementById('preview-title');
const previewTable = document.getElementById('preview-table');
const loadingOverlay = document.getElementById('loading-overlay');

let previewData = [];
let previewHeaders = [];
let sortState = { col: null, dir: 1 };

// --- АКТИВАЦИЯ ---
let isActivated = false;
const APP_VERSION = '1.0.8'; // Текущая версия приложения
const GITHUB_OWNER = 'ВАШ_GITHUB_НИК'; // заменить на ваш ник
const GITHUB_REPO = 'ВАШ_РЕПОЗИТОРИЙ'; // заменить на ваш репозиторий
const GITHUB_BRANCH = 'production';

let currentFile = '';

async function updateFileList() {
  try {
    const files = await getXlsxFiles();
    // Sidebar больше не содержит список файлов
    // Обновляем только выпадающий список
    const tableSelect = document.getElementById('table-select');
    if (tableSelect) {
      tableSelect.innerHTML = '<option value="">Выберите таблицу...</option>';
      files.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f;
        opt.textContent = f;
        tableSelect.appendChild(opt);
      });
      tableSelect.value = currentFile || '';
    }
  } catch (e) {
    console.error('Ошибка обновления списка файлов:', e);
  }
}

function selectTable(filename) {
  if (!filename) return;
  currentFile = filename;
  const tableSelect = document.getElementById('table-select');
  if (tableSelect) tableSelect.value = filename;
  previewFile(filename);
}

let compareTableData = null;

window.addEventListener('DOMContentLoaded', () => {
  ipcRenderer.on('activation-status', (event, status) => {
    isActivated = status;
    renderActivation();
  });
  checkForUpdate();
  ipcRenderer.on('update-message', (event, msg) => {
    alert(msg); // Можно заменить на красивый UI, если потребуется
  });
  // --- Кнопка показа/скрытия аналитики ---
  const toggleBtn = document.getElementById('toggle-summary');
  const summaryWrapper = document.getElementById('summary-wrapper');
  if (toggleBtn && summaryWrapper) {
    let open = false;
    toggleBtn.onclick = () => {
      open = !open;
      if (open) {
        summaryWrapper.classList.add('open');
        summaryWrapper.style.display = 'block';
        toggleBtn.textContent = 'Скрыть аналитику';
      } else {
        summaryWrapper.classList.remove('open');
        setTimeout(() => summaryWrapper.style.display = 'none', 350);
        toggleBtn.textContent = 'Показать аналитику';
      }
    };
  }
  // --- Модальное окно аналитики ---
  const toggleBtnModal = document.getElementById('toggle-summary');
  const summaryModal = document.getElementById('summary-modal');
  const closeSummaryModal = document.getElementById('close-summary-modal');
  if (toggleBtnModal && summaryModal && closeSummaryModal) {
    toggleBtnModal.onclick = () => {
      summaryModal.style.display = 'flex';
    };
    closeSummaryModal.onclick = () => {
      summaryModal.style.display = 'none';
    };
    summaryModal.onclick = (e) => {
      if (e.target === summaryModal) summaryModal.style.display = 'none';
    };
  }
  // --- Модальное окно настроек ---
  const settingsBtn = document.getElementById('settings-btn');
  const settingsModal = document.getElementById('settings-modal');
  const closeSettingsModal = document.getElementById('close-settings-modal');
  const folderPathInput = document.getElementById('folder-path');
  const chooseFolderBtn = document.getElementById('choose-folder-btn');
  
  if (settingsBtn && settingsModal && closeSettingsModal && folderPathInput && chooseFolderBtn) {
    settingsBtn.onclick = async () => {
      // Обновляем информацию в модальном окне
      folderPathInput.value = saveDir;
      // Обновляем статус активации
      const activationStatus = document.getElementById('activation-status');
      if (activationStatus) {
        if (isActivated) {
          activationStatus.textContent = '✅ Приложение активировано';
          activationStatus.style.color = '#43a047';
          // Получаем инфо о сроке действия
          const info = await ipcRenderer.invoke('get-activation-info');
          let extra = '';
          if (info && info.type !== 'unlimited' && info.expires_at) {
            const now = new Date();
            const exp = new Date(info.expires_at);
            const diffMs = exp - now;
            if (diffMs > 0) {
              const days = Math.floor(diffMs / (1000*60*60*24));
              const hours = Math.floor((diffMs % (1000*60*60*24)) / (1000*60*60));
              const minutes = Math.floor((diffMs % (1000*60*60)) / (1000*60));
              extra = `\nОсталось: ${days} д. ${hours} ч. ${minutes} мин.`;
            } else {
              extra = '\nСрок действия истёк!';
            }
          }
          activationStatus.textContent += extra;
        } else {
          activationStatus.textContent = '❌ Требуется активация';
          activationStatus.style.color = '#d32f2f';
        }
      }
      // Обновляем информацию о версии
      const versionInfo = document.getElementById('version-info');
      if (versionInfo) {
        versionInfo.textContent = `Версия: ${APP_VERSION}`;
      }
      settingsModal.style.display = 'flex';
    };
    
    closeSettingsModal.onclick = () => {
      settingsModal.style.display = 'none';
    };
    
    settingsModal.onclick = (e) => {
      if (e.target === settingsModal) settingsModal.style.display = 'none';
    };
    
    chooseFolderBtn.onclick = async () => {
      const { dialog } = remote;
      const res = await dialog.showOpenDialog({ properties: ['openDirectory'] });
      if (res.canceled || !res.filePaths || !res.filePaths[0]) return;
      saveDir = res.filePaths[0];
      localStorage.setItem('wb_save_dir', saveDir);
      folderPathInput.value = saveDir;
      updateFileList();
    };
    
    // Добавляем кнопку активации в настройках
    const activateBtn = document.getElementById('activate-btn');
    if (activateBtn) {
      activateBtn.onclick = () => {
        settingsModal.style.display = 'none';
        showActivationModal();
      };
    }
    
    // Добавляем кнопку сброса настроек
    const resetBtn = document.getElementById('reset-settings-btn');
    if (resetBtn) {
      resetBtn.onclick = () => {
        if (confirm('Сбросить все настройки приложения?')) {
          localStorage.clear();
          saveDir = '';
          ensureSaveDir();
          folderPathInput.value = saveDir;
          updateFileList();
          alert('Настройки сброшены');
        }
      };
    }
  }
  ensureSaveDir();
  // --- Sidebar адаптив ---
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebarClose = document.getElementById('sidebar-close');
  let sidebarOverlay = document.querySelector('.sidebar-overlay');
  if (!sidebarOverlay) {
    sidebarOverlay = document.createElement('div');
    sidebarOverlay.className = 'sidebar-overlay';
    document.body.appendChild(sidebarOverlay);
  }
  function openSidebar() {
    sidebar.classList.add('open');
    sidebarOverlay.style.display = 'block';
  }
  function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarOverlay.style.display = 'none';
  }
  if (sidebarToggle) {
    sidebarToggle.onclick = openSidebar;
  }
  if (sidebarClose) {
    sidebarClose.onclick = closeSidebar;
  }
  sidebarOverlay.onclick = closeSidebar;
  // --- Закрытие Sidebar по клику на любую кнопку меню ---
  sidebar.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      closeSidebar();
    });
  });
  // Автоматически скрывать sidebar при ресайзе окна
  window.addEventListener('resize', () => {
    if (window.innerWidth > 800) {
      closeSidebar();
    }
  });
  // --- Приятная загрузка при запуске ---
  const appLoader = document.getElementById('app-loader');
  if (appLoader) {
    setTimeout(() => {
      appLoader.classList.add('hide');
      setTimeout(() => appLoader.remove(), 800);
    }, 5000);
  }
  // --- Модальное окно выбора файла ---
  const openFileModalBtn = document.getElementById('open-file-modal');
  const fileModal = document.getElementById('file-modal');
  const closeFileModal = document.getElementById('close-file-modal');
  const fileModalList = document.getElementById('file-modal-list');

  if (openFileModalBtn && fileModal && closeFileModal && fileModalList) {
    openFileModalBtn.onclick = async () => {
      await renderFileModalList();
      fileModal.style.display = 'flex';
    };
    closeFileModal.onclick = () => {
      fileModal.style.display = 'none';
    };
    fileModal.onclick = (e) => {
      if (e.target === fileModal) fileModal.style.display = 'none';
    };
  }

  async function renderFileModalList() {
    const files = await getXlsxFiles();
    if (!files.length) {
      fileModalList.innerHTML = '<div style="text-align:center;color:#888;font-size:1.1rem;">Нет файлов</div>';
      return;
    }
    let html = '';
    files.forEach(f => {
      const dateMatch = f.match(/(\d{2}\.\d{2}\.\d{4})/);
      const dateStr = dateMatch ? ` (${dateMatch[1]})` : '';
      html += `<div class="file-modal-link" data-fname="${f}" style="color:#7c3aed;cursor:pointer;text-decoration:underline;margin-bottom:4px;">${f}${dateStr}</div>`;
    });
    fileModalList.innerHTML = html;
    fileModalList.querySelectorAll('.file-modal-link').forEach(el => {
      el.onclick = (e) => {
        const fname = el.getAttribute('data-fname');
        if (fname) {
          selectTable(fname);
          fileModal.style.display = 'none';
        }
      };
    });
  }
  // --- Навигация между страницами ---
  const mainPage = document.getElementById('main-page');
  const comparePage = document.getElementById('compare-page');
  const compareBtn = document.getElementById('compare-btn');
  if (compareBtn && mainPage && comparePage) {
    compareBtn.onclick = () => {
      mainPage.style.display = 'none';
      comparePage.style.display = 'block';
      if (unitEconomicsPage) unitEconomicsPage.style.display = 'none';
      fillCompareSelects();
    };
  }
  const reviewsPage = document.getElementById('reviews-page');
  const parserBtn = document.getElementById('parser-btn');
  if (parserBtn && mainPage) {
    parserBtn.onclick = () => {
      if (comparePage) comparePage.style.display = 'none';
      if (reviewsPage) reviewsPage.style.display = 'none';
      if (unitEconomicsPage) unitEconomicsPage.style.display = 'none';
      mainPage.style.display = 'block';
    };
  }
  // Кнопка назад (если нужна)
  // ...
  // --- Сравнение ---
  async function fillCompareSelects() {
    const files = await getXlsxFiles();
    const sel1 = document.getElementById('compare-file-1');
    const sel2 = document.getElementById('compare-file-2');
    if (sel1 && sel2) {
      sel1.innerHTML = '<option value="">Выберите файл...</option>';
      sel2.innerHTML = '<option value="">Выберите файл...</option>';
      files.forEach(f => {
        const filePath = path.join(saveDir, f);
        let stat, label = f;
        try {
          stat = fs.statSync(filePath);
        } catch {}
        if (stat) {
          const dt = new Date(stat.mtime);
          const dtStr = dt.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
          label = `${f} (${dtStr})`;
        }
        const opt1 = document.createElement('option');
        opt1.value = f;
        opt1.textContent = label;
        sel1.appendChild(opt1);
        const opt2 = document.createElement('option');
        opt2.value = f;
        opt2.textContent = label;
        sel2.appendChild(opt2);
      });
    }
  }
  const runCompareBtn = document.getElementById('run-compare-btn');
  if (runCompareBtn) {
    runCompareBtn.onclick = async () => {
      const f1 = document.getElementById('compare-file-1').value;
      const f2 = document.getElementById('compare-file-2').value;
      const resultBlock = document.getElementById('compare-result-block');
      if (!f1 || !f2 || f1 === f2) {
        resultBlock.innerHTML = '<div style="color:#d32f2f;text-align:center;font-size:1.1rem;">Выберите два разных файла для сравнения</div>';
        return;
      }
      resultBlock.innerHTML = '<div class="preview-placeholder">Загрузка...</div>';
      try {
        const [data1, data2] = [readXlsxFile(f1), readXlsxFile(f2)];
        const stats1 = analyzeTable(data1);
        const stats2 = analyzeTable(data2);
        const diff = compareStats(stats1, stats2);
        resultBlock.innerHTML = renderCompareStats(stats1, stats2, diff, f1, f2);
      } catch (e) {
        resultBlock.innerHTML = '<div style="color:#d32f2f;text-align:center;font-size:1.1rem;">Ошибка анализа: ' + e + '</div>';
      }
    };
  }
  // --- Кнопки для экспорта сравнения ---
  const generateBtn = document.getElementById('generate-compare-table-btn');
  const downloadBtn = document.getElementById('download-compare-table-btn');
  if (generateBtn && downloadBtn) {
    generateBtn.onclick = async () => {
      const f1 = document.getElementById('compare-file-1').value;
      const f2 = document.getElementById('compare-file-2').value;
      if (!f1 || !f2 || f1 === f2) {
        alert('Выберите два разных файла для сравнения!');
        return;
      }
      try {
        const [data1, data2] = [readXlsxFile(f1), readXlsxFile(f2)];
        const stats1 = analyzeTable(data1);
        const stats2 = analyzeTable(data2);
        const diff = compareStats(stats1, stats2);
        // Формируем данные для экспорта
        compareTableData = buildCompareTableForExport(stats1, stats2, diff, f1, f2);
        downloadBtn.disabled = false;
        alert('Таблица сравнения сформирована! Теперь можно скачать файл.');
      } catch (e) {
        alert('Ошибка формирования таблицы: ' + e);
        compareTableData = null;
        downloadBtn.disabled = true;
      }
    };
    downloadBtn.onclick = async () => {
      if (!compareTableData) return;
      const { dialog } = remote;
      const { filePath, canceled } = await dialog.showSaveDialog({
        title: 'Сохранить таблицу сравнения',
        defaultPath: 'Сравнение.xlsx',
        filters: [{ name: 'Excel', extensions: ['xlsx'] }]
      });
      if (canceled || !filePath) return;
      try {
        const ws = XLSX.utils.aoa_to_sheet(compareTableData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Сравнение');
        XLSX.writeFile(wb, filePath, { compression: true });
        alert('Таблица успешно сохранена!');
      } catch (e) {
        alert('Ошибка сохранения файла: ' + e);
      }
    };
  }
  // Добавляем кнопку проверки обновления
  const checkUpdateBtn = document.getElementById('check-update-btn');
  if (checkUpdateBtn) {
    checkUpdateBtn.onclick = () => {
      ipcRenderer.invoke('check-for-updates');
    };
  }
  // --- Юнит-экономика ---
  function renderUnitEconomicsPage() {
    const page = document.getElementById('unit-economics-page');
    if (!page) return;
    // Модальное окно при первом запуске
    if (!localStorage.getItem('unitEconomicsModalShown')) {
      const modal = document.createElement('div');
      modal.style = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.25);z-index:2000;display:flex;align-items:center;justify-content:center;';
      modal.innerHTML = `<div style="background:#fff;padding:32px 28px;border-radius:18px;box-shadow:0 4px 24px #7c3aed33;min-width:320px;max-width:90vw;text-align:center;">
        <div style="font-size:1.2rem;font-weight:600;margin-bottom:18px;">Ваши данные не передаются третьим лицам.<br>Всё сохраняется на вашем компьютере в формате Excel (.xlsx).</div>
        <button id="unit-economics-modal-ok" style="padding:10px 32px;font-size:1.08rem;border-radius:10px;background:linear-gradient(90deg,#7c3aed 60%,#2d72d9 100%);color:#fff;border:none;cursor:pointer;font-weight:700;">Ок</button>
      </div>`;
      document.body.appendChild(modal);
      document.getElementById('unit-economics-modal-ok').onclick = () => {
        localStorage.setItem('unitEconomicsModalShown', '1');
        modal.remove();
      };
    }
    // Вкладки
    const tabs = [
      { id: 'products', label: 'Товары' },
      { id: 'fbw', label: 'WB FBW' },
      { id: 'fbs', label: 'WB FBS' }
    ];
    let activeTab = localStorage.getItem('unitEconomicsActiveTab') || 'products';
    page.innerHTML = `
      <div style="display:flex;gap:12px;margin-bottom:18px;justify-content:center;margin:auto;">
        ${tabs.map(tab => `<button class="unit-tab-btn" data-tab="${tab.id}" style="padding:10px 24px;font-size:1.08rem;border-radius:10px;border:none;cursor:pointer;font-weight:600;background:${activeTab===tab.id?'#7c3aed':'#ede9fe'};color:${activeTab===tab.id?'#fff':'#7c3aed'};">${tab.label}</button>`).join('')}
      </div>
      <div id="unit-economics-tab-content"></div>
    `;
    // Обработчик вкладок
    page.querySelectorAll('.unit-tab-btn').forEach(btn => {
      btn.onclick = () => {
        activeTab = btn.dataset.tab;
        localStorage.setItem('unitEconomicsActiveTab', activeTab);
        renderUnitEconomicsPage();
      };
    });
    // Контент вкладки
    renderUnitEconomicsTab(activeTab);
  }

  // --- Кнопка и страница ---
  const unitEconomicsBtn = document.getElementById('unit-economics-btn');
  const unitEconomicsPage = document.getElementById('unit-economics-page');
  if (unitEconomicsBtn && unitEconomicsPage) {
    unitEconomicsBtn.onclick = () => {
      document.getElementById('main-page').style.display = 'none';
      document.getElementById('compare-page').style.display = 'none';
      unitEconomicsPage.style.display = 'block';
      renderUnitEconomicsPage();
    };
  }
});

function renderActivation() {
  let actBlock = document.getElementById('activation-block');
  let indicator = document.getElementById('activation-indicator');
  
  // --- Блокировка элементов ---
  if (typeof isActivated !== 'undefined') {
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    if (searchInput) searchInput.disabled = !isActivated;
    if (searchBtn) searchBtn.disabled = !isActivated;
    // Блокировка других элементов (пример)
    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) exportBtn.disabled = !isActivated;
    // Можно добавить блокировку предпросмотра, сортировки и т.д. по аналогии
  }
  
  // --- Индикатор ---
  if (indicator) {
    if (isActivated) {
      indicator.textContent = 'Приложение активировано';
      indicator.style.background = '#43a047';
      indicator.style.display = 'block';
      indicator.style.cursor = 'default';
      indicator.onclick = null;
    } else {
      indicator.textContent = 'Требуется активация';
      indicator.style.background = '#d32f2f';
      indicator.style.display = 'block';
      indicator.style.cursor = 'pointer';
      indicator.onclick = () => {
        showActivationModal();
      };
    }
  }
  
  // Обновляем статус в модальном окне настроек
  updateActivationStatus();
  
  if (!actBlock) {
    actBlock = document.createElement('div');
    actBlock.id = 'activation-block';
    actBlock.style = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;position:fixed;top:0;left:0;width:100vw;background:#f6f8fa;z-index:9999;';
    actBlock.innerHTML = `
      <div style="background:#fff;border-radius:18px;box-shadow:0 4px 24px rgba(44,62,80,0.10);padding:36px 32px 28px 32px;min-width:340px;display:flex;flex-direction:column;align-items:center;">
        <div style="font-size:1.35rem;font-weight:600;margin-bottom:18px;color:#2d72d9;">Активация приложения</div>
        <div style="font-size:1.05rem;margin-bottom:10px;color:#333;">Введите код активации:</div>
        <input id="activation-code" type="text" style="width:100%;font-size:1.1rem;padding:10px 12px;border:1.5px solid #d0d7de;border-radius:8px;margin-bottom:18px;outline:none;transition:border 0.2s;" autofocus autocomplete="off" />
        <div id="activation-error" style="color:#d32f2f;font-size:0.98rem;margin-bottom:10px;display:none;"></div>
        <button id="activation-ok" style="background:linear-gradient(90deg,#2d72d9 60%,#6c63ff 100%);color:#fff;font-size:1.08rem;font-weight:600;border:none;border-radius:8px;padding:10px 32px;cursor:pointer;box-shadow:0 2px 8px rgba(44,62,80,0.07);transition:background 0.2s;">Активировать</button>
      </div>
    `;
    document.body.appendChild(actBlock);
    document.getElementById('activation-ok').onclick = () => {
      const code = document.getElementById('activation-code').value.trim();
      if (!code) {
        showActivationError('Введите код!');
        return;
      }
      ipcRenderer.invoke('try-activate', code).then(res => {
        if (res.ok) {
          isActivated = true;
          actBlock.style.display = 'none';
          updateActivationStatus();
          location.reload();
        } else {
          showActivationError(res.message || 'Ошибка активации');
        }
      });
    };
    document.getElementById('activation-code').onkeydown = e => {
      if(e.key==='Enter') document.getElementById('activation-ok').click();
    };
  }
  actBlock.style.display = isActivated ? 'none' : 'flex';
}

// Функция для обновления статуса активации
function updateActivationStatus() {
  const activationStatus = document.getElementById('activation-status');
  if (activationStatus) {
    if (isActivated) {
      activationStatus.textContent = '✅ Приложение активировано';
      activationStatus.style.color = '#43a047';
    } else {
      activationStatus.textContent = '❌ Требуется активация';
      activationStatus.style.color = '#d32f2f';
    }
  }
}

function showActivationError(msg) {
  const el = document.getElementById('activation-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function showActivationModal() {
  let modal = document.getElementById('activation-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'activation-modal';
    modal.style = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.25);z-index:10001;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:18px;box-shadow:0 4px 24px rgba(44,62,80,0.10);padding:36px 32px 28px 32px;min-width:340px;display:flex;flex-direction:column;align-items:center;">
        <div style="font-size:1.35rem;font-weight:600;margin-bottom:18px;color:#2d72d9;">Активация приложения</div>
        <div style="font-size:1.05rem;margin-bottom:10px;color:#333;">Введите код активации:</div>
        <input id="activation-code-modal" type="text" style="width:100%;font-size:1.1rem;padding:10px 12px;border:1.5px solid #d0d7de;border-radius:8px;margin-bottom:18px;outline:none;transition:border 0.2s;" autofocus autocomplete="off" />
        <div id="activation-error-modal" style="color:#d32f2f;font-size:0.98rem;margin-bottom:10px;display:none;"></div>
        <div style="display:flex;gap:12px;">
          <button id="activation-ok-modal" style="background:linear-gradient(90deg,#2d72d9 60%,#6c63ff 100%);color:#fff;font-size:1.08rem;font-weight:600;border:none;border-radius:8px;padding:10px 32px;cursor:pointer;box-shadow:0 2px 8px rgba(44,62,80,0.07);transition:background 0.2s;">Активировать</button>
          <button id="activation-cancel-modal" style="background:#eee;color:#333;font-size:1.08rem;font-weight:600;border:none;border-radius:8px;padding:10px 24px;cursor:pointer;">Отмена</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('activation-ok-modal').onclick = () => {
      const code = document.getElementById('activation-code-modal').value.trim();
      if (!code) {
        showActivationErrorModal('Введите код!');
        return;
      }
      ipcRenderer.invoke('try-activate', code).then(res => {
        if (res.ok) {
          isActivated = true;
          modal.remove();
          updateActivationStatus();
          renderActivation();
        } else {
          showActivationErrorModal(res.message || 'Ошибка активации');
        }
      });
    };
    document.getElementById('activation-cancel-modal').onclick = () => {
      modal.remove();
    };
    document.getElementById('activation-code-modal').onkeydown = e => {
      if(e.key==='Enter') document.getElementById('activation-ok-modal').click();
    };
  }
}
function showActivationErrorModal(msg) {
  const el = document.getElementById('activation-error-modal');
  el.textContent = msg;
  el.style.display = 'block';
}

async function checkForUpdate() {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`);
    const data = await res.json();
    if (data && data.sha) {
      const lastCommit = data.sha;
      const lastCommitStored = localStorage.getItem('lastProductionCommit');
      if (lastCommitStored !== lastCommit) {
        showUpdateButton();
        localStorage.setItem('lastProductionCommit', lastCommit);
      }
    }
  } catch (e) {
    console.log('Ошибка проверки обновлений:', e);
  }
}

function showUpdateButton() {
  if (document.getElementById('update-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'update-btn';
  btn.textContent = 'Обновить приложение';
  btn.style = 'position:fixed;top:18px;right:18px;z-index:1002;background:#2d72d9;color:#fff;font-size:1.1rem;padding:10px 22px;border:none;border-radius:8px;box-shadow:0 2px 8px #0002;cursor:pointer;';
  btn.onclick = () => {
    window.open(`https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`, '_blank');
  };
  document.body.appendChild(btn);
}

function getXlsxFiles() {
  try {
    if (!fs.existsSync(saveDir)) return [];
    return fs.readdirSync(saveDir)
      .filter(f => f.toLowerCase().endsWith('.xlsx'))
      .sort((a, b) => {
        // Сортируем по дате изменения (новые сверху)
        const statA = fs.statSync(path.join(saveDir, a));
        const statB = fs.statSync(path.join(saveDir, b));
        return statB.mtime.getTime() - statA.mtime.getTime();
      });
  } catch (e) {
    console.error('Ошибка чтения директории:', e);
    return [];
  }
}

function renderPreviewTable() {
  const summaryBtn = document.getElementById('toggle-summary');
  if (!previewData.length) {
    previewTable.innerHTML = '<div class="preview-placeholder">Выберите таблицу</div>';
    if (summaryBtn) summaryBtn.disabled = true;
    return;
  }
  if (summaryBtn) summaryBtn.disabled = false;
  
  // Используем DocumentFragment для ускорения рендера
  const frag = document.createDocumentFragment();
  const table = document.createElement('table');
  
  // Заголовки (без 'Подробнее')
  const trHead = document.createElement('tr');
  previewHeaders.forEach((cell, j) => {
    let th = document.createElement('th');
    th.textContent = cell;
    if ([
      'Цена',
      'Рейтинг', 
      'Кол-во отзывов',
      'Объём продаж в мес'
    ].includes(cell)) {
      th.className = 'sortable';
      th.setAttribute('data-col', j);
      if (sortState.col === j) {
        th.innerHTML += sortState.dir === 1 ? ' <span style="font-size:14px">▲</span>' : ' <span style="font-size:14px">▼</span>';
      }
    }
    trHead.appendChild(th);
  });
  table.appendChild(trHead);
  
  // Данные (без кнопки 'Подробнее') - оптимизированный рендер всех записей
  const tbody = document.createElement('tbody');
  
  // Используем requestAnimationFrame для разбивки рендера на чанки
  const chunkSize = 100;
  const totalRows = previewData.length;
  let currentRow = 0;
  
  function renderChunk() {
    const endRow = Math.min(currentRow + chunkSize, totalRows);
    
    for (let i = currentRow; i < endRow; i++) {
      const row = previewData[i];
      const tr = document.createElement('tr');
      
      row.forEach((cell, j) => {
        let td = document.createElement('td');
        
        // Оптимизация для ссылок
        if (previewHeaders[j] === 'Ссылка на товар' || previewHeaders[j] === 'Ссылка на магазин') {
          if (cell && typeof cell === 'string' && cell.startsWith('http')) {
            td.innerHTML = '<a href="#" class="link-cell">Ссылка</a>';
          } else {
            td.textContent = cell ?? '';
          }
        } else {
          td.textContent = cell ?? '';
        }
        
        // Добавляем title только для длинных значений
        if (cell && cell.toString().length > 30) {
          td.title = cell.toString();
        }
        
        tr.appendChild(td);
      });
      
      tbody.appendChild(tr);
    }
    
    currentRow = endRow;
    
    // Если есть еще данные для рендера, продолжаем в следующем кадре
    if (currentRow < totalRows) {
      requestAnimationFrame(renderChunk);
    } else {
      // Рендер завершен, добавляем таблицу в DOM
      table.appendChild(tbody);
      frag.appendChild(table);
      
      // Быстрая замена содержимого
      previewTable.innerHTML = '';
      previewTable.appendChild(frag);
      
      // Дебаунсинг для обработчиков сортировки
      let sortTimeout;
      document.querySelectorAll('.sortable').forEach(th => {
        th.onclick = () => {
          clearTimeout(sortTimeout);
          sortTimeout = setTimeout(() => {
            const col = Number(th.getAttribute('data-col'));
            if (sortState.col === col) sortState.dir *= -1;
            else { sortState.col = col; sortState.dir = 1; }
            sortPreviewData(col, sortState.dir);
            renderPreviewTable();
          }, 100);
        };
      });
      
      // Глобальный обработчик для ссылок
      previewTable.addEventListener('click', (e) => {
        if (e.target.classList.contains('link-cell')) {
          e.preventDefault();
          const row = e.target.closest('tr');
          const rowIndex = Array.from(row.parentNode.children).indexOf(row); // исправлено: убрал -1
          const linkIndex = previewHeaders.findIndex(h => h === 'Ссылка на товар' || h === 'Ссылка на магазин');
          if (rowIndex >= 0 && linkIndex >= 0 && previewData[rowIndex]) {
            const url = previewData[rowIndex][linkIndex];
            if (url && typeof url === 'string' && url.startsWith('http')) {
              shell.openExternal(url);
            }
          }
        }
      });
    }
  }
  
  // Начинаем рендер
  requestAnimationFrame(renderChunk);
}

function sortPreviewData(col, dir) {
  // Стабильная сортировка с обработкой пустых и нечисловых значений
  previewData = previewData
    .map((row, idx) => ({ row, idx }))
    .sort((a, b) => {
      let av = a.row[col], bv = b.row[col];
      // Преобразуем к числу если возможно
      av = typeof av === 'string' && av.replace ? Number(av.replace(/[^\d.,-]/g, '').replace(',', '.')) : av;
      bv = typeof bv === 'string' && bv.replace ? Number(bv.replace(/[^\d.,-]/g, '').replace(',', '.')) : bv;
      // Пустые значения всегда внизу
      if ((av === null || av === undefined || isNaN(av)) && (bv === null || bv === undefined || isNaN(bv))) return a.idx - b.idx;
      if (av === null || av === undefined || isNaN(av)) return 1;
      if (bv === null || bv === undefined || isNaN(bv)) return -1;
      if (av === bv) return a.idx - b.idx;
      return dir * (av - bv);
    })
    .map(obj => obj.row);
}

function previewFile(filename) {
  previewTitle.textContent = 'Просмотр ' + filename;
  
  try {
    const filePath = path.join(saveDir, filename);
    const wb = XLSX.readFile(filePath, { 
      cellDates: true, 
      cellNF: false, 
      cellText: false 
    });
    const ws = wb.Sheets[wb.SheetNames[0]];
    
    // Оптимизированное чтение данных
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    const data = [];
    
    // Читаем только видимые строки (пропускаем пустые)
    for (let R = range.s.r; R <= range.e.r; R++) {
      const row = [];
      let hasData = false;
      
      for (let C = range.s.c; C <= range.e.c; C++) {
        const cellAddress = XLSX.utils.encode_cell({r: R, c: C});
        const cell = ws[cellAddress];
        
        if (cell) {
          row.push(cell.v);
          hasData = true;
        } else {
          row.push('');
        }
      }
      
      if (hasData || R === range.s.r) { // Всегда включаем заголовок
        data.push(row);
      }
    }
    
    if (data.length < 2) {
      previewTable.innerHTML = '<div style="color:red">Файл пуст или поврежден</div>';
      updateSummary([]);
      return;
    }
    
    previewHeaders = data[0];
    previewData = data.slice(1);
    sortState = { col: null, dir: 1 };
    
    // Быстрый рендер таблицы
    renderPreviewTable();
    
    // Формируем массив products для сводки (используем все данные)
    const products = previewData.map(row => {
      const obj = {};
      previewHeaders.forEach((h, i) => {
        obj[h] = row[i];
      });
      return {
        price: Number(obj['Цена']?.toString().replace(/[^\d.,-]/g, '').replace(',', '.')) || 0,
        rating: Number(obj['Рейтинг']?.toString().replace(/[^\d.,-]/g, '').replace(',', '.')) || 0,
        brand: obj['Бренд'] || '',
        shop: obj['Магазин'] || '',
        name: obj['Наименование'] || obj['Название'] || '',
        reviews: Number(obj['Кол-во отзывов']?.toString().replace(/[^\d]/g, '')) || 0,
        link: obj['Ссылка на товар'] || '',
      };
    });
    
    updateSummary(products);
    
  } catch (e) {
    console.error('Ошибка чтения файла:', e);
    previewTable.innerHTML = '<div style="color:red">Ошибка чтения файла</div>';
    updateSummary([]);
  }
}

let parseStartTime = null;
let parseTimerInterval = null;

searchBtn.onclick = async () => {
  const query = searchInput.value.trim();
  searchBtn.disabled = true;
  searchInput.disabled = true;
  loadingOverlay.style.display = 'flex';
  // Динамический таймер ожидания
  const loadingText = document.querySelector('.loading-text');
  let avgTime = Number(localStorage.getItem('avgParseTime')) || 20; // по умолчанию 20 сек
  let timeLeft = avgTime;
  parseStartTime = Date.now();
  if (loadingText) {
    loadingText.textContent = `Осталось примерно ${Math.ceil(timeLeft)} сек.`;
  }
  if (parseTimerInterval) clearInterval(parseTimerInterval);
  parseTimerInterval = setInterval(() => {
    timeLeft = avgTime - Math.round((Date.now() - parseStartTime) / 1000);
    if (timeLeft > 0) {
      loadingText.textContent = `Осталось примерно ${timeLeft} сек.`;
    } else {
      loadingText.textContent = `Формируем таблицу`;
    }
  }, 1000);
  try {
    await ipcRenderer.invoke('run-parser', query, saveDir);
    if (parseTimerInterval) clearInterval(parseTimerInterval);
    if (loadingText) loadingText.textContent = 'Формируем таблицу...';
    await updateFileList(); // Дожидаемся полной генерации таблицы
  } catch (e) {
    alert('Ошибка парсинга: ' + e);
  }
  searchBtn.disabled = false;
  searchInput.disabled = false;
  searchBtn.textContent = 'Искать';
  // Сохраняем новое среднее время
  const elapsed = Math.round((Date.now() - parseStartTime) / 1000);
  let prev = Number(localStorage.getItem('avgParseTime')) || 20;
  let newAvg = Math.round((prev * 2 + elapsed) / 3);
  localStorage.setItem('avgParseTime', newAvg);
  // Скрываем overlay только после генерации таблицы
  loadingOverlay.style.display = 'none';
};

// При старте приложения тоже делаем кнопку неактивной
window.onload = () => {
  updateFileList();
  previewTable.innerHTML = '<div class="preview-placeholder">Выберите таблицу</div>';
  const summaryBtn = document.getElementById('toggle-summary');
  if (summaryBtn) summaryBtn.disabled = true;
};

function calculateSummary(products) {
  if (!products || !products.length) return {};
  const prices = products.map(p => p.price).filter(Boolean).sort((a, b) => a - b);
  const ratings = products.map(p => p.rating).filter(Boolean);
  // Группируем по магазину
  const shops = {};
  products.forEach(p => {
    const shop = p.shop || p['shop'] || p['Магазин'] || '';
    if (!shop) return;
    if (!shops[shop]) shops[shop] = { sumRating: 0, count: 0 };
    shops[shop].sumRating += Number(p.rating) || 0;
    shops[shop].count++;
  });
  let topShop = '-';
  if (Object.keys(shops).length) {
    // Сначала ищем по суммарному рейтингу, если у всех рейтинг 0 — по количеству товаров
    const sorted = Object.entries(shops).sort((a, b) => {
      if (b[1].sumRating !== a[1].sumRating) return b[1].sumRating - a[1].sumRating;
      return b[1].count - a[1].count;
    });
    topShop = sorted[0][0];
  }
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const medianPrice = prices.length % 2 === 0 ?
    (prices[prices.length/2-1] + prices[prices.length/2]) / 2 :
    prices[Math.floor(prices.length/2)];
  const avgRating = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length) : 0;
  // Топ-5 товаров по количеству отзывов и рейтингу
  const topProducts = products
    .filter(p => p.name && p.reviews)
    .sort((a, b) => {
      if (b.reviews !== a.reviews) return b.reviews - a.reviews;
      return b.rating - a.rating;
    })
    .slice(0, 5);
  // Топ-5 наименований (по количеству товаров, отзывам, рейтингу)
  const nameGroups = {};
  products.forEach(p => {
    if (!p.name) return;
    const key = p.name.trim().toLowerCase();
    if (!nameGroups[key]) nameGroups[key] = { count: 0, sumReviews: 0, sumRating: 0, links: [] };
    nameGroups[key].count++;
    nameGroups[key].sumReviews += p.reviews || 0;
    nameGroups[key].sumRating += p.rating || 0;
    if (p.link) nameGroups[key].links.push(p.link);
  });
  const topNames = Object.entries(nameGroups)
    .map(([name, v]) => ({
      name,
      count: v.count,
      sumReviews: v.sumReviews,
      avgRating: v.count ? v.sumRating / v.count : 0,
      link: v.links[0] || ''
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (b.sumReviews !== a.sumReviews) return b.sumReviews - a.sumReviews;
      return b.avgRating - a.avgRating;
    })
    .slice(0, 5);
  return {
    count: products.length,
    avgPrice,
    medianPrice,
    minPrice: prices[0],
    maxPrice: prices[prices.length-1],
    avgRating,
    minRating: Math.min(...ratings),
    maxRating: Math.max(...ratings),
    topShop,
    topProducts,
    topNames
  };
}

function renderSummary(summary) {
  const el = document.getElementById('summary');
  if (!el) return;
  el.innerHTML = `
    <div class="summary-stats">
      <div class="summary-item"><span class="summary-icon">📦</span><span class="summary-value">${summary.count || 0}</span><span class="summary-label">Товаров найдено</span></div>
      <div class="summary-item"><span class="summary-icon">💰</span><span class="summary-value">${summary.avgPrice ? summary.avgPrice.toLocaleString('ru-RU', {maximumFractionDigits:0}) : '-'}</span><span class="summary-label">Средняя цена</span></div>
      <div class="summary-item"><span class="summary-icon">📊</span><span class="summary-value">${summary.medianPrice ? summary.medianPrice.toLocaleString('ru-RU', {maximumFractionDigits:0}) : '-'}</span><span class="summary-label">Медиана цены</span></div>
      <div class="summary-item"><span class="summary-icon">⬇️</span><span class="summary-value">${summary.minPrice ? summary.minPrice.toLocaleString('ru-RU', {maximumFractionDigits:0}) : '-'}</span><span class="summary-label">Мин. цена</span></div>
      <div class="summary-item"><span class="summary-icon">⬆️</span><span class="summary-value">${summary.maxPrice ? summary.maxPrice.toLocaleString('ru-RU', {maximumFractionDigits:0}) : '-'}</span><span class="summary-label">Макс. цена</span></div>
      <div class="summary-item"><span class="summary-icon">⭐</span><span class="summary-value">${summary.avgRating ? summary.avgRating.toFixed(2) : '-'}</span><span class="summary-label">Средний рейтинг</span></div>
      <div class="summary-item"><span class="summary-icon">🏪</span><span class="summary-value">${summary.topShop || '-'}</span><span class="summary-label">Топ магазин</span></div>
    </div>
    <div class="summary-top-blocks">
      <div class="summary-top-list">
        <span class="summary-label" style="font-weight:600;font-size:1rem;">Топ 5 самых продаваемых товаров</span>
        <ol style="margin-top:6px;">
          ${summary.topProducts && summary.topProducts.length ? summary.topProducts.map((p, i) => `
            <li>
              <span style="font-weight:600;">${p.name ? p.name : '-'}</span>
              <span style="color:#2d72d9;">${p.price ? ' · ' + p.price.toLocaleString('ru-RU') + '₽' : ''}</span>
              <span style="color:#f5b50a;">${p.rating ? ' · ' + p.rating.toFixed(2) + '★' : ''}</span>
              <span style="color:#888;">${p.reviews ? ' · ' + p.reviews + ' отзывов' : ''}</span>
              ${p.link ? `<a href="#" onclick="window.openLink('${p.link}')" style="color:#6c63ff;text-decoration:underline;margin-left:6px;">Ссылка</a>` : ''}
            </li>
          `).join('') : '<li style="color:#888">Нет данных</li>'}
        </ol>
      </div>
      <div class="summary-top-list">
        <span class="summary-label" style="font-weight:600;font-size:1rem;">Топ 5 самых популярных наименований</span>
        <ol style="margin-top:6px;">
          ${summary.topNames && summary.topNames.length ? summary.topNames.map((n, i) => `
            <li>
              <span style="font-weight:600;">${n.name}</span>
              <span style="color:#2d72d9;"> · ${n.count} товаров</span>
              <span style="color:#f5b50a;">${n.avgRating ? ' · ' + n.avgRating.toFixed(2) + '★' : ''}</span>
              <span style="color:#888;">${n.sumReviews ? ' · ' + n.sumReviews + ' отзывов' : ''}</span>
            </li>
          `).join('') : '<li style="color:#888">Нет данных</li>'}
        </ol>
      </div>
    </div>
  `;
}

// Вызов после загрузки/обновления данных:
function updateSummary(products) {
  const summary = calculateSummary(products);
  renderSummary(summary);
}

// Удаляю функцию showProductDetails и все обработчики, связанные с кнопкой 'Подробнее'. 

function readXlsxFile(filename) {
  const filePath = require('path').join(saveDir, filename);
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const headers = data[0];
  const rows = data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
  return rows;
}

function analyzeTable(rows) {
  // Определяем реальные названия колонок для цены
  const priceKey = rows[0] && ('Цена (текущая)' in rows[0]) ? 'Цена (текущая)' :
                   ('Цена' in rows[0]) ? 'Цена' :
                   Object.keys(rows[0] || {}).find(k => k.toLowerCase().includes('цен')) || '';
  const oldPriceKey = rows[0] && ('Старая цена (зачеркнутая)' in rows[0]) ? 'Старая цена (зачеркнутая)' :
                      Object.keys(rows[0] || {}).find(k => k.toLowerCase().includes('стар') || k.toLowerCase().includes('зачерк')) || '';
  const walletPriceKey = rows[0] && ('Цена по WB-кошельку' in rows[0]) ? 'Цена по WB-кошельку' :
                         Object.keys(rows[0] || {}).find(k => k.toLowerCase().includes('кошел')) || '';
  const reviewsKey = rows[0] && ('Кол-во отзывов' in rows[0]) ? 'Кол-во отзывов' :
                     Object.keys(rows[0] || {}).find(k => k.toLowerCase().includes('отзыв')) || '';
  const ratingKey = rows[0] && ('Рейтинг' in rows[0]) ? 'Рейтинг' :
                    Object.keys(rows[0] || {}).find(k => k.toLowerCase().includes('рейтинг')) || '';
  const brandKey = rows[0] && ('Бренд' in rows[0]) ? 'Бренд' :
                   Object.keys(rows[0] || {}).find(k => k.toLowerCase().includes('бренд')) || '';
  const shopKey = rows[0] && ('Магазин' in rows[0]) ? 'Магазин' :
                  Object.keys(rows[0] || {}).find(k => k.toLowerCase().includes('магазин')) || '';
  const artikulKey = rows[0] && ('Артикул WB' in rows[0]) ? 'Артикул WB' :
                     Object.keys(rows[0] || {}).find(k => k.toLowerCase().includes('артикул')) || '';

  const prices = priceKey ? rows.map(r => Number(r[priceKey])).filter(v => !isNaN(v)) : [];
  const oldPrices = oldPriceKey ? rows.map(r => Number(r[oldPriceKey])).filter(Boolean) : [];
  const walletPrices = walletPriceKey ? rows.map(r => Number(r[walletPriceKey])).filter(Boolean) : [];
  const reviews = reviewsKey ? rows.map(r => Number(r[reviewsKey])).filter(Boolean) : [];
  const ratings = ratingKey ? rows.map(r => Number(r[ratingKey])).filter(Boolean) : [];
  const brands = brandKey ? rows.map(r => r[brandKey]).filter(Boolean) : [];
  const shops = shopKey ? rows.map(r => r[shopKey]).filter(Boolean) : [];
  const artikuls = artikulKey ? rows.map(r => r[artikulKey]) : [];

  // Медиана
  const median = arr => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  // Топ-бренд/магазин
  const top = arr => {
    const map = {};
    arr.forEach(x => { if (x) map[x] = (map[x] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';
  };
  return {
    count: rows.length,
    maxPrice: prices.length ? Math.max(...prices) : 0,
    minPrice: prices.length ? Math.min(...prices) : 0,
    avgPrice: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0,
    medianPrice: median(prices),
    totalReviews: reviews.reduce((a, b) => a + b, 0),
    avgReviews: reviews.length ? reviews.reduce((a, b) => a + b, 0) / reviews.length : 0,
    totalRatings: ratings.reduce((a, b) => a + b, 0),
    avgRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0,
    topBrand: top(brands),
    topShop: top(shops),
    artikuls,
    brands,
    shops,
    reviews,
    prices
  };
}

function compareStats(s1, s2) {
  // Рост/падение цен, отзывов, рейтинга, новые/исчезнувшие товары
  const percent = (a, b) => b === 0 ? 0 : ((a - b) / b) * 100;
  const set1 = new Set(s1.artikuls);
  const set2 = new Set(s2.artikuls);
  const newItems = [...set2].filter(x => !set1.has(x));
  const goneItems = [...set1].filter(x => !set2.has(x));
  return {
    priceGrowth: percent(s2.avgPrice, s1.avgPrice),
    maxPriceGrowth: percent(s2.maxPrice, s1.maxPrice),
    minPriceGrowth: percent(s2.minPrice, s1.minPrice),
    reviewsGrowth: percent(s2.totalReviews, s1.totalReviews),
    ratingGrowth: percent(s2.avgRating, s1.avgRating),
    countGrowth: percent(s2.count, s1.count),
    newItems,
    goneItems
  };
}

function renderCompareStats(s1, s2, diff, f1, f2) {
  function fmt(n, d=0) { return n ? n.toLocaleString('ru-RU', {maximumFractionDigits:d}) : '-'; }
  function pct(n) { return (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  return `
    <div style="display:flex;gap:32px;justify-content:center;align-items:flex-start;">
      <div style="flex:1;min-width:320px;">
        <div style="font-weight:600;margin-bottom:8px;color:#7c3aed;">${f1}</div>
        <ul style="font-size:1.08rem;line-height:1.7;">
          <li>Всего товаров: <b>${fmt(s1.count)}</b></li>
          <li>Средняя цена: <b>${fmt(s1.avgPrice)}</b></li>
          <li>Медиана цены: <b>${fmt(s1.medianPrice)}</b></li>
          <li>Максимальная цена: <b>${fmt(s1.maxPrice)}</b></li>
          <li>Минимальная цена: <b>${fmt(s1.minPrice)}</b></li>
          <li>Всего отзывов: <b>${fmt(s1.totalReviews)}</b></li>
          <li>Средний рейтинг: <b>${fmt(s1.avgRating,2)}</b></li>
          <li>Топ бренд: <b>${s1.topBrand}</b></li>
          <li>Топ магазин: <b>${s1.topShop}</b></li>
        </ul>
      </div>
      <div style="flex:1;min-width:320px;">
        <div style="font-weight:600;margin-bottom:8px;color:#7c3aed;">${f2}</div>
        <ul style="font-size:1.08rem;line-height:1.7;">
          <li>Всего товаров: <b>${fmt(s2.count)}</b> (${pct(diff.countGrowth)})</li>
          <li>Средняя цена: <b>${fmt(s2.avgPrice)}</b> (${pct(diff.priceGrowth)})</li>
          <li>Медиана цены: <b>${fmt(s2.medianPrice)}</b></li>
          <li>Максимальная цена: <b>${fmt(s2.maxPrice)}</b> (${pct(diff.maxPriceGrowth)})</li>
          <li>Минимальная цена: <b>${fmt(s2.minPrice)}</b> (${pct(diff.minPriceGrowth)})</li>
          <li>Всего отзывов: <b>${fmt(s2.totalReviews)}</b> (${pct(diff.reviewsGrowth)})</li>
          <li>Средний рейтинг: <b>${fmt(s2.avgRating,2)}</b> (${pct(diff.ratingGrowth)})</li>
          <li>Топ бренд: <b>${s2.topBrand}</b></li>
          <li>Топ магазин: <b>${s2.topShop}</b></li>
        </ul>
      </div>
    </div>
    <div style="margin-top:32px;display:flex;gap:32px;justify-content:center;align-items:flex-start;">
      <div style="flex:1;min-width:320px;">
        <div style="font-weight:600;margin-bottom:8px;color:#7c3aed;">Новые товары во втором файле (${diff.newItems.length}):</div>
        <div style="font-size:0.98rem;max-height:180px;overflow:auto;">${diff.newItems.map(x => `<div>${x}</div>`).join('') || '-'}</div>
      </div>
      <div style="flex:1;min-width:320px;">
        <div style="font-weight:600;margin-bottom:8px;color:#7c3aed;">Исчезнувшие товары или нет в наличии (${diff.goneItems.length}):</div>
        <div style="font-size:0.98rem;max-height:180px;overflow:auto;">${diff.goneItems.map(x => `<div>${x}</div>`).join('') || '-'}</div>
      </div>
    </div>
  `;
} 

// --- Формирование данных для экспорта в Excel ---
function buildCompareTableForExport(s1, s2, diff, f1, f2) {
  // Формируем массив массивов для aoa_to_sheet
  return [
    ['Показатель', f1, f2, 'Изменение'],
    ['Всего товаров', s1.count, s2.count, formatPercent(diff.countGrowth)],
    ['Средняя цена', s1.avgPrice, s2.avgPrice, formatPercent(diff.priceGrowth)],
    ['Медиана цены', s1.medianPrice, s2.medianPrice, ''],
    ['Максимальная цена', s1.maxPrice, s2.maxPrice, formatPercent(diff.maxPriceGrowth)],
    ['Минимальная цена', s1.minPrice, s2.minPrice, formatPercent(diff.minPriceGrowth)],
    ['Всего отзывов', s1.totalReviews, s2.totalReviews, formatPercent(diff.reviewsGrowth)],
    ['Средний рейтинг', s1.avgRating, s2.avgRating, formatPercent(diff.ratingGrowth)],
    ['Топ бренд', s1.topBrand, s2.topBrand, ''],
    ['Топ магазин', s1.topShop, s2.topShop, ''],
    ['Новые товары во втором файле', '', '', diff.newItems.join(', ')],
    ['Исчезнувшие товары', '', '', diff.goneItems.join(', ')]
  ];
}
function formatPercent(val) {
  if (typeof val !== 'number' || isNaN(val)) return '';
  return (val > 0 ? '+' : '') + val.toFixed(2) + '%';
} 

function getDefaultTable(tab) {
  if (tab === 'products') {
    return [
      ['Группа товаров', 'Артикул', 'Товар', 'Закупка', 'Посредник %', 'Брак %', 'Доставка', 'Маркировка', 'Хранение', 'Упаковка', 'Себест итого', 'Остаток, шт', 'Итого по остатку'],
      ['', '', '', '', '', '', '', '', '', '', '', '', '']
    ];
  }
  if (tab === 'fbw') {
    return [
      ['Товар', 'Цена', 'Скидка %', 'СПП %', 'Комиссия %', 'Себест.', 'Платная приёмка', 'Продвижение %', 'Фактическая цена', 'Комиссия', 'Выручка', 'Налоги', 'Продвижение', 'Прибыль', 'ROI', 'Маржинальность'],
      ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
    ];
  }
  if (tab === 'fbs') {
    return [
      ['Товар', 'Цена', 'Скидка %', 'СПП %', 'Комиссия %', 'Себест.', 'Платная приёмка', 'Продвижение %', 'Выкуп %', 'Фактическая цена', 'Комиссия', 'Выручка', 'Налоги', 'Продвижение', 'Прибыль', 'ROI', 'Маржинальность'],
      ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
    ];
  }
  return [['']];
}

function renderUnitEconomicsTab(tab) {
  const content = document.getElementById('unit-economics-tab-content');
  if (!content) return;
  let data = getDefaultTable(tab);
  let localKey = 'unitEconomicsData_' + tab;
  let localData = localStorage.getItem(localKey);
  let filePath = localStorage.getItem('unitEconomicsXlsxPath');
  let showAttachBtn = false;
  if (localData) {
    try {
      data = JSON.parse(localData);
      for (let i = 1; i < data.length; ++i) {
        while (data[i].length < data[0].length) data[i].push('');
      }
    } catch (e) {}
  } else if (filePath) {
    try {
      const wb = XLSX.readFile(filePath);
      const ws = wb.Sheets[tabToSheet(tab)];
      if (ws) {
        data = XLSX.utils.sheet_to_json(ws, { header: 1 });
        for (let i = 1; i < data.length; ++i) {
          while (data[i].length < data[0].length) data[i].push('');
        }
      }
    } catch (e) {}
  } else {
    showAttachBtn = true;
  }
  content.innerHTML =
    (showAttachBtn ? `<div style='text-align:center;margin-bottom:18px;'><button id='unit-economics-attach-file' style='padding:10px 24px;font-size:1.08rem;border-radius:10px;background:linear-gradient(90deg,#7c3aed 60%,#2d72d9 100%);color:#fff;border:none;cursor:pointer;font-weight:700;box-shadow:0 2px 8px #7c3aed11;'>Добавить существующий файл</button></div>` : '') +
    `<div style="overflow-x:auto;margin-top:32px;"><table id="unit-economics-table" style="margin:0 auto;border-collapse:separate;border-spacing:0;min-width:900px;max-width:100%;box-shadow:0 2px 16px #7c3aed22,0 1.5px 8px #ede9fe;border-radius:12px;overflow:hidden;background:#fff;width:auto;">
    <thead><tr><th style='background:#fff;border:none;'></th>${data[0].map((h, idx) => `<th style='padding:8px 10px;background:#7c3aed;color:#fff;font-size:1.01rem;font-weight:700;${idx===0?'border-top-left-radius:12px;':''}${idx===data[0].length-1?'border-top-right-radius:12px;':''}'>${h}</th>`).join('')}</tr></thead>
    <tbody>
      ${data.slice(1).map((row, i) => `<tr style='background:${i%2===0?'#f3f0fa':'#fff'};'><td style='background:#fff;text-align:center;vertical-align:middle;'><button class='unit-economics-del-row' data-row='${i+1}' style='background:none;border:none;color:#d32f2f;font-size:1.2rem;cursor:pointer;outline:none;' title='Удалить строку'>&times;</button></td>${row.map((cell, j) => `<td style='padding:2px 4px;border-bottom:1px solid #eee;${j===0?'border-left:1.5px solid #ede9fe;border-bottom-left-radius:10px;':''}${j===row.length-1?'border-right:1.5px solid #ede9fe;border-bottom-right-radius:10px;':''}'><input type='text' data-row='${i+1}' data-col='${j}' value='${cell ?? ''}' style='width:100%;min-width:60px;max-width:180px;padding:2px 4px;border-radius:6px;border:1px solid #ccc;font-size:0.97rem;transition:border 0.18s,box-shadow 0.18s;outline:none;background:#fafaff;box-sizing:border-box;' onfocus="this.style.borderColor='#7c3aed';this.style.boxShadow='0 0 0 2px #a78bfa33';" onblur="this.style.borderColor='#ccc';this.style.boxShadow='none';" ${j===data[0].length-1?'readonly':''}></td>`).join('')}</tr>`).join('')}
    </tbody>
  </table></div>
  <div style='margin-top:18px;text-align:center;'>
    <button id='unit-economics-add-row' style='padding:10px 24px;font-size:1.08rem;border-radius:10px;background:linear-gradient(90deg,#a78bfa 60%,#7c3aed 100%);color:#fff;border:none;cursor:pointer;font-weight:700;margin-right:18px;box-shadow:0 2px 8px #7c3aed11;'>Добавить строку</button>
    <button id='unit-economics-save-btn' style='padding:12px 32px;font-size:1.08rem;border-radius:10px;background:linear-gradient(90deg,#7c3aed 60%,#2d72d9 100%);color:#fff;border:none;cursor:pointer;font-weight:700;box-shadow:0 2px 8px #7c3aed11;'>Сохранить в xlsx...</button>
  </div>`;
  if (showAttachBtn) {
    document.getElementById('unit-economics-attach-file').onclick = async () => {
      const { dialog } = remote;
      const res = await dialog.showOpenDialog({
        title: 'Выберите xlsx-файл',
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
        properties: ['openFile']
      });
      if (res.canceled || !res.filePaths.length) return;
      localStorage.setItem('unitEconomicsXlsxPath', res.filePaths[0]);
      renderUnitEconomicsTab(tab);
    };
  }
  content.querySelectorAll('input[type=text]').forEach(input => {
    input.oninput = () => {
      const row = Number(input.dataset.row);
      const col = Number(input.dataset.col);
      data[row][col] = input.value;
      if (tab === 'products') {
        recalcProductsRow(data, row);
        const table = document.getElementById('unit-economics-table');
        if (table && table.rows[row]) {
          // Обновляем значения в input'ах для "Себест итого" и "Итого по остатку"
          const val1 = data[row][10] ?? '';
          const val2 = data[row][12] ?? '';
          table.rows[row].cells[11].querySelector('input').value = val1;
          table.rows[row].cells[12].querySelector('input').value = val2;
        }
      }
      localStorage.setItem(localKey, JSON.stringify(data));
    };
  });
  content.querySelectorAll('.unit-economics-del-row').forEach(btn => {
    btn.onclick = () => {
      const rowIdx = Number(btn.dataset.row);
      data.splice(rowIdx, 1);
      localStorage.setItem(localKey, JSON.stringify(data));
      renderUnitEconomicsTab(tab);
    };
  });
  document.getElementById('unit-economics-add-row').onclick = () => {
    data.push(new Array(data[0].length).fill(''));
    localStorage.setItem(localKey, JSON.stringify(data));
    renderUnitEconomicsTab(tab);
  };
  document.getElementById('unit-economics-save-btn').onclick = async () => {
    const { dialog } = remote;
    const res = await dialog.showSaveDialog({
      title: 'Сохранить как xlsx',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      defaultPath: 'unit-economics.xlsx'
    });
    if (res.canceled || !res.filePath) return;
    saveUnitEconomicsTable(tab, data, res.filePath);
    localStorage.setItem('unitEconomicsXlsxPath', res.filePath);
    alert('Данные успешно сохранены!');
  };
}

function tabToSheet(tab) {
  switch (tab) {
    case 'products': return 'Товары';
    case 'fbw': return 'WB FBW';
    case 'fbs': return 'WB FBS';
    default: return 'Товары';
  }
}

function saveUnitEconomicsTable(tab, data, filePath) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, tabToSheet(tab));
  XLSX.writeFile(wb, filePath);
}

function recalcProductsRow(data, rowIndex) {
  const row = data[rowIndex];
  // Индексы для таблицы 'Товары'
  // ['Группа товаров', 'Артикул', 'Товар', 'Закупка', 'Посредник %', 'Брак %', 'Доставка', 'Маркировка', 'Хранение', 'Упаковка', 'Себест итого', 'Остаток, шт', 'Итого по остатку']
  const zakup = Number(row[3]?.toString().replace(/[^\d.,-]/g, '').replace(',', '.')) || 0;
  const posredPerc = Number(row[4]?.toString().replace(/[^\d.,-]/g, '').replace(',', '.')) || 0;
  const brakPerc = Number(row[5]?.toString().replace(/[^\d.,-]/g, '').replace(',', '.')) || 0;
  const dostavka = Number(row[6]?.toString().replace(/[^\d.,-]/g, '').replace(',', '.')) || 0;
  const markirovka = Number(row[7]?.toString().replace(/[^\d.,-]/g, '').replace(',', '.')) || 0;
  const khranenie = Number(row[8]?.toString().replace(/[^\d.,-]/g, '').replace(',', '.')) || 0;
  const upakovka = Number(row[9]?.toString().replace(/[^\d.,-]/g, '').replace(',', '.')) || 0;
  const ostatok = Number(row[11]?.toString().replace(/[^\d.,-]/g, '').replace(',', '.')) || 0;

  // Формула себестоимости
  const sebestoim = zakup + (zakup * posredPerc / 100) + (zakup * brakPerc / 100) + dostavka + markirovka + khranenie + upakovka;
  // Итог по остатку
  const itogoOstatok = sebestoim * ostatok;

  // Обновляем значения в строке
  row[10] = sebestoim ? sebestoim.toLocaleString('ru-RU', {maximumFractionDigits:2}) : '';
  row[12] = itogoOstatok ? itogoOstatok.toLocaleString('ru-RU', {maximumFractionDigits:2}) : '';

  // Остальной код (оставляем для совместимости, если потребуется)
  // ... существующая логика по name и т.д. ...
} 