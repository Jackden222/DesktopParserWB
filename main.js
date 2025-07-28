const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const activation = require('./activation');
const { autoUpdater } = require('electron-updater');
const remoteMain = require('@electron/remote/main');
const axios = require('axios');
const XLSX = require('xlsx');

let activationPassed = false;
let mainWindow = null;

// Интегрированная функция парсинга
async function fetchWB(query, saveDir) {
  const logStream = fs.createWriteStream('log.txt', { flags: 'a' });
  logStream.write(`\n[${new Date().toISOString()}] Запуск парсинга: '${query}'\n`);
  let page = 1;
  let allProducts = [];
  let hasMore = true;

  while (hasMore) {
    const url = `https://search.wb.ru/exactmatch/ru/common/v5/search?query=${encodeURIComponent(query)}&resultset=catalog&limit=100&page=${page}&appType=1&dest=12358553&spp=30`;
    logStream.write(`[${new Date().toISOString()}] URL: ${url}\n`);
    try {
      const res = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
          'Origin': 'https://www.wildberries.ru',
          'Referer': 'https://www.wildberries.ru/',
        },
      });
      logStream.write(`[${new Date().toISOString()}] Ответ: ${JSON.stringify(res.data).slice(0, 500)}\n`);
      if (!res.data || !res.data.data || !Array.isArray(res.data.data.products)) {
        logStream.write(`[${new Date().toISOString()}] Ошибка на странице ${page}: Некорректная структура ответа\n`);
        logStream.write(`[${new Date().toISOString()}] Ответ: ${JSON.stringify(res.data).slice(0, 2000)}\n`);
        console.error(`Ошибка на странице ${page}: Некорректная структура ответа`);
        console.dir(res.data, { depth: null });
        hasMore = false;
        continue;
      }
      const products = res.data.data.products;
      if (!products || products.length === 0) {
        hasMore = false;
      } else {
        allProducts = allProducts.concat(products);
        page++;
      }
    } catch (e) {
      logStream.write(`[${new Date().toISOString()}] Ошибка на странице ${page}: ${e.message}\n`);
      console.error(`Ошибка на странице ${page}:`, e.message);
      if (e.response && e.response.data && e.response.data.error === 'page param malformed') {
        hasMore = false;
      } else {
        hasMore = false;
      }
    }
  }

  const data = allProducts
    .map(p => {
      let price = null;
      if (Array.isArray(p.sizes) && p.sizes.length > 0 && p.sizes[0].price && typeof p.sizes[0].price.product === 'number') {
        price = p.sizes[0].price.product / 100;
      }
      
      // Создаем кликабельную ссылку для магазина
      const shopLink = p.supplierId ? `https://www.wildberries.ru/seller/${p.supplierId}` : '';
      const shopName = p.supplier || '';
      const shopDisplay = shopLink ? `=HYPERLINK("${shopLink}","${shopName}")` : shopName;
      
      // Создаем кликабельную ссылку для товара
      const productLink = `https://www.wildberries.ru/catalog/${p.id}/detail.aspx`;
      const productName = p.name || '';
      const productDisplay = productLink ? `=HYPERLINK("${productLink}","${productName}")` : productName;
      
      return {
        'Артикул WB': String(p.id),
        'Наименование': productDisplay,
        'Бренд': p.brand,
        'Цена': price,
        'Рейтинг': p.reviewRating,
        'Кол-во отзывов': p.feedbacks,
        'Магазин': shopDisplay
      };
    })
    .filter(p => p['Цена'] !== null);

  // экспорт в Excel
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Товары");

  // Формируем имя файла по запросу, убираем недопустимые символы
  let safeQuery = query && query.trim() ? query.trim() : 'носки';
  safeQuery = safeQuery.replace(/[\/:*?"<>|]/g, '_');
  const saveDirectory = saveDir || process.cwd();
  
  // Создаем понятное имя файла с датой и количеством товаров
  const now = new Date();
  const dateStr = now.toLocaleDateString('ru-RU', { 
    day: '2-digit', 
    month: '2-digit', 
    year: 'numeric' 
  }).replace(/\./g, '-');
  
  let fileName = path.join(saveDirectory, `${safeQuery}_${dateStr}_${data.length}шт.xlsx`);
  
  // Если файл существует, добавляем счетчик
  let counter = 1;
  while (fs.existsSync(fileName)) {
    fileName = path.join(saveDirectory, `${safeQuery}_${dateStr}_${data.length}шт_${counter}.xlsx`);
    counter++;
  }
  XLSX.writeFile(workbook, fileName);

  logStream.write(`[${new Date().toISOString()}] Готово: ${fileName}. Всего товаров: ${data.length}\n`);
  logStream.end();
  console.log(`✅ Готово: ${fileName}. Всего товаров: ${data.length}`);
  
  return fileName;
}

async function startApp() {
  let activated = await activation.checkActivation();
  if (activated === true) {
    activationPassed = true;
  } else {
    activationPassed = false;
  }
  createWindow(activationPassed);
}

function setupAutoUpdater(win) {
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-available', () => {
    win.webContents.send('update-message', 'Доступно обновление. Загрузка...');
  });
  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Обновление',
      message: 'Обновление загружено. Перезапустить приложение сейчас?',
      buttons: ['Перезапустить', 'Позже']
    }).then(result => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });
  autoUpdater.on('error', (err) => {
    win.webContents.send('update-message', 'Ошибка обновления: ' + err.message);
  });
  autoUpdater.checkForUpdatesAndNotify();
}

function createWindow(isActivated) {
  try {
    mainWindow = new BrowserWindow({
      width: 1250,
      height: 800,
      minWidth: 1000,
      minHeight: 600,
      icon: path.join(__dirname, 'build', process.platform === 'darwin' ? 'icon.icns' : 'icon.ico'),
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        enableRemoteModule: true,
      },
    });
    remoteMain.enable(mainWindow.webContents);
    mainWindow.loadFile('index.html');
    mainWindow.setMenu(null);
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send('activation-status', isActivated);
    });
    setupAutoUpdater(mainWindow);
  } catch (e) {
    console.error('createWindow error: ' + e.message);
  }
}

app.whenReady().then(() => {
  remoteMain.initialize();
  startApp();
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(activationPassed);
  });
});

app.on('window-all-closed', function () {
  if (!activationPassed) {
    return;
  }
  if (process.platform !== 'darwin') app.quit();
});

// IPC: запуск парсера по запросу из renderer
ipcMain.handle('run-parser', async (event, query, saveDir) => {
  try {
    console.log('Запуск парсера с запросом:', query, 'в папку:', saveDir);
    const result = await fetchWB(query, saveDir);
    return { success: true, fileName: result };
  } catch (error) {
    console.error('Ошибка парсинга:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('try-activate', async (event, code) => {
  const res = await activation.activateWithCode(code.trim());
  if (res.ok) {
    activationPassed = true;
    if (mainWindow) {
      mainWindow.webContents.send('activation-status', true);
    }
  }
  return res;
});

ipcMain.handle('get-activation-info', async () => {
  const info = await activation.getActivationInfo();
  return info;
});

 