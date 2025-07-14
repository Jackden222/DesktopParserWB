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