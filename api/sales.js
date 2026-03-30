// api/sales.js — Nintendo eShop Proxy（三層備援策略）
// 策略1: ec.nintendo.com sales API (HK + US)
// 策略2: nintendo.com.hk JSON + api.ec.nintendo.com 價格 API
// 策略3: US 區備援

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  console.log('[sales] 開始抓取...');

  // ── 策略 1：直接抓 sales API ─────────────────────────────
  try {
    const [hk, us] = await Promise.allSettled([
      fetchSalesAPI('HK', 'zh'),
      fetchSalesAPI('US', 'en'),
    ]);
    const hkList = hk.status === 'fulfilled' ? hk.value : [];
    const usList = us.status === 'fulfilled' ? us.value : [];
    console.log(`[策略1] HK:${hkList.length} US:${usList.length}`);

    const usImgMap = {};
    for (const g of usList) {
      const k = norm(g.formal_name || '');
      if (k && g.hero_banner_url) usImgMap[k] = g.hero_banner_url;
    }

    let combined = hkList.map(g => ({
      ...g,
      hero_banner_url: g.hero_banner_url || usImgMap[norm(g.formal_name || '')] || null,
    }));
    if (!combined.length) combined = usList;

    if (combined.length >= 5) {
      console.log(`[策略1] 成功 ${combined.length} 款`);
      return res.status(200).json({ contents: combined, total: combined.length, source: 'sales-api' });
    }
  } catch (e) {
    console.error('[策略1] 失敗:', e.message);
  }

  // ── 策略 2：HK JSON 遊戲列表 + Price API ─────────────────
  try {
    console.log('[策略2] 嘗試 HK JSON + Price API');
    const gameListRes = await fetch('https://www.nintendo.com.hk/data/json/switch_software.json', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://www.nintendo.com.hk/',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!gameListRes.ok) throw new Error(`HK JSON ${gameListRes.status}`);
    const gameList = await gameListRes.json();
    console.log(`[策略2] HK 遊戲總數: ${gameList.length}`);

    const nsuids = gameList.map(g => g.id || g.nsuid || g.title_id).filter(Boolean).slice(0, 500);
    const onSale = [];

    for (let i = 0; i < nsuids.length; i += 50) {
      const batch = nsuids.slice(i, i + 50);
      try {
        const priceRes = await fetch(
          `https://api.ec.nintendo.com/v1/price?country=HK&ids=${batch.join(',')}&lang=zh`,
          { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }
        );
        if (!priceRes.ok) continue;
        const priceData = await priceRes.json();
        for (const p of priceData.prices || []) {
          if (p.sales_status === 'onsale' && p.discount_price) {
            const game = gameList.find(g => String(g.id || g.nsuid || g.title_id) === String(p.title_id));
            if (game) onSale.push({ game, price: p });
          }
        }
      } catch (e) { /* 繼續下一批 */ }
    }

    console.log(`[策略2] 找到 ${onSale.length} 款特價`);
    if (onSale.length >= 3) {
      const contents = onSale.map(({ game, price }) => ({
        id: game.id || game.nsuid,
        formal_name: game.formal_name || game.title || '',
        description: game.description || game.catch_copy || '',
        hero_banner_url: game.hero_banner_url || game.banner_url || null,
        genre: game.genre || '',
        price: { regular_price: price.regular_price, discount_price: price.discount_price },
      }));
      return res.status(200).json({ contents, total: contents.length, source: 'hk-json+price' });
    }
  } catch (e) {
    console.error('[策略2] 失敗:', e.message);
  }

  // ── 策略 3：US 備援 ──────────────────────────────────────
  try {
    const usList = await fetchSalesAPI('US', 'en');
    if (usList.length >= 3) {
      return res.status(200).json({ contents: usList, total: usList.length, source: 'us-only' });
    }
  } catch (e) {}

  return res.status(200).json({ contents: [], total: 0, source: 'none', error: 'all-failed' });
}

async function fetchSalesAPI(country, lang) {
  const results = [];
  const pageSize = 50;
  let offset = 0;

  for (let page = 0; page < 10; page++) {
    const url = `https://ec.nintendo.com/api/${country}/${lang}/search/sales?count=${pageSize}&offset=${offset}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': lang === 'zh' ? 'zh-TW,zh;q=0.9,en;q=0.8' : 'en-US,en;q=0.9',
        'Referer': `https://ec.nintendo.com/${country}/${lang}/`,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) { console.log(`[fetchSales] ${country} ${res.status}`); break; }
    const data = await res.json();
    if (!data?.contents?.length) break;
    results.push(...data.contents);
    offset += pageSize;
    if (data.contents.length < pageSize || results.length >= (data.total || 9999)) break;
  }
  return results;
}

function norm(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 25);
}
