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
  } catch (e) {
    previewTable.innerHTML = '<div style="color:red">Ошибка чтения файла</div>';
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