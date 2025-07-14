const axios = require('axios');
const XLSX = require('xlsx');
const fs = require('fs');

async function fetchWB(query, { minPrice = 0, maxPrice = Infinity, minRating = 0 } = {}) {
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
      return {
        'Артикул WB': String(p.id),
        'Наименование': p.name,
        'Бренд': p.brand,
        'Цена': price,
        'Рейтинг': p.reviewRating,
        'Кол-во отзывов': p.feedbacks,
        'Объём продаж в мес': p.volume ?? '',
        'Ссылка на товар': `https://www.wildberries.ru/catalog/${p.id}/detail.aspx`,
        'Магазин': p.supplier,
        'Ссылка на магазин': p.supplierId ? `https://www.wildberries.ru/seller/${p.supplierId}` : '',
      };
    })
    .filter(p => p['Цена'] !== null); // убираю фильтры по цене и рейтингу

  // экспорт в Excel
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Товары");

  // Формируем имя файла по запросу, убираем недопустимые символы
  let safeQuery = query && query.trim() ? query.trim() : 'носки';
  safeQuery = safeQuery.replace(/[\\/:*?"<>|]/g, '_');
  const fileName = `${safeQuery}.xlsx`;
  XLSX.writeFile(workbook, fileName);

  logStream.write(`[${new Date().toISOString()}] Готово: ${fileName}. Всего товаров: ${data.length}\n`);
  logStream.end();
  console.log(`✅ Готово: ${fileName}. Всего товаров: ${data.length}`);
}

// Удаляю жёстко заданный вызов
// fetchWB("носки", { minPrice: 200, maxPrice: 1000, minRating: 4 });

const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Введите поисковый запрос (по умолчанию "носки"): ', (query) => {
  const search = query && query.trim() ? query.trim() : 'носки';
  fetchWB(search, { minPrice: 200, maxPrice: 1000, minRating: 4 })
    .then(() => rl.close());
}); 