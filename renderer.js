const { ipcRenderer, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

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
const APP_VERSION = '1.0.0'; // Текущая версия приложения
const GITHUB_OWNER = 'ВАШ_GITHUB_НИК'; // заменить на ваш ник
const GITHUB_REPO = 'ВАШ_РЕПОЗИТОРИЙ'; // заменить на ваш репозиторий
const GITHUB_BRANCH = 'production';

window.addEventListener('DOMContentLoaded', () => {
  ipcRenderer.on('activation-status', (event, status) => {
    isActivated = status;
    renderActivation();
  });
  checkForUpdate();
  ipcRenderer.on('update-message', (event, msg) => {
    alert(msg); // Можно заменить на красивый UI, если потребуется
  });
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
  const files = fs.readdirSync('.').filter(f => f.endsWith('.xlsx'));
  return files
    .map(f => ({
      name: f,
      mtime: fs.statSync(f).mtime.getTime()
    }))
    .sort((a, b) => b.mtime - a.mtime)
    .map(f => f.name);
}

function updateFileList() {
  fileList.innerHTML = '';
  const files = getXlsxFiles();
  files.forEach(f => {
    const li = document.createElement('li');
    li.textContent = f;
    li.onclick = () => previewFile(f);
    fileList.appendChild(li);
  });
  if (files.length > 0) previewFile(files[0]);
}

function renderPreviewTable() {
  if (!previewData.length) return;
  let html = '<table>';
  // Заголовки
  html += '<tr>' + previewHeaders.map((cell, j) => {
    let sortArrow = '';
    if ([
      'Цена',
      'Рейтинг',
      'Кол-во отзывов',
      'Объём продаж в мес'
    ].includes(cell)) {
      if (sortState.col === j) sortArrow = sortState.dir === 1 ? ' <span style="font-size:14px">▲</span>' : ' <span style="font-size:14px">▼</span>';
      return `<th class="sortable" data-col="${j}">${cell}${sortArrow}</th>`;
    }
    return `<th>${cell}</th>`;
  }).join('') + '</tr>';
  // Данные
  previewData.forEach((row, i) => {
    html += '<tr>' + row.map((cell, j) => {
      if (previewHeaders[j] === 'Ссылка на товар' || previewHeaders[j] === 'Ссылка на магазин') {
        if (cell && typeof cell === 'string' && cell.startsWith('http')) {
          return `<td><a href="#" onclick="window.openLink('${cell}')">Ссылка</a></td>`;
        }
      }
      return `<td title="${cell ?? ''}">${cell ?? ''}</td>`;
    }).join('') + '</tr>';
  });
  html += '</table>';
  previewTable.innerHTML = html;
  // Навешиваем обработчики сортировки
  document.querySelectorAll('.sortable').forEach(th => {
    th.onclick = () => {
      const col = Number(th.getAttribute('data-col'));
      if (sortState.col === col) sortState.dir *= -1;
      else { sortState.col = col; sortState.dir = 1; }
      sortPreviewData(col, sortState.dir);
      renderPreviewTable();
    };
  });
  window.openLink = (url) => { shell.openExternal(url); };
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
    const wb = XLSX.readFile(filename);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
    previewHeaders = data[0];
    previewData = data.slice(1);
    sortState = { col: null, dir: 1 };
    renderPreviewTable();
    // Формируем массив products для сводки
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
    previewTable.innerHTML = '<div style="color:red">Ошибка чтения файла</div>';
    updateSummary([]);
  }
}

searchBtn.onclick = async () => {
  const query = searchInput.value.trim();
  searchBtn.disabled = true;
  searchInput.disabled = true;
  loadingOverlay.style.display = 'flex';
  try {
    await ipcRenderer.invoke('run-parser', query);
    updateFileList();
  } catch (e) {
    alert('Ошибка парсинга: ' + e);
  }
  loadingOverlay.style.display = 'none';
  searchBtn.disabled = false;
  searchInput.disabled = false;
  searchBtn.textContent = 'Искать';
};

window.onload = updateFileList;

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
    <div class="summary-item"><span class="summary-icon">📦</span><span class="summary-value">${summary.count || 0}</span><span class="summary-label">Товаров найдено</span></div>
    <div class="summary-item"><span class="summary-icon">💰</span><span class="summary-value">${summary.avgPrice ? summary.avgPrice.toLocaleString('ru-RU', {maximumFractionDigits:0}) : '-'}</span><span class="summary-label">Средняя цена</span></div>
    <div class="summary-item"><span class="summary-icon">📊</span><span class="summary-value">${summary.medianPrice ? summary.medianPrice.toLocaleString('ru-RU', {maximumFractionDigits:0}) : '-'}</span><span class="summary-label">Медиана цены</span></div>
    <div class="summary-item"><span class="summary-icon">⬇️</span><span class="summary-value">${summary.minPrice ? summary.minPrice.toLocaleString('ru-RU', {maximumFractionDigits:0}) : '-'}</span><span class="summary-label">Мин. цена</span></div>
    <div class="summary-item"><span class="summary-icon">⬆️</span><span class="summary-value">${summary.maxPrice ? summary.maxPrice.toLocaleString('ru-RU', {maximumFractionDigits:0}) : '-'}</span><span class="summary-label">Макс. цена</span></div>
    <div class="summary-item"><span class="summary-icon">⭐</span><span class="summary-value">${summary.avgRating ? summary.avgRating.toFixed(2) : '-'}</span><span class="summary-label">Средний рейтинг</span></div>
    <div class="summary-item"><span class="summary-icon">🏪</span><span class="summary-value">${summary.topShop || '-'}</span><span class="summary-label">Топ магазин</span></div>
    <div class="summary-flex-row" style="display:flex;gap:32px;align-items:flex-start;margin-top:10px;">
      <div style="flex:1;min-width:600px;">
        <span class="summary-label" style="font-weight:600;font-size:1rem;">Топ 5 самых продаваемых товаров (по отзывам и рейтингу)</span>
        <div style="margin-top:6px;">
          ${summary.topProducts && summary.topProducts.length ? summary.topProducts.map((p, i) => `
            <div style="margin-bottom:4px;font-size:0.95em;">
              <span style="font-weight:600;">${i+1}.</span> ${p.name ? p.name : '-'}
              <span style="color:#2d72d9;">${p.price ? ' · ' + p.price.toLocaleString('ru-RU') + '₽' : ''}</span>
              <span style="color:#f5b50a;">${p.rating ? ' · ' + p.rating.toFixed(2) + '★' : ''}</span>
              <span style="color:#888;">${p.reviews ? ' · ' + p.reviews + ' отзывов' : ''}</span>
              ${p.link ? `<a href="#" onclick="window.openLink('${p.link}')" style="color:#6c63ff;text-decoration:underline;margin-left:6px;">Ссылка</a>` : ''}
            </div>
          `).join('') : '<span style="color:#888">Нет данных</span>'}
        </div>
      </div>
      <div style="flex:1;min-width:220px;">
        <span class="summary-label" style="font-weight:600;font-size:1rem;">Топ 5 самых популярных наименований (по колличеству повторяющихся товаров)</span>
        <div style="margin-top:6px;">
          ${summary.topNames && summary.topNames.length ? summary.topNames.map((n, i) => `
            <div style="margin-bottom:4px;font-size:0.95em;">
              <span style="font-weight:600;">${i+1}.</span> ${n.name}
              <span style="color:#2d72d9;"> · ${n.count} товаров</span>
              <span style="color:#f5b50a;">${n.avgRating ? ' · ' + n.avgRating.toFixed(2) + '★' : ''}</span>
              <span style="color:#888;">${n.sumReviews ? ' · ' + n.sumReviews + ' отзывов' : ''}</span>
            </div>
          `).join('') : '<span style="color:#888">Нет данных</span>'}
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

// Аналитика и модальное окно удалены 