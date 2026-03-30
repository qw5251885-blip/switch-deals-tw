// api/sales.js — TW + HK 合併特價，圖片透過 proxy 回傳

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Step 1: 抓 HK 遊戲列表（含圖片）
    console.log('[Step1] 抓 HK 遊戲列表...');
    const r = await fetch('https://www.nintendo.com.hk/data/json/switch_software.json', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://www.nintendo.com.hk/',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw new Error(`HK JSON ${r.status}`);
    const rawList = await r.json();

    // 建立 nsuid → 遊戲資料對照表
    const gameMap = {};
    for (const g of rawList) {
      if (!g.thumb_img) continue;
      const nsuid = g.thumb_img.replace(/\.[^.]+$/, '');
      if (!/^\d{14}$/.test(nsuid)) continue;
      if (!gameMap[nsuid]) {
        gameMap[nsuid] = {
          nsuid,
          name: g.title || '',
          // 圖片路徑存相對格式，讓前端透過 /api/img?id=xxx 取得（避免 hotlink 問題）
          imgNsuid: nsuid,
          imgExt: g.thumb_img.match(/\.(\w+)$/)?.[1] || 'jpeg',
          hkLink: g.link?.startsWith('http') ? g.link : `https://store.nintendo.com.hk/${nsuid}`,
        };
      }
    }

    const nsuids = Object.keys(gameMap);
    console.log(`[Step1] ${nsuids.length} 款遊戲`);

    // Step 2: 同時查 TW + HK 特價
    console.log('[Step2] 查 TW + HK 特價...');
    const [twR, hkR] = await Promise.allSettled([
      queryPrice('TW', nsuids, gameMap, 'zh'),
      queryPrice('HK', nsuids, gameMap, 'zh'),
    ]);

    const twSales = twR.status === 'fulfilled' ? twR.value : [];
    const hkSales = hkR.status === 'fulfilled' ? hkR.value : [];
    console.log(`[Step2] TW:${twSales.length} HK:${hkSales.length}`);

    // 合併：TW 優先，HK 補上 TW 沒有的
    const twIds = new Set(twSales.map(g => g.id));
    const hkOnly = hkSales.filter(g => !twIds.has(g.id));
    const combined = [...twSales, ...hkOnly].sort((a, b) => b._discount - a._discount);

    console.log(`[Step2] 合併後 ${combined.length} 款`);
    return res.status(200).json({ contents: combined, total: combined.length, source: `TW:${twSales.length}+HK:${hkOnly.length}` });

  } catch (err) {
    console.error('[sales] 錯誤:', err.message);
    return res.status(200).json({ contents: [], total: 0, source: 'error', error: err.message });
  }
}

async function queryPrice(country, nsuids, gameMap, lang) {
  const onSale = [];
  for (let i = 0; i < nsuids.length; i += 50) {
    const batch = nsuids.slice(i, i + 50);
    try {
      const res = await fetch(
        `https://api.ec.nintendo.com/v1/price?country=${country}&ids=${batch.join(',')}&lang=${lang}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) continue;
      const data = await res.json();
      for (const p of data.prices || []) {
        if (p.sales_status !== 'onsale' || !p.discount_price) continue;
        const nsuid = String(p.title_id);
        const game  = gameMap[nsuid];
        if (!game) continue;
        const sale = parseFloat(p.discount_price.raw_value || 0);
        const orig = parseFloat(p.regular_price?.raw_value || 0);
        if (sale <= 0 || orig <= 0) continue;
        const disc = Math.round((1 - sale / orig) * 100);
        if (disc <= 0) continue;
        const end = p.discount_price.end_datetime;
        onSale.push({
          id:              nsuid,
          formal_name:     game.name,
          // 圖片用 /api/img proxy 路由，避免 hotlink 問題
          hero_banner_url: `/api/img?id=${game.imgNsuid}&ext=${game.imgExt}`,
          description:     '',
          genre:           '',
          _discount:       disc,
          _salePrice:      sale,
          _origPrice:      orig,
          _expiresIn:      end ? Math.max(1, Math.ceil((new Date(end) - Date.now()) / 86400000)) : 7,
          _country:        country,
          _eshopLink:      country === 'TW'
            ? `https://ec.nintendo.com/TW/zh/titles/${nsuid}`
            : game.hkLink,
          price: { regular_price: p.regular_price, discount_price: p.discount_price },
        });
      }
    } catch (e) { /* 繼續 */ }
  }
  return onSale.sort((a, b) => b._discount - a._discount);
}
