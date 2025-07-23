# Wildberries Parser

## Описание
Парсер товаров Wildberries по ключевому слову с экспортом в Excel. Поддерживает фильтрацию по цене и рейтингу, сохраняет логи.

## Зависимости

Для работы парсера необходимы следующие зависимости:

- axios
- node-fetch
- xlsx
- @supabase/supabase-js
- node-machine-id
- @electron/remote
- electron-updater
- electron (для GUI)
- electron-builder (для сборки GUI)

### Установка зависимостей

#### Windows
```powershell
npm install axios node-fetch xlsx @supabase/supabase-js node-machine-id @electron/remote electron-updater electron electron-builder
```

#### macOS
```bash
npm install axios node-fetch xlsx @supabase/supabase-js node-machine-id @electron/remote electron-updater electron electron-builder
```

## Установка
```
npm install
```

## Запуск

Для запуска графического интерфейса используйте:

#### Windows
```powershell
npx electron .
```

#### macOS
```bash
npx electron .
```

Для запуска в режиме CLI:
```
node parser.js
```

## Фильтры
Вызовите функцию с нужными параметрами:
```js
fetchWB("ключевое_слово", { minPrice: 200, maxPrice: 1000, minRating: 4 });
```

- minPrice — минимальная цена
- maxPrice — максимальная цена
- minRating — минимальный рейтинг

## Экспорт в exe (CLI)
```
npm install -g pkg
pkg parser.js --output wb-parser.exe
```

## GUI (опционально)
Для создания графического интерфейса используйте Tauri или Electron:
- [Tauri](https://tauri.app)
- [Electron](https://www.electronjs.org) 