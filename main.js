const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const activation = require('./activation');
const { autoUpdater } = require('electron-updater');
const remoteMain = require('@electron/remote/main');

let activationPassed = false;
let mainWindow = null;

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
      width: 1100,
      height: 700,
      icon: path.join(__dirname, 'icons.ico'),
      // frame: false, // убрано для дефолтных кнопок
      // transparent: true, // убрано
      // roundedCorners: true, // убрано
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
  return new Promise((resolve, reject) => {
    let cmd = `node parser.js`;
    if (saveDir) cmd += ` "${saveDir}"`;
    const child = exec(cmd, { env: { ...process.env } }, (error, stdout, stderr) => {
      if (error) return reject(stderr || error.message);
      resolve(stdout);
    });
    child.stdin.write(query + '\n');
    child.stdin.end();
  });
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

ipcMain.handle('check-for-updates', () => {
  autoUpdater.checkForUpdatesAndNotify();
}); 