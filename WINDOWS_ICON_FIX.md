# 🔧 Исправление проблемы с иконками в Windows

## 📋 **Проблема**
При сборке приложения на Windows не отображается иконка приложения на ярлыке и в панели задач.

## 🎯 **Решение**

### **1. Официальная документация**
- **Electron Builder Icons**: https://www.electron.build/icons.html
- **Windows Configuration**: https://www.electron.build/win
- **NSIS Configuration**: https://www.electron.build/nsis

### **2. Требования для Windows**
Согласно официальной документации:
- **Файл иконки**: `icon.ico` (предпочтительно) или `icon.png`
- **Размер**: минимум 256x256 пикселей
- **Расположение**: в папке `build/` (buildResources directory)
- **Важно**: если не указать иконку, будет использована стандартная иконка Electron

### **3. Внесенные изменения**

#### **package.json:**
```json
{
  "build": {
    "icon": "build/icon.ico",  // Изменено с wildberris.png
    "win": {
      "icon": "build/icon.ico",  // Изменено с wildberris.png
      "verifyUpdateCodeSignature": false  // Добавлено
    },
    "nsis": {
      "installerIcon": "build/icon.ico",  // Изменено
      "uninstallerIcon": "build/icon.ico"  // Изменено
    }
  }
}
```

#### **main.js:**
```javascript
// Используем правильную иконку для Windows
const iconPath = process.platform === 'win32' 
  ? path.join(__dirname, 'build', 'icon.ico')
  : path.join(__dirname, 'build', 'wildberris.png');

// Добавлено улучшенное отображение окна
mainWindow = new BrowserWindow({
  show: false, // Не показываем окно сразу
  // ... остальные настройки
});

// Показываем окно только после полной загрузки
mainWindow.once('ready-to-show', () => {
  mainWindow.show();
});
```

### **4. Дополнительные рекомендации**

#### **Для создания качественной ICO иконки:**
1. **Размеры**: 16x16, 32x32, 48x48, 64x64, 128x128, 256x256 пикселей
2. **Формат**: ICO файл должен содержать несколько размеров
3. **Инструменты**: 
   - [AppIcon Generator](http://www.tweaknow.com/appicongenerator.php)
   - [MakeAppIcon](https://makeappicon.com/)
   - [iConvert Icons](https://iconverticons.com/online/)

#### **Проверка иконки:**
```bash
# Проверить размер иконки
file build/icon.ico

# Проверить содержимое ICO файла
identify build/icon.ico
```

### **5. Сборка приложения**
```bash
# Очистить предыдущую сборку
rm -rf dist/

# Собрать приложение
npm run dist
```

### **6. Проверка результата**
После сборки проверьте:
- ✅ Иконка отображается в панели задач
- ✅ Иконка отображается на ярлыке
- ✅ Иконка отображается в меню Пуск
- ✅ Иконка отображается в проводнике

### **7. Возможные проблемы и решения**

#### **Проблема**: Иконка все еще не отображается
**Решение**: 
1. Очистите кэш Windows: `ie4uinit.exe -show`
2. Перезапустите проводник: `taskkill /f /im explorer.exe && start explorer.exe`
3. Перезагрузите компьютер

#### **Проблема**: Иконка отображается только в некоторых местах
**Решение**: Убедитесь, что ICO файл содержит все необходимые размеры (16x16, 32x32, 48x48, 64x64, 128x128, 256x256)

#### **Проблема**: Иконка выглядит размыто
**Решение**: Используйте векторную графику или изображения высокого разрешения для создания ICO файла

## 📚 **Полезные ссылки**
- [Electron Builder Documentation](https://www.electron.build/)
- [Windows Icon Guidelines](https://docs.microsoft.com/en-us/windows/uwp/design/style/app-icons-and-logos)
- [ICO File Format Specification](https://en.wikipedia.org/wiki/ICO_(file_format)) 