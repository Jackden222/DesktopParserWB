# Wildberries Parser

## Описание
Парсер товаров Wildberries по ключевому слову с экспортом в Excel. Поддерживает фильтрацию по цене и рейтингу, сохраняет логи.

## Установка
```
npm install
```

## Запуск
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