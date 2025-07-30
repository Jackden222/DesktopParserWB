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

// --- Система категорий ---
let selectedCategory = null;
let pendingSearchQuery = null;

// Функции для работы с категориями
function getCategories() {
  const categories = localStorage.getItem('wb_parser_categories');
  return categories ? JSON.parse(categories) : [];
}

function saveCategories(categories) {
  localStorage.setItem('wb_parser_categories', JSON.stringify(categories));
}

function addCategory(name) {
  const categories = getCategories();
  if (!categories.includes(name)) {
    categories.push(name);
    saveCategories(categories);
  }
  return categories;
}

function getFileCategory(filename) {
  const fileInfo = localStorage.getItem(`file_category_${filename}`);
  return fileInfo ? JSON.parse(fileInfo).category : 'Без категории';
}

function saveFileCategory(filename, category) {
  const fileInfo = {
    category: category,
    timestamp: Date.now()
  };
  localStorage.setItem(`file_category_${filename}`, JSON.stringify(fileInfo));
}

// Функции для работы с состоянием свернутых категорий
function getCollapsedCategories() {
  const collapsed = localStorage.getItem('wb_collapsed_categories');
  return collapsed ? JSON.parse(collapsed) : [];
}

function saveCollapsedCategories(collapsed) {
  localStorage.setItem('wb_collapsed_categories', JSON.stringify(collapsed));
}

function toggleCategoryCollapse(category) {
  const collapsed = getCollapsedCategories();
  const index = collapsed.indexOf(category);
  
  if (index > -1) {
    collapsed.splice(index, 1);
  } else {
    collapsed.push(category);
  }
  
  saveCollapsedCategories(collapsed);
  return collapsed;
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
const APP_VERSION = '1.1.0'; // Текущая версия приложения
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
  // Принудительно запрашиваем статус активации при загрузке
  ipcRenderer.invoke('get-activation-info').then(info => {
    console.log('Информация об активации при загрузке:', info);
    isActivated = info !== null;
    renderActivation();
  }).catch(err => {
    console.error('Ошибка получения статуса активации:', err);
    isActivated = false;
    renderActivation();
  });
  
  ipcRenderer.on('activation-status', (event, status) => {
    console.log('Получен статус активации:', status);
    isActivated = status;
    renderActivation();
  });
  
  // Обработчик сохранения категории файла
  ipcRenderer.on('file-category-saved', (event, fileName, category) => {
    console.log('Сохранена категория для файла:', fileName, 'категория:', category);
    saveFileCategory(fileName, category);
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
    
    // Группируем файлы по категориям
    const filesByCategory = {};
    files.forEach(f => {
      const category = getFileCategory(f);
      if (!filesByCategory[category]) {
        filesByCategory[category] = [];
      }
      filesByCategory[category].push(f);
    });
    
    let html = '';
    
    // Получаем состояние свернутых категорий
    const collapsedCategories = getCollapsedCategories();
    
    // Сортируем категории (сначала "Без категории", потом остальные по алфавиту)
    const categories = Object.keys(filesByCategory).sort((a, b) => {
      if (a === 'Без категории') return -1;
      if (b === 'Без категории') return 1;
      return a.localeCompare(b);
    });
    
    categories.forEach(category => {
      const filesInCategory = filesByCategory[category];
      const isCollapsed = collapsedCategories.includes(category);
      const collapseIcon = isCollapsed ? '▶' : '▼';
      
      // Заголовок категории с кнопкой сворачивания
      html += `
        <div class="category-header" data-category="${category}" style="margin:20px 0 12px 0;padding:8px 12px;background:linear-gradient(90deg,#7c3aed 60%,#a78bfa 100%);color:#fff;border-radius:8px;font-weight:600;font-size:1.1rem;cursor:pointer;display:flex;justify-content:space-between;align-items:center;transition:background 0.2s;" onmouseover="this.style.background='linear-gradient(90deg,#6d28d9 60%,#9333ea 100%)'" onmouseout="this.style.background='linear-gradient(90deg,#7c3aed 60%,#a78bfa 100%)'">
          <span>${category} (${filesInCategory.length})</span>
          <span class="collapse-icon" style="font-size:1.2rem;font-weight:bold;">${collapseIcon}</span>
        </div>
        <div class="category-files" data-category="${category}" style="display:${isCollapsed ? 'none' : 'block'};transition:all 0.3s ease;">
      `;
      
      // Файлы в категории
      filesInCategory.forEach(f => {
        const dateMatch = f.match(/(\d{2}\.\d{2}\.\d{4})/);
        const dateStr = dateMatch ? ` (${dateMatch[1]})` : '';
        
        // Получаем время создания файла для сортировки
        const filePath = path.join(saveDir, f);
        let stat, timeStr = '';
        try {
          stat = fs.statSync(filePath);
          if (stat) {
            const dt = new Date(stat.mtime);
            timeStr = dt.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
          }
        } catch {}
        
        html += `<div class="file-modal-link" data-fname="${f}" style="color:#7c3aed;cursor:pointer;text-decoration:underline;margin:6px 0;padding:8px 12px;background:#f8fafc;border-radius:6px;border-left:4px solid #7c3aed;transition:background 0.2s;" onmouseover="this.style.background='#ede9fe'" onmouseout="this.style.background='#f8fafc'">
          <div style="font-weight:500;">${f}${dateStr}</div>
          ${timeStr ? `<div style="font-size:0.9rem;color:#666;margin-top:2px;">Создан: ${timeStr}</div>` : ''}
        </div>`;
      });
      
      html += '</div>';
    });
    
    fileModalList.innerHTML = html;
    
    // Добавляем обработчики для кнопок сворачивания
    fileModalList.querySelectorAll('.category-header').forEach(header => {
      header.onclick = (e) => {
        const category = header.getAttribute('data-category');
        const filesContainer = fileModalList.querySelector(`[data-category="${category}"].category-files`);
        const collapseIcon = header.querySelector('.collapse-icon');
        
        if (filesContainer.style.display === 'none') {
          // Разворачиваем
          filesContainer.style.display = 'block';
          collapseIcon.textContent = '▼';
          toggleCategoryCollapse(category);
        } else {
          // Сворачиваем
          filesContainer.style.display = 'none';
          collapseIcon.textContent = '▶';
          toggleCategoryCollapse(category);
        }
      };
    });
    
    // Добавляем обработчики для файлов
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
  
  // Обработчики для кнопок массового управления категориями
  document.getElementById('expand-all-categories').onclick = () => {
    const headers = fileModalList.querySelectorAll('.category-header');
    const collapsed = [];
    
    headers.forEach(header => {
      const category = header.getAttribute('data-category');
      const filesContainer = fileModalList.querySelector(`[data-category="${category}"].category-files`);
      const collapseIcon = header.querySelector('.collapse-icon');
      
      filesContainer.style.display = 'block';
      collapseIcon.textContent = '▼';
      collapsed.push(category);
    });
    
    saveCollapsedCategories([]);
  };
  
  document.getElementById('collapse-all-categories').onclick = () => {
    const headers = fileModalList.querySelectorAll('.category-header');
    const collapsed = [];
    
    headers.forEach(header => {
      const category = header.getAttribute('data-category');
      const filesContainer = fileModalList.querySelector(`[data-category="${category}"].category-files`);
      const collapseIcon = header.querySelector('.collapse-icon');
      
      filesContainer.style.display = 'none';
      collapseIcon.textContent = '▶';
      collapsed.push(category);
    });
    
    saveCollapsedCategories(collapsed);
  };
  // --- Навигация между страницами ---
  const mainPage = document.getElementById('main-page');
  const comparePage = document.getElementById('compare-page');
  const compareBtn = document.getElementById('compare-btn');
  if (compareBtn && mainPage && comparePage) {
    compareBtn.onclick = () => {
      mainPage.style.display = 'none';
      comparePage.style.display = 'block';
      fillCompareSelects();
    };
  }
  const reviewsPage = document.getElementById('reviews-page');
  const parserBtn = document.getElementById('parser-btn');
  if (parserBtn && mainPage) {
    parserBtn.onclick = () => {
      if (comparePage) comparePage.style.display = 'none';
      if (reviewsPage) reviewsPage.style.display = 'none';
      mainPage.style.display = 'block';
    };
  }

  // Кнопка назад (если нужна)
  // ...
  // --- Сравнение ---
  let selectedCompareFile1 = null;
  let selectedCompareFile2 = null;

  // Функция для рендеринга списка файлов с категориями для сравнения
  async function renderCompareFileList(modalId, listId, selectedFile) {
    const files = await getXlsxFiles();
    const categories = getCategories();
    const collapsedCategories = getCollapsedCategories();
    
    // Группируем файлы по категориям
    const filesByCategory = {};
    files.forEach(file => {
      const category = getFileCategory(file) || 'Без категории';
      if (!filesByCategory[category]) {
        filesByCategory[category] = [];
      }
      filesByCategory[category].push(file);
    });
    
    // Сортируем категории (Без категории первая)
    const sortedCategories = Object.keys(filesByCategory).sort((a, b) => {
      if (a === 'Без категории') return -1;
      if (b === 'Без категории') return 1;
      return a.localeCompare(b);
    });
    
    const listElement = document.getElementById(listId);
    if (!listElement) return;
    
    let html = '';
    sortedCategories.forEach(category => {
      const files = filesByCategory[category];
      const isCollapsed = collapsedCategories.includes(category);
      
      html += `
        <div class="category-section" style="margin-bottom:16px;">
          <div class="category-header" style="display:flex;align-items:center;gap:8px;padding:12px 16px;background:linear-gradient(135deg,#f8fafc 0%,#f1f5f9 100%);border-radius:12px;cursor:pointer;font-weight:600;color:#374151;border:1px solid #e2e8f0;transition:all 0.2s;" onclick="toggleCompareCategoryCollapse('${category}', '${modalId}', '${listId}', '${selectedFile}')">
            <span class="category-toggle" style="font-size:1.1rem;transition:transform 0.3s;${isCollapsed ? 'transform:rotate(-90deg);' : ''}">▶</span>
            <span style="flex:1;font-size:1rem;">${category}</span>
            <span style="font-size:0.85rem;color:#6b7280;background:#fff;padding:4px 8px;border-radius:6px;border:1px solid #e5e7eb;">${files.length} файл${files.length === 1 ? '' : files.length < 5 ? 'а' : 'ов'}</span>
          </div>
          <div class="category-files" style="display:${isCollapsed ? 'none' : 'block'};margin-top:12px;margin-left:20px;animation:${isCollapsed ? 'none' : 'slideDown 0.3s ease-out'};">
      `;
      
      files.forEach(file => {
        const filePath = path.join(saveDir, file);
        let stat, label = file;
        try {
          stat = fs.statSync(filePath);
        } catch {}
        if (stat) {
          const dt = new Date(stat.mtime);
          const dtStr = dt.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
          label = `${file} (${dtStr})`;
        }
        
        const isSelected = selectedFile === file;
        html += `
          <div class="file-item" style="padding:12px 16px;margin:6px 0;background:${isSelected ? 'linear-gradient(135deg,#7c3aed 0%,#a78bfa 100%)' : '#fff'};color:${isSelected ? '#fff' : '#374151'};border-radius:10px;cursor:pointer;border:2px solid ${isSelected ? '#7c3aed' : '#e5e7eb'};transition:all 0.3s;box-shadow:${isSelected ? '0 4px 12px rgba(124,58,237,0.3)' : '0 2px 8px rgba(0,0,0,0.05)'};" onclick="selectCompareFile('${modalId}', '${file}')" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='${isSelected ? '0 6px 16px rgba(124,58,237,0.4)' : '0 4px 12px rgba(0,0,0,0.1)'}'" onmouseout="this.style.transform='translateY(0)';this.style.boxShadow='${isSelected ? '0 4px 12px rgba(124,58,237,0.3)' : '0 2px 8px rgba(0,0,0,0.05)'}'">
            <div style="font-weight:${isSelected ? '700' : '600'};font-size:0.95rem;margin-bottom:4px;">${label}</div>
            ${isSelected ? '<div style="font-size:0.85rem;opacity:0.9;display:flex;align-items:center;gap:6px;"><span style="font-size:1.1rem;">✓</span> Выбрано</div>' : ''}
          </div>
        `;
      });
      
      html += `
          </div>
        </div>
      `;
    });
    
    listElement.innerHTML = html;
  }

  // Функция для сворачивания/разворачивания категорий в сравнении
  window.toggleCompareCategoryCollapse = function(category, modalId, listId, selectedFile) {
    const collapsedCategories = getCollapsedCategories();
    const newCollapsed = collapsedCategories.includes(category) 
      ? collapsedCategories.filter(c => c !== category)
      : [...collapsedCategories, category];
    
    saveCollapsedCategories(newCollapsed);
    renderCompareFileList(modalId, listId, selectedFile);
  };

  // Функция выбора файла для сравнения (глобальная)
  window.selectCompareFile = function(modalId, filename) {
    if (modalId === 'compare-file-modal-1') {
      selectedCompareFile1 = filename;
      document.getElementById('select-compare-file-1').textContent = `Первый файл: ${filename}`;
      document.getElementById('compare-file-modal-1').style.display = 'none';
    } else if (modalId === 'compare-file-modal-2') {
      selectedCompareFile2 = filename;
      document.getElementById('select-compare-file-2').textContent = `Второй файл: ${filename}`;
      document.getElementById('compare-file-modal-2').style.display = 'none';
    }
  };
  // Обработчики для кнопок выбора файлов сравнения
  const selectCompareFile1Btn = document.getElementById('select-compare-file-1');
  const selectCompareFile2Btn = document.getElementById('select-compare-file-2');
  
  if (selectCompareFile1Btn) {
    selectCompareFile1Btn.onclick = async () => {
      await renderCompareFileList('compare-file-modal-1', 'compare-file-list-1', selectedCompareFile1);
      document.getElementById('compare-file-modal-1').style.display = 'flex';
    };
  }
  
  if (selectCompareFile2Btn) {
    selectCompareFile2Btn.onclick = async () => {
      await renderCompareFileList('compare-file-modal-2', 'compare-file-list-2', selectedCompareFile2);
      document.getElementById('compare-file-modal-2').style.display = 'flex';
    };
  }

  // Обработчики закрытия модальных окон сравнения
  const closeCompareModal1Btn = document.getElementById('close-compare-file-modal-1');
  const closeCompareModal2Btn = document.getElementById('close-compare-file-modal-2');
  
  if (closeCompareModal1Btn) {
    closeCompareModal1Btn.onclick = () => {
      document.getElementById('compare-file-modal-1').style.display = 'none';
    };
  }
  
  if (closeCompareModal2Btn) {
    closeCompareModal2Btn.onclick = () => {
      document.getElementById('compare-file-modal-2').style.display = 'none';
    };
  }

  // Обработчики разворачивания/сворачивания категорий для сравнения
  const expandAllCompare1Btn = document.getElementById('expand-all-compare-1');
  const collapseAllCompare1Btn = document.getElementById('collapse-all-compare-1');
  const expandAllCompare2Btn = document.getElementById('expand-all-compare-2');
  const collapseAllCompare2Btn = document.getElementById('collapse-all-compare-2');
  
  if (expandAllCompare1Btn) {
    expandAllCompare1Btn.onclick = async () => {
      saveCollapsedCategories([]);
      await renderCompareFileList('compare-file-modal-1', 'compare-file-list-1', selectedCompareFile1);
    };
  }
  
  if (collapseAllCompare1Btn) {
    collapseAllCompare1Btn.onclick = async () => {
      const categories = getCategories();
      const allCategories = ['Без категории', ...categories];
      saveCollapsedCategories(allCategories);
      await renderCompareFileList('compare-file-modal-1', 'compare-file-list-1', selectedCompareFile1);
    };
  }
  
  if (expandAllCompare2Btn) {
    expandAllCompare2Btn.onclick = async () => {
      saveCollapsedCategories([]);
      await renderCompareFileList('compare-file-modal-2', 'compare-file-list-2', selectedCompareFile2);
    };
  }
  
  if (collapseAllCompare2Btn) {
    collapseAllCompare2Btn.onclick = async () => {
      const categories = getCategories();
      const allCategories = ['Без категории', ...categories];
      saveCollapsedCategories(allCategories);
      await renderCompareFileList('compare-file-modal-2', 'compare-file-list-2', selectedCompareFile2);
    };
  }

  const runCompareBtn = document.getElementById('run-compare-btn');
  if (runCompareBtn) {
    runCompareBtn.onclick = async () => {
      const resultBlock = document.getElementById('compare-result-block');
      if (!selectedCompareFile1 || !selectedCompareFile2 || selectedCompareFile1 === selectedCompareFile2) {
        resultBlock.innerHTML = '<div style="color:#d32f2f;text-align:center;font-size:1.1rem;">Выберите два разных файла для сравнения</div>';
        return;
      }
      resultBlock.innerHTML = '<div class="preview-placeholder">Загрузка...</div>';
      try {
        const [data1, data2] = [readXlsxFile(selectedCompareFile1), readXlsxFile(selectedCompareFile2)];
        const stats1 = analyzeTable(data1);
        const stats2 = analyzeTable(data2);
        const diff = compareStats(stats1, stats2);
        resultBlock.innerHTML = renderCompareStats(stats1, stats2, diff, selectedCompareFile1, selectedCompareFile2);
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
      if (!selectedCompareFile1 || !selectedCompareFile2 || selectedCompareFile1 === selectedCompareFile2) {
        alert('Выберите два разных файла для сравнения!');
        return;
      }
      try {
        const [data1, data2] = [readXlsxFile(selectedCompareFile1), readXlsxFile(selectedCompareFile2)];
        const stats1 = analyzeTable(data1);
        const stats2 = analyzeTable(data2);
        const diff = compareStats(stats1, stats2);
        // Формируем данные для экспорта
        compareTableData = buildCompareTableForExport(stats1, stats2, diff, selectedCompareFile1, selectedCompareFile2);
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




});

function renderActivation() {
  console.log('renderActivation вызвана, isActivated:', isActivated);
  let actBlock = document.getElementById('activation-block');
  let indicator = document.getElementById('activation-indicator');
  
  // --- Блокировка элементов ---
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');
  if (searchInput) searchInput.disabled = !isActivated;
  if (searchBtn) searchBtn.disabled = !isActivated;
  // Блокировка других элементов (пример)
  const exportBtn = document.getElementById('export-btn');
  if (exportBtn) exportBtn.disabled = !isActivated;
  // Можно добавить блокировку предпросмотра, сортировки и т.д. по аналогии
  
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
  const sortingPanel = document.getElementById('sorting-panel');
  
  if (!previewData.length) {
    previewTable.innerHTML = '<div class="preview-placeholder">Выберите таблицу</div>';
    if (summaryBtn) summaryBtn.disabled = true;
    if (sortingPanel) sortingPanel.style.display = 'none';
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
        
        // Обработка ссылок
        if (previewHeaders[j] === 'Наименование') {
          // Проверяем, содержит ли ячейка гиперссылку Excel
          if (cell && typeof cell === 'string' && cell.includes('=HYPERLINK(')) {
            // Извлекаем URL и текст из гиперссылки Excel
            const match = cell.match(/=HYPERLINK\("([^"]+)","([^"]+)"\)/);
            if (match) {
              const url = match[1];
              const text = match[2];
              td.innerHTML = '<a href="#" class="link-cell" data-url="' + url + '">' + text + '</a>';
            } else {
              td.textContent = cell ?? '';
            }
          } else {
            td.textContent = cell ?? '';
          }
        } else if (previewHeaders[j] === 'Магазин') {
          // Проверяем, содержит ли ячейка гиперссылку Excel
          if (cell && typeof cell === 'string' && cell.includes('=HYPERLINK(')) {
            // Извлекаем URL и текст из гиперссылки Excel
            const match = cell.match(/=HYPERLINK\("([^"]+)","([^"]+)"\)/);
            if (match) {
              const url = match[1];
              const text = match[2];
              td.innerHTML = '<a href="#" class="link-cell" data-url="' + url + '">' + text + '</a>';
            } else {
              td.textContent = cell ?? '';
            }
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
      
      // Показываем панель сортировки
      const sortingPanel = document.getElementById('sorting-panel');
      if (sortingPanel) {
        sortingPanel.style.display = 'block';
      }
      
      // Добавляем обработчики для кнопок сортировки
      document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.onclick = () => {
          const sortType = btn.getAttribute('data-sort');
          
          // Убираем выделение со всех кнопок
          document.querySelectorAll('.sort-btn').forEach(b => {
            b.style.background = '#fff';
            b.style.borderColor = '#d1d5db';
            b.style.color = '#374151';
          });
          
          if (sortType === 'clear') {
            // Сброс сортировки
            sortState = { col: null, dir: 1 };
            btn.style.background = '#f3f4f6';
            btn.style.borderColor = '#d1d5db';
            btn.style.color = '#6b7280';
          } else {
            // Применяем сортировку
            btn.style.background = '#7c3aed';
            btn.style.borderColor = '#7c3aed';
            btn.style.color = '#fff';
            
            // Определяем колонку и направление
            let col, dir;
            if (sortType === 'price-asc') { col = previewHeaders.indexOf('Цена'); dir = 1; }
            else if (sortType === 'price-desc') { col = previewHeaders.indexOf('Цена'); dir = -1; }
            else if (sortType === 'rating-asc') { col = previewHeaders.indexOf('Рейтинг'); dir = 1; }
            else if (sortType === 'rating-desc') { col = previewHeaders.indexOf('Рейтинг'); dir = -1; }
            else if (sortType === 'reviews-asc') { col = previewHeaders.indexOf('Кол-во отзывов'); dir = 1; }
            else if (sortType === 'reviews-desc') { col = previewHeaders.indexOf('Кол-во отзывов'); dir = -1; }
            
            if (col !== -1) {
              sortState = { col, dir };
              sortPreviewData(col, dir);
              renderPreviewTable();
            }
          }
        };
      });
      
      // Глобальный обработчик для ссылок
      previewTable.addEventListener('click', (e) => {
        if (e.target.classList.contains('link-cell')) {
          e.preventDefault();
          const url = e.target.getAttribute('data-url');
          if (url && typeof url === 'string' && url.startsWith('http')) {
            shell.openExternal(url);
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
      
      // Обработка наименования товара - извлекаем название из гиперссылки
      let productName = obj['Наименование'] || '';
      if (productName && typeof productName === 'string' && productName.includes('=HYPERLINK(')) {
        const match = productName.match(/=HYPERLINK\("([^"]+)","([^"]+)"\)/);
        if (match) {
          productName = match[2]; // Берем текст ссылки (название товара)
        }
      }
      
      // Обработка магазина - извлекаем название из гиперссылки
      let shopName = obj['Магазин'] || '';
      if (shopName && typeof shopName === 'string' && shopName.includes('=HYPERLINK(')) {
        const match = shopName.match(/=HYPERLINK\("([^"]+)","([^"]+)"\)/);
        if (match) {
          shopName = match[2]; // Берем текст ссылки (название магазина)
        }
      }
      
      return {
        price: Number(obj['Цена']?.toString().replace(/[^\d.,-]/g, '').replace(',', '.')) || 0,
        rating: Number(obj['Рейтинг']?.toString().replace(/[^\d.,-]/g, '').replace(',', '.')) || 0,
        brand: obj['Бренд'] || '',
        shop: shopName,
        name: productName,
        reviews: Number(obj['Кол-во отзывов']?.toString().replace(/[^\d]/g, '')) || 0,
        link: '', // Убираем ссылку, так как теперь она в названии товара
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
  if (!query) {
    alert('Введите поисковый запрос');
    return;
  }
  
  // Сохраняем запрос и показываем модальное окно категорий
  pendingSearchQuery = query;
  showCategoryModal();
};

// Функция для показа модального окна категорий
function showCategoryModal() {
  const categoryModal = document.getElementById('category-modal');
  const existingCategories = document.getElementById('existing-categories');
  const newCategoryInput = document.getElementById('new-category-input');
  
  // Загружаем существующие категории
  const categories = getCategories();
  existingCategories.innerHTML = '';
  
  if (categories.length === 0) {
    existingCategories.innerHTML = '<div style="color:#666;font-style:italic;padding:8px;">Нет созданных категорий</div>';
  } else {
    categories.forEach(category => {
      const categoryBtn = document.createElement('button');
      categoryBtn.textContent = category;
      categoryBtn.setAttribute('data-category', category);
      categoryBtn.style.cssText = `
        display:block;width:100%;padding:10px 16px;margin:4px 0;text-align:left;
        background:#fff;border:2px solid #ddd;border-radius:8px;cursor:pointer;
        font-size:1rem;transition:all 0.2s;position:relative;
      `;
      
      // Добавляем иконку выбора
      const checkIcon = document.createElement('span');
      checkIcon.innerHTML = '✓';
      checkIcon.style.cssText = `
        position:absolute;right:12px;top:50%;transform:translateY(-50%);
        color:#7c3aed;font-weight:bold;font-size:1.2rem;opacity:0;
        transition:opacity 0.2s;
      `;
      categoryBtn.appendChild(checkIcon);
      
      categoryBtn.onmouseover = () => {
        if (selectedCategory !== category) {
          categoryBtn.style.borderColor = '#7c3aed';
          categoryBtn.style.background = '#f3f4f6';
        }
      };
      categoryBtn.onmouseout = () => {
        if (selectedCategory !== category) {
          categoryBtn.style.borderColor = '#ddd';
          categoryBtn.style.background = '#fff';
        }
      };
      categoryBtn.onclick = () => {
        // Убираем выделение с других кнопок
        existingCategories.querySelectorAll('button').forEach(btn => {
          btn.style.borderColor = '#ddd';
          btn.style.background = '#fff';
          btn.querySelector('span').style.opacity = '0';
        });
        // Выделяем выбранную
        categoryBtn.style.borderColor = '#7c3aed';
        categoryBtn.style.background = '#ede9fe';
        categoryBtn.style.boxShadow = '0 2px 8px rgba(124, 58, 237, 0.2)';
        checkIcon.style.opacity = '1';
        selectedCategory = category;
        
        // Обновляем текст кнопки подтверждения
        const confirmBtn = document.getElementById('confirm-category-btn');
        if (confirmBtn) {
          confirmBtn.textContent = `Продолжить парсинг в категорию "${category}"`;
        }
      };
      existingCategories.appendChild(categoryBtn);
    });
  }
  
  // Очищаем поле новой категории
  newCategoryInput.value = '';
  selectedCategory = null;
  
  // Сбрасываем текст кнопки подтверждения
  const confirmBtn = document.getElementById('confirm-category-btn');
  if (confirmBtn) {
    confirmBtn.textContent = 'Продолжить парсинг';
  }
  
  categoryModal.style.display = 'flex';
}

// Обработчики модального окна категорий
document.getElementById('create-category-btn').onclick = () => {
  const newCategoryInput = document.getElementById('new-category-input');
  const categoryName = newCategoryInput.value.trim();
  
  if (!categoryName) {
    alert('Введите название категории');
    return;
  }
  
  const categories = addCategory(categoryName);
  selectedCategory = categoryName;
  
  // Обновляем список категорий и выделяем созданную категорию
  showCategoryModal();
  
  // Находим и выделяем созданную категорию
  setTimeout(() => {
    const createdCategoryBtn = document.querySelector(`[data-category="${categoryName}"]`);
    if (createdCategoryBtn) {
      // Убираем выделение с других кнопок
      document.querySelectorAll('#existing-categories button').forEach(btn => {
        btn.style.borderColor = '#ddd';
        btn.style.background = '#fff';
        btn.querySelector('span').style.opacity = '0';
      });
      
      // Выделяем созданную категорию
      createdCategoryBtn.style.borderColor = '#7c3aed';
      createdCategoryBtn.style.background = '#ede9fe';
      createdCategoryBtn.style.boxShadow = '0 2px 8px rgba(124, 58, 237, 0.2)';
      createdCategoryBtn.querySelector('span').style.opacity = '1';
      
      // Обновляем текст кнопки подтверждения
      const confirmBtn = document.getElementById('confirm-category-btn');
      if (confirmBtn) {
        confirmBtn.textContent = `Продолжить парсинг в категорию "${categoryName}"`;
      }
    }
  }, 100);
};

document.getElementById('confirm-category-btn').onclick = async () => {
  if (!selectedCategory) {
    alert('Выберите или создайте категорию');
    return;
  }
  
  if (!pendingSearchQuery) {
    alert('Ошибка: поисковый запрос не найден');
    return;
  }
  
  // Закрываем модальное окно
  document.getElementById('category-modal').style.display = 'none';
  
  // Запускаем парсинг с выбранной категорией
  await startParsing(pendingSearchQuery, selectedCategory);
};

document.getElementById('cancel-category-btn').onclick = () => {
  document.getElementById('category-modal').style.display = 'none';
  pendingSearchQuery = null;
  selectedCategory = null;
};

document.getElementById('close-category-modal').onclick = () => {
  document.getElementById('category-modal').style.display = 'none';
  pendingSearchQuery = null;
  selectedCategory = null;
};

// Функция запуска парсинга
async function startParsing(query, category) {
  searchBtn.disabled = true;
  searchInput.disabled = true;
  loadingOverlay.style.display = 'flex';
  
  // Динамический таймер ожидания
  const loadingText = document.querySelector('.loading-text');
  let avgTime = Number(localStorage.getItem('avgParseTime')) || 20;
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
    // Передаем категорию в main процесс
    await ipcRenderer.invoke('run-parser', query, saveDir, category);
    
    if (parseTimerInterval) clearInterval(parseTimerInterval);
    if (loadingText) loadingText.textContent = 'Формируем таблицу...';
    
    await updateFileList();
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
}

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
  const reviews = products.map(p => p.reviews).filter(Boolean);
  
  // Группируем по магазину
  const shops = {};
  products.forEach(p => {
    const shop = p.shop || p['shop'] || p['Магазин'] || '';
    if (!shop) return;
    if (!shops[shop]) shops[shop] = { sumRating: 0, count: 0, sumReviews: 0, sumPrice: 0 };
    shops[shop].sumRating += Number(p.rating) || 0;
    shops[shop].sumReviews += Number(p.reviews) || 0;
    shops[shop].sumPrice += Number(p.price) || 0;
    shops[shop].count++;
  });
  
  // Топ магазины
  const topShops = Object.entries(shops)
    .map(([name, data]) => ({
      name,
      count: data.count,
      avgRating: data.count ? data.sumRating / data.count : 0,
      avgReviews: data.count ? data.sumReviews / data.count : 0,
      avgPrice: data.count ? data.sumPrice / data.count : 0
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  
  // Группируем по брендам
  const brands = {};
  products.forEach(p => {
    const brand = p.brand || p['Бренд'] || '';
    if (!brand) return;
    if (!brands[brand]) brands[brand] = { count: 0, sumRating: 0, sumReviews: 0, sumPrice: 0 };
    brands[brand].count++;
    brands[brand].sumRating += Number(p.rating) || 0;
    brands[brand].sumReviews += Number(p.reviews) || 0;
    brands[brand].sumPrice += Number(p.price) || 0;
  });
  
  const topBrands = Object.entries(brands)
    .map(([name, data]) => ({
      name,
      count: data.count,
      avgRating: data.count ? data.sumRating / data.count : 0,
      avgReviews: data.count ? data.sumReviews / data.count : 0,
      avgPrice: data.count ? data.sumPrice / data.count : 0
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  
  // Ценовые диапазоны
  const priceRanges = {
    budget: prices.filter(p => p <= 1000).length,
    medium: prices.filter(p => p > 1000 && p <= 3000).length,
    premium: prices.filter(p => p > 3000 && p <= 10000).length,
    luxury: prices.filter(p => p > 10000).length
  };
  
  // Рейтинговые диапазоны
  const ratingRanges = {
    low: ratings.filter(r => r < 4.0).length,
    good: ratings.filter(r => r >= 4.0 && r < 4.5).length,
    high: ratings.filter(r => r >= 4.5 && r < 4.8).length,
    excellent: ratings.filter(r => r >= 4.8).length
  };
  
  const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  const medianPrice = prices.length % 2 === 0 ?
    (prices[prices.length/2-1] + prices[prices.length/2]) / 2 :
    prices[Math.floor(prices.length/2)];
  const avgRating = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length) : 0;
  const avgReviews = reviews.length ? (reviews.reduce((a, b) => a + b, 0) / reviews.length) : 0;
  
  // Топ-5 товаров по количеству отзывов и рейтингу
  const topProducts = products
    .filter(p => p.name && p.reviews)
    .sort((a, b) => {
      if (b.reviews !== a.reviews) return b.reviews - a.reviews;
      return b.rating - a.rating;
    })
    .slice(0, 5);
  
  // Топ-5 наименований
  const nameGroups = {};
  products.forEach(p => {
    if (!p.name) return;
    const key = p.name.trim().toLowerCase();
    if (!nameGroups[key]) nameGroups[key] = { count: 0, sumReviews: 0, sumRating: 0 };
    nameGroups[key].count++;
    nameGroups[key].sumReviews += p.reviews || 0;
    nameGroups[key].sumRating += p.rating || 0;
  });
  
  const topNames = Object.entries(nameGroups)
    .map(([name, v]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      count: v.count,
      sumReviews: v.sumReviews,
      avgRating: v.count ? v.sumRating / v.count : 0
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
    minRating: ratings.length ? Math.min(...ratings) : 0,
    maxRating: ratings.length ? Math.max(...ratings) : 0,
    avgReviews,
    totalReviews: reviews.reduce((a, b) => a + b, 0),
    topShops,
    topBrands,
    priceRanges,
    ratingRanges,
    topProducts,
    topNames
  };
}

function renderSummary(summary) {
  const el = document.getElementById('summary');
  if (!el) return;
  
  // Функция для создания компактного прогресс-бара
  const createCompactProgressBar = (value, max, color) => {
    const percentage = max > 0 ? (value / max) * 100 : 0;
    return `
      <div style="display:flex;align-items:center;gap:4px;margin:2px 0;">
        <div style="flex:1;height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden;">
          <div style="width:${percentage}%;height:100%;background:${color};border-radius:3px;"></div>
        </div>
        <span style="font-size:0.7rem;color:#6b7280;min-width:30px;text-align:right;">${value}</span>
      </div>
    `;
  };
  
  el.innerHTML = `
    <div style="background:linear-gradient(135deg,#ffffff 0%,#f8fafc 100%);border-radius:12px;padding:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);max-height:calc(100vh - 200px);overflow-y:auto;">
      <!-- Основная статистика -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px;">
        <div style="background:#fff;padding:12px;border-radius:8px;border:1px solid #e5e7eb;text-align:center;">
          <div style="font-size:1.5rem;margin-bottom:2px;">📦</div>
          <div style="font-size:1.2rem;font-weight:700;color:#1f2937;margin-bottom:2px;">${summary.count || 0}</div>
          <div style="font-size:0.75rem;color:#6b7280;">Товаров</div>
        </div>
        <div style="background:#fff;padding:12px;border-radius:8px;border:1px solid #e5e7eb;text-align:center;">
          <div style="font-size:1.5rem;margin-bottom:2px;">💰</div>
          <div style="font-size:1.2rem;font-weight:700;color:#1f2937;margin-bottom:2px;">${summary.avgPrice ? summary.avgPrice.toLocaleString('ru-RU', {maximumFractionDigits:0}) : '-'}</div>
          <div style="font-size:0.75rem;color:#6b7280;">Ср. цена</div>
        </div>
        <div style="background:#fff;padding:12px;border-radius:8px;border:1px solid #e5e7eb;text-align:center;">
          <div style="font-size:1.5rem;margin-bottom:2px;">⭐</div>
          <div style="font-size:1.2rem;font-weight:700;color:#1f2937;margin-bottom:2px;">${summary.avgRating ? summary.avgRating.toFixed(2) : '-'}</div>
          <div style="font-size:0.75rem;color:#6b7280;">Рейтинг</div>
        </div>
        <div style="background:#fff;padding:12px;border-radius:8px;border:1px solid #e5e7eb;text-align:center;">
          <div style="font-size:1.5rem;margin-bottom:2px;">💬</div>
          <div style="font-size:1.2rem;font-weight:700;color:#1f2937;margin-bottom:2px;">${summary.totalReviews ? (summary.totalReviews/1000).toFixed(1) + 'k' : '-'}</div>
          <div style="font-size:0.75rem;color:#6b7280;">Отзывов</div>
        </div>
      </div>
      
      <!-- Компактные диапазоны -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
        <div style="background:#fff;padding:12px;border-radius:8px;border:1px solid #e5e7eb;">
          <h4 style="margin:0 0 8px 0;font-size:0.9rem;color:#1f2937;">📊 Цены</h4>
          <div style="font-size:0.75rem;">
            <div style="color:#059669;margin-bottom:4px;">Бюджет (≤1k): ${summary.priceRanges.budget}</div>
            <div style="color:#2563eb;margin-bottom:4px;">Средние (1-3k): ${summary.priceRanges.medium}</div>
            <div style="color:#7c3aed;margin-bottom:4px;">Премиум (3-10k): ${summary.priceRanges.premium}</div>
            <div style="color:#dc2626;">Люкс (>10k): ${summary.priceRanges.luxury}</div>
          </div>
        </div>
        <div style="background:#fff;padding:12px;border-radius:8px;border:1px solid #e5e7eb;">
          <h4 style="margin:0 0 8px 0;font-size:0.9rem;color:#1f2937;">⭐ Рейтинг</h4>
          <div style="font-size:0.75rem;">
            <div style="color:#dc2626;margin-bottom:4px;">Низкий (<4.0): ${summary.ratingRanges.low}</div>
            <div style="color:#f59e0b;margin-bottom:4px;">Хороший (4.0-4.5): ${summary.ratingRanges.good}</div>
            <div style="color:#10b981;margin-bottom:4px;">Высокий (4.5-4.8): ${summary.ratingRanges.high}</div>
            <div style="color:#059669;">Отличный (≥4.8): ${summary.ratingRanges.excellent}</div>
          </div>
        </div>
      </div>
      
      <!-- Топ магазины и бренды -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
        <div style="background:#fff;padding:12px;border-radius:8px;border:1px solid #e5e7eb;">
          <h4 style="margin:0 0 8px 0;font-size:0.9rem;color:#1f2937;">🏪 Топ магазины</h4>
          <div style="display:flex;flex-direction:column;gap:4px;max-height:120px;overflow-y:auto;">
            ${summary.topShops && summary.topShops.length ? summary.topShops.map((shop, i) => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:#f9fafb;border-radius:4px;font-size:0.75rem;">
                <div style="max-width:60%;">
                  <div style="font-weight:600;color:#1f2937;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${shop.name}</div>
                  <div style="color:#6b7280;">${shop.count} т.</div>
                </div>
                <div style="text-align:right;">
                  <div style="font-weight:600;color:#f59e0b;">${shop.avgRating.toFixed(1)}⭐</div>
                  <div style="color:#6b7280;">${shop.avgPrice.toLocaleString('ru-RU')}₽</div>
                </div>
              </div>
            `).join('') : '<div style="color:#6b7280;text-align:center;font-size:0.75rem;">Нет данных</div>'}
          </div>
        </div>
        
        <div style="background:#fff;padding:12px;border-radius:8px;border:1px solid #e5e7eb;">
          <h4 style="margin:0 0 8px 0;font-size:0.9rem;color:#1f2937;">🏷️ Топ бренды</h4>
          <div style="display:flex;flex-direction:column;gap:4px;max-height:120px;overflow-y:auto;">
            ${summary.topBrands && summary.topBrands.length ? summary.topBrands.map((brand, i) => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:#f9fafb;border-radius:4px;font-size:0.75rem;">
                <div style="max-width:60%;">
                  <div style="font-weight:600;color:#1f2937;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${brand.name}</div>
                  <div style="color:#6b7280;">${brand.count} т.</div>
                </div>
                <div style="text-align:right;">
                  <div style="font-weight:600;color:#f59e0b;">${brand.avgRating.toFixed(1)}⭐</div>
                  <div style="color:#6b7280;">${brand.avgPrice.toLocaleString('ru-RU')}₽</div>
                </div>
              </div>
            `).join('') : '<div style="color:#6b7280;text-align:center;font-size:0.75rem;">Нет данных</div>'}
          </div>
        </div>
      </div>
      
      <!-- Топ товары -->
      <div style="background:#fff;padding:12px;border-radius:8px;border:1px solid #e5e7eb;">
        <h4 style="margin:0 0 8px 0;font-size:0.9rem;color:#1f2937;">🔥 Топ товары по отзывам</h4>
        <div style="display:flex;flex-direction:column;gap:4px;max-height:100px;overflow-y:auto;">
          ${summary.topProducts && summary.topProducts.length ? summary.topProducts.map((product, i) => `
            <div style="padding:6px 8px;background:#f9fafb;border-radius:4px;border-left:3px solid #3b82f6;font-size:0.75rem;">
              <div style="font-weight:600;color:#1f2937;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px;">${product.name || 'Без названия'}</div>
              <div style="display:flex;gap:8px;color:#6b7280;">
                <span style="color:#2563eb;font-weight:600;">${product.price ? product.price.toLocaleString('ru-RU') + '₽' : '-'}</span>
                <span style="color:#f59e0b;font-weight:600;">${product.rating ? product.rating.toFixed(1) + '⭐' : '-'}</span>
                <span>${product.reviews ? product.reviews.toLocaleString('ru-RU') + ' отз.' : '-'}</span>
              </div>
            </div>
          `).join('') : '<div style="color:#6b7280;text-align:center;font-size:0.75rem;">Нет данных</div>'}
        </div>
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
  const supplierIdKey = rows[0] && ('ID поставщика' in rows[0]) ? 'ID поставщика' :
                        Object.keys(rows[0] || {}).find(k => k.toLowerCase().includes('поставщик')) || '';

  const prices = priceKey ? rows.map(r => Number(r[priceKey])).filter(v => !isNaN(v)) : [];
  const reviews = reviewsKey ? rows.map(r => Number(r[reviewsKey])).filter(Boolean) : [];
  const ratings = ratingKey ? rows.map(r => Number(r[ratingKey])).filter(Boolean) : [];
  const brands = brandKey ? rows.map(r => r[brandKey]).filter(Boolean) : [];
  const shops = shopKey ? rows.map(r => r[shopKey]).filter(Boolean) : [];
  const artikuls = artikulKey ? rows.map(r => r[artikulKey]) : [];
  const supplierIds = supplierIdKey ? rows.map(r => r[supplierIdKey]).filter(Boolean) : [];

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
    prices,
    supplierIds
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

function extractReadableText(text) {
  if (!text || typeof text !== 'string') return text || '';
  
  // Проверяем, является ли это гиперссылкой Excel
  if (text.includes('=HYPERLINK(')) {
    const match = text.match(/=HYPERLINK\("([^"]+)","([^"]+)"\)/);
    if (match) {
      return match[2]; // Возвращаем читаемый текст
    }
  }
  
  return text;
}

function renderCompareStats(s1, s2, diff, f1, f2) {
  function fmt(n, d=0) { return n ? n.toLocaleString('ru-RU', {maximumFractionDigits:d}) : '-'; }
  function pct(n) { 
    if (n === 0) return '';
    const sign = n > 0 ? '+' : '';
    const color = n > 0 ? '#10b981' : n < 0 ? '#ef4444' : '#6b7280';
    return `<span style="color:${color};font-weight:600;">(${sign}${n.toFixed(2)}%)</span>`;
  }
  
  // Функция для создания прогресс-бара
  const createProgressBar = (value, max, color) => {
    const percentage = max > 0 ? Math.min((value / max) * 100, 100) : 0;
    return `
      <div style="display:flex;align-items:center;gap:8px;margin:4px 0;">
        <div style="flex:1;height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;">
          <div style="width:${percentage}%;height:100%;background:${color};border-radius:4px;transition:width 0.3s;"></div>
        </div>
        <span style="font-size:0.8rem;color:#6b7280;min-width:40px;text-align:right;">${value}</span>
      </div>
    `;
  };
  
  // Извлекаем читаемые названия из гиперссылок
  const s1TopShop = extractReadableText(s1.topShop);
  const s2TopShop = extractReadableText(s2.topShop);
  
  // Вычисляем дополнительные метрики
  const s1PriceRange = s1.maxPrice - s1.minPrice;
  const s2PriceRange = s2.maxPrice - s2.minPrice;
  const priceRangeDiff = s2PriceRange - s1PriceRange;
  
  return `
    <div style="background:linear-gradient(135deg,#ffffff 0%,#f8fafc 100%);border-radius:16px;padding:24px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
      <!-- Заголовок сравнения -->
      <div style="text-align:center;margin-bottom:24px;">
        <h2 style="margin:0 0 8px 0;font-size:1.8rem;color:#1f2937;font-weight:700;">📊 Сравнение данных</h2>
        <div style="display:flex;justify-content:center;gap:16px;font-size:1rem;color:#6b7280;">
          <span>📁 ${f1}</span>
          <span style="color:#7c3aed;">↔</span>
          <span>📁 ${f2}</span>
        </div>
      </div>
      
      <!-- Основные метрики -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px;">
        <div style="background:#fff;padding:16px;border-radius:12px;border:1px solid #e5e7eb;text-align:center;">
          <div style="font-size:2rem;margin-bottom:4px;">📦</div>
          <div style="font-size:1.5rem;font-weight:700;color:#1f2937;margin-bottom:4px;">${fmt(s1.count)} → ${fmt(s2.count)}</div>
          <div style="font-size:0.85rem;color:#6b7280;">Товаров</div>
          ${pct(diff.countGrowth)}
        </div>
        <div style="background:#fff;padding:16px;border-radius:12px;border:1px solid #e5e7eb;text-align:center;">
          <div style="font-size:2rem;margin-bottom:4px;">💰</div>
          <div style="font-size:1.5rem;font-weight:700;color:#1f2937;margin-bottom:4px;">${fmt(s1.avgPrice)} → ${fmt(s2.avgPrice)}₽</div>
          <div style="font-size:0.85rem;color:#6b7280;">Средняя цена</div>
          ${pct(diff.priceGrowth)}
        </div>
        <div style="background:#fff;padding:16px;border-radius:12px;border:1px solid #e5e7eb;text-align:center;">
          <div style="font-size:2rem;margin-bottom:4px;">⭐</div>
          <div style="font-size:1.5rem;font-weight:700;color:#1f2937;margin-bottom:4px;">${fmt(s1.avgRating,2)} → ${fmt(s2.avgRating,2)}</div>
          <div style="font-size:0.85rem;color:#6b7280;">Рейтинг</div>
          ${pct(diff.ratingGrowth)}
        </div>
        <div style="background:#fff;padding:16px;border-radius:12px;border:1px solid #e5e7eb;text-align:center;">
          <div style="font-size:2rem;margin-bottom:4px;">💬</div>
          <div style="font-size:1.5rem;font-weight:700;color:#1f2937;margin-bottom:4px;">${fmt(s1.totalReviews)} → ${fmt(s2.totalReviews)}</div>
          <div style="font-size:0.85rem;color:#6b7280;">Отзывов</div>
          ${pct(diff.reviewsGrowth)}
        </div>
      </div>
      
      <!-- Детальная статистика -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:20px;margin-bottom:24px;">
        <div style="background:#fff;padding:20px;border-radius:12px;border:1px solid #e5e7eb;">
          <h3 style="margin:0 0 16px 0;font-size:1.2rem;color:#1f2937;display:flex;align-items:center;gap:8px;">
            <span style="font-size:1.3rem;">📈</span> Детальная статистика
          </h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div>
              <div style="font-weight:600;color:#374151;margin-bottom:8px;">Ценовые показатели</div>
              <div style="font-size:0.9rem;margin-bottom:4px;">Мин: ${fmt(s1.minPrice)} → ${fmt(s2.minPrice)}₽ ${pct(diff.minPriceGrowth)}</div>
              <div style="font-size:0.9rem;margin-bottom:4px;">Макс: ${fmt(s1.maxPrice)} → ${fmt(s2.maxPrice)}₽ ${pct(diff.maxPriceGrowth)}</div>
              <div style="font-size:0.9rem;margin-bottom:4px;">Медиана: ${fmt(s1.medianPrice)} → ${fmt(s2.medianPrice)}₽</div>
              <div style="font-size:0.9rem;">Диапазон: ${fmt(s1PriceRange)} → ${fmt(s2PriceRange)}₽ ${pct(priceRangeDiff)}</div>
            </div>
            <div>
              <div style="font-weight:600;color:#374151;margin-bottom:8px;">Топ показатели</div>
              <div style="font-size:0.9rem;margin-bottom:4px;">Бренд: ${s1.topBrand} → ${s2.topBrand}</div>
              <div style="font-size:0.9rem;margin-bottom:4px;">Магазин: ${s1TopShop} → ${s2TopShop}</div>
              <div style="font-size:0.9rem;margin-bottom:4px;">Ср. отзывов: ${fmt(s1.avgReviews)} → ${fmt(s2.avgReviews)}</div>
            </div>
          </div>
        </div>
        
        <div style="background:#fff;padding:20px;border-radius:12px;border:1px solid #e5e7eb;">
          <h3 style="margin:0 0 16px 0;font-size:1.2rem;color:#1f2937;display:flex;align-items:center;gap:8px;">
            <span style="font-size:1.3rem;">📊</span> Изменения
          </h3>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#f9fafb;border-radius:8px;">
              <span style="font-weight:600;color:#374151;">Количество товаров</span>
              <span style="font-weight:600;${diff.countGrowth > 0 ? 'color:#10b981;' : diff.countGrowth < 0 ? 'color:#ef4444;' : 'color:#6b7280;'}">${diff.countGrowth > 0 ? '+' : ''}${diff.countGrowth.toFixed(1)}%</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#f9fafb;border-radius:8px;">
              <span style="font-weight:600;color:#374151;">Средняя цена</span>
              <span style="font-weight:600;${diff.priceGrowth > 0 ? 'color:#10b981;' : diff.priceGrowth < 0 ? 'color:#ef4444;' : 'color:#6b7280;'}">${diff.priceGrowth > 0 ? '+' : ''}${diff.priceGrowth.toFixed(1)}%</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#f9fafb;border-radius:8px;">
              <span style="font-weight:600;color:#374151;">Средний рейтинг</span>
              <span style="font-weight:600;${diff.ratingGrowth > 0 ? 'color:#10b981;' : diff.ratingGrowth < 0 ? 'color:#ef4444;' : 'color:#6b7280;'}">${diff.ratingGrowth > 0 ? '+' : ''}${diff.ratingGrowth.toFixed(1)}%</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#f9fafb;border-radius:8px;">
              <span style="font-weight:600;color:#374151;">Всего отзывов</span>
              <span style="font-weight:600;${diff.reviewsGrowth > 0 ? 'color:#10b981;' : diff.reviewsGrowth < 0 ? 'color:#ef4444;' : 'color:#6b7280;'}">${diff.reviewsGrowth > 0 ? '+' : ''}${diff.reviewsGrowth.toFixed(1)}%</span>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Новые и исчезнувшие товары -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px;">
        <div style="background:#fff;padding:20px;border-radius:12px;border:1px solid #e5e7eb;">
          <h3 style="margin:0 0 16px 0;font-size:1.2rem;color:#1f2937;display:flex;align-items:center;gap:8px;">
            <span style="font-size:1.3rem;color:#10b981;">🆕</span> Новые товары (${diff.newItems.length})
          </h3>
          <div style="max-height:200px;overflow-y:auto;">
            ${diff.newItems.length ? diff.newItems.map(x => `
              <div style="padding:8px 12px;margin:4px 0;background:linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%);border-radius:8px;border-left:4px solid #10b981;font-size:0.9rem;color:#374151;">
                📦 ${x}
              </div>
            `).join('') : '<div style="color:#6b7280;text-align:center;font-size:0.9rem;padding:20px;">Нет новых товаров</div>'}
          </div>
        </div>
        
        <div style="background:#fff;padding:20px;border-radius:12px;border:1px solid #e5e7eb;">
          <h3 style="margin:0 0 16px 0;font-size:1.2rem;color:#1f2937;display:flex;align-items:center;gap:8px;">
            <span style="font-size:1.3rem;color:#ef4444;">❌</span> Исчезнувшие товары (${diff.goneItems.length})
          </h3>
          <div style="max-height:200px;overflow-y:auto;">
            ${diff.goneItems.length ? diff.goneItems.map(x => `
              <div style="padding:8px 12px;margin:4px 0;background:linear-gradient(135deg,#fef2f2 0%,#fee2e2 100%);border-radius:8px;border-left:4px solid #ef4444;font-size:0.9rem;color:#374151;">
                📦 ${x}
              </div>
            `).join('') : '<div style="color:#6b7280;text-align:center;font-size:0.9rem;padding:20px;">Нет исчезнувших товаров</div>'}
          </div>
        </div>
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

 





 