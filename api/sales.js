// api/sales.js — 正確版本
// - 圖片從 thumb_img 欄位組 img-eshop.cdn.nintendo.net URL
// - 同時查 TW 和 HK 兩區特價，TW 優先
// - nsuid 從 thumb_img 檔名（去掉副檔名）取得

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── Step 1: 抓 HK 官網完整遊戲列表 ───────────────────
    console.log('[Step1] 抓 HK 遊戲列表...');
    const r = await fetch('https://www.nintendo.com.hk/data/json/switch_software.json', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://www.nintendo.com.hk/',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw new Error(`HK JSON 失敗 ${r.status}`);
    const rawList = await r.json();

    // 建立遊戲資料表
    // thumb_img = "70010000050752.jpeg" → nsuid = "70010000050752"
    // 圖片 = https://img-eshop.cdn.nintendo.net/i/70010000050752.jpeg
    const gameMap = {};
    for (const g of rawList) {
      if (!g.thumb_img) continue;
      const nsuid = g.thumb_img.replace(/\.[^.]+$/, ''); // 去副檔名
      if (!nsuid.match(/^\d{14}$/)) continue; // 只要 14 位數字的 nsuid

      // 避免重複（同一遊戲可能有 package 和 eshop 兩筆）
      if (!gameMap[nsuid]) {
        gameMap[nsuid] = {
          nsuid,
          name: g.title || '',
          imgUrl: `https://img-eshop.cdn.nintendo.net/i/${g.thumb_img}`,
          // eShop 連結：優先用 link，否則用 HK store 連結
          eshopLink: g.link && g.link.startsWith('http')
            ? g.link
            : `https://store.nintendo.com.hk/${nsuid}`,
        };
      }
    }

    const nsuids = Object.keys(gameMap);
    console.log(`[Step1] 找到 ${nsuids.length} 款遊戲（含 nsuid）`);
    if (!nsuids.length) throw new Error('沒有找到有效 nsuid');

    // ── Step 2: 同時查 TW 和 HK 特價 ─────────────────────
    console.log('[Step2] 查詢 TW + HK 特價...');
    const [twResult, hkResult] = await Promise.allSettled([
      queryPrice('TW', nsuids, gameMap),
      queryPrice('HK', nsuids, gameMap),
    ]);

    const twSales = twResult.status === 'fulfilled' ? twResult.value : [];
    const hkSales = hkResult.status === 'fulfilled' ? hkResult.value : [];
    console.log(`[Step2] TW: ${twSales.length} 款, HK: ${hkSales.length} 款`);

    // TW 優先；如果 TW 沒資料才用 HK
    let finalList = twSales.length > 0 ? twSales : hkSales;
    const source = twSales.length > 0 ? 'TW' : (hkSales.length > 0 ? 'HK' : 'none');

    // 在 TW 結果中，補上 HK 有但 TW 沒有的遊戲（不同區域可能有不同特價）
    if (twSales.length > 0 && hkSales.length > 0) {
      const twIds = new Set(twSales.map(g => g.id));
      const hkOnly = hkSales.filter(g => !twIds.has(g.id));
      finalList = [...twSales, ...hkOnly].sort((a, b) => b._discount - a._discount);
    }

    console.log(`[Step2] 最終回傳 ${finalList.length} 款，來源: ${source}`);
    return res.status(200).json({ contents: finalList, total: finalList.length, source });

  } catch (err) {
    console.error('[sales] 錯誤:', err.message);
    return res.status(200).json({ contents: [], total: 0, source: 'error', error: err.message });
  }
}

// ── 查詢指定國家的特價（批次查完所有 nsuid）─────────────────
async function queryPrice(country, nsuids, gameMap) {
  const onSale = [];
  const BATCH = 50;

  for (let i = 0; i < nsuids.length; i += BATCH) {
    const batch = nsuids.slice(i, i + BATCH);
    try {
      const res = await fetch(
        `https://api.ec.nintendo.com/v1/price?country=${country}&ids=${batch.join(',')}&lang=zh`,
        {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
          signal: AbortSignal.timeout(8000),
        }
      );
      if (!res.ok) { console.log(`[price] ${country} batch ${i} → ${res.status}`); continue; }

      const data = await res.json();
      for (const p of data.prices || []) {
        if (p.sales_status !== 'onsale' || !p.discount_price) continue;

        const nsuid = String(p.title_id);
        const game  = gameMap[nsuid];
        if (!game) continue;

        const salePr = parseFloat(p.discount_price.raw_value || 0);
        const origPr = parseFloat(p.regular_price?.raw_value || 0);
        if (salePr <= 0 || origPr <= 0) continue;

        const discount  = Math.round((1 - salePr / origPr) * 100);
        if (discount <= 0) continue;

        const endDt     = p.discount_price.end_datetime;
        const expiresIn = endDt
          ? Math.max(1, Math.ceil((new Date(endDt) - Date.now()) / 86400000))
          : 7;

        onSale.push({
          id:              nsuid,
          formal_name:     game.name,
          hero_banner_url: game.imgUrl,   // ← 正確的圖片 URL
          description:     '',
          genre:           '',
          _discount:       discount,
          _salePrice:      salePr,
          _origPrice:      origPr,
          _expiresIn:      expiresIn,
          _country:        country,
          _eshopLink:      game.eshopLink,
          price: {
            regular_price:  p.regular_price,
            discount_price: p.discount_price,
          },
        });
      }
    } catch (e) {
      console.log(`[price] ${country} batch ${i} 錯誤: ${e.message}`);
    }
  }

  onSale.sort((a, b) => b._discount - a._discount);
  return onSale;
}
