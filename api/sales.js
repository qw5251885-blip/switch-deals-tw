// api/sales.js — 使用 api.ec.nintendo.com/v1/price 穩定端點
// 流程：
//   1. 從 Nintendo HK 官網抓完整遊戲 JSON（有圖片、名稱、ID）
//   2. 用 /v1/price 批次查詢價格，找出特價中的遊戲
//   3. 合併回傳

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── Step 1：抓 HK 完整遊戲列表（含圖片）─────────────────
    console.log('[Step1] 抓 HK 遊戲列表...');
    const listRes = await fetch(
      'https://www.nintendo.com.hk/data/json/switch_software.json',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': 'https://www.nintendo.com.hk/switch/software/',
        },
        signal: AbortSignal.timeout(12000),
      }
    );

    if (!listRes.ok) throw new Error(`遊戲列表失敗 ${listRes.status}`);
    const gameList = await listRes.json();
    console.log(`[Step1] 取得 ${gameList.length} 款遊戲`);

    // 建立 ID -> 遊戲資料對照表
    const gameMap = {};
    for (const g of gameList) {
      const id = String(g.id || g.nsuid || g.title_id || '');
      if (id) gameMap[id] = g;
    }

    const allIds = Object.keys(gameMap);
    console.log(`[Step2] 開始查詢 ${allIds.length} 款遊戲價格...`);

    // ── Step 2：批次查詢 HK 價格（每批 50 個）─────────────────
    const onSaleGames = [];
    const BATCH = 50;

    for (let i = 0; i < allIds.length && i < 2000; i += BATCH) {
      const batch = allIds.slice(i, i + BATCH);
      try {
        const priceRes = await fetch(
          `https://api.ec.nintendo.com/v1/price?country=HK&ids=${batch.join(',')}&lang=zh`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0',
              'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(8000),
          }
        );

        if (!priceRes.ok) {
          console.log(`[Step2] 批次 ${i} 回應 ${priceRes.status}`);
          continue;
        }

        const priceData = await priceRes.json();

        for (const p of priceData.prices || []) {
          if (p.sales_status === 'onsale' && p.discount_price) {
            const id = String(p.title_id);
            const game = gameMap[id];
            if (!game) continue;

            const saleAmt = parseFloat(p.discount_price.raw_value || 0);
            const origAmt = parseFloat(p.regular_price?.raw_value || 0);
            if (saleAmt <= 0 || origAmt <= 0) continue;

            const discount = Math.round((1 - saleAmt / origAmt) * 100);
            if (discount <= 0) continue;

            // 算特價截止天數
            const endDt = p.discount_price.end_datetime;
            const expiresIn = endDt
              ? Math.max(1, Math.ceil((new Date(endDt) - Date.now()) / 86400000))
              : 7;

            // 圖片：優先用 banner，再用 thumbnail
            const coverUrl =
              game.hero_banner_url ||
              game.banner_url ||
              game.image_url ||
              (game.screenshots && game.screenshots[0]) ||
              null;

            onSaleGames.push({
              id,
              formal_name: game.formal_name || game.title || '',
              description: game.description || game.catch_copy || '',
              hero_banner_url: coverUrl,
              genre: game.genre || game.category || '',
              is_new: game.is_new || false,
              price: {
                regular_price: p.regular_price,
                discount_price: p.discount_price,
              },
              _discount: discount,
              _salePrice: saleAmt,
              _origPrice: origAmt,
              _expiresIn: expiresIn,
            });
          }
        }
      } catch (e) {
        console.log(`[Step2] 批次 ${i} 錯誤: ${e.message}`);
      }
    }

    // 依折扣排序
    onSaleGames.sort((a, b) => b._discount - a._discount);
    console.log(`[Step2] 找到 ${onSaleGames.length} 款特價遊戲`);

    if (onSaleGames.length >= 1) {
      return res.status(200).json({
        contents: onSaleGames,
        total: onSaleGames.length,
        source: 'hk-json+price-api',
      });
    }

    // ── Step 3：HK 失敗，改查 TW 區 ──────────────────────────
    console.log('[Step3] 改查 TW 區...');
    const twOnSale = await queryPriceForCountry('TW', allIds, gameMap);
    if (twOnSale.length >= 1) {
      return res.status(200).json({ contents: twOnSale, total: twOnSale.length, source: 'tw-price-api' });
    }

    throw new Error('所有方法都找不到特價遊戲');

  } catch (err) {
    console.error('[sales] 最終錯誤:', err.message);
    return res.status(200).json({
      contents: [],
      total: 0,
      source: 'error',
      error: err.message,
    });
  }
}

async function queryPriceForCountry(country, allIds, gameMap) {
  const results = [];
  const BATCH = 50;
  for (let i = 0; i < allIds.length && i < 1000; i += BATCH) {
    const batch = allIds.slice(i, i + BATCH);
    try {
      const res = await fetch(
        `https://api.ec.nintendo.com/v1/price?country=${country}&ids=${batch.join(',')}&lang=zh`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) continue;
      const data = await res.json();
      for (const p of data.prices || []) {
        if (p.sales_status === 'onsale' && p.discount_price) {
          const game = gameMap[String(p.title_id)];
          if (!game) continue;
          const saleAmt = parseFloat(p.discount_price.raw_value || 0);
          const origAmt = parseFloat(p.regular_price?.raw_value || 0);
          if (saleAmt <= 0 || origAmt <= 0) continue;
          const discount = Math.round((1 - saleAmt / origAmt) * 100);
          const expiresIn = p.discount_price.end_datetime
            ? Math.max(1, Math.ceil((new Date(p.discount_price.end_datetime) - Date.now()) / 86400000))
            : 7;
          results.push({
            id: String(p.title_id),
            formal_name: game.formal_name || game.title || '',
            description: game.description || game.catch_copy || '',
            hero_banner_url: game.hero_banner_url || game.banner_url || null,
            genre: game.genre || '',
            price: { regular_price: p.regular_price, discount_price: p.discount_price },
            _discount: discount, _salePrice: saleAmt, _origPrice: origAmt, _expiresIn: expiresIn,
          });
        }
      }
    } catch (e) { /* 繼續 */ }
  }
  results.sort((a, b) => b._discount - a._discount);
  return results;
}
