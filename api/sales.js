// api/sales.js — HK 為主 + TW 補充，全量抓特價

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Step 1: HK 遊戲列表（含圖片 nsuid）
    console.log('[S1] 抓 HK JSON...');
    const r = await fetch('https://www.nintendo.com.hk/data/json/switch_software.json', {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.nintendo.com.hk/' },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw new Error(`HK JSON ${r.status}`);
    const rawList = await r.json();

    // 建立 nsuid 對照表，從 thumb_img 欄位取得 nsuid
    const gameMap = {};
    for (const g of rawList) {
      if (!g.thumb_img) continue;
      const nsuid = g.thumb_img.replace(/\.[^.]+$/, '');
      if (!/^\d{14}$/.test(nsuid)) continue;
      if (!gameMap[nsuid]) {
        gameMap[nsuid] = {
          nsuid,
          name: g.title || '',
          ext: g.thumb_img.split('.').pop() || 'jpeg',
          hkLink: g.link?.startsWith('http') ? g.link : `https://store.nintendo.com.hk/${nsuid}`,
        };
      }
    }
    const nsuids = Object.keys(gameMap);
    console.log(`[S1] ${nsuids.length} 款遊戲`);

    // Step 2: 同時查 HK + TW，HK 為主（遊戲多），TW 補自己特有的特價
    console.log('[S2] 查 HK + TW 特價...');
    const [hkR, twR] = await Promise.allSettled([
      queryPrice('HK', nsuids, gameMap),
      queryPrice('TW', nsuids, gameMap),
    ]);
    const hkSales = hkR.status === 'fulfilled' ? hkR.value : [];
    const twSales = twR.status === 'fulfilled' ? twR.value : [];
    console.log(`[S2] HK:${hkSales.length} TW:${twSales.length}`);

    // HK 為主，TW 有比 HK 便宜的同款遊戲就換成 TW 價格
    const hkMap = {};
    for (const g of hkSales) hkMap[g.id] = g;

    for (const tw of twSales) {
      if (!hkMap[tw.id]) {
        // TW 獨有的特價，直接加入
        hkSales.push(tw);
      } else if (tw._salePrice < hkMap[tw.id]._salePrice) {
        // TW 比 HK 便宜，換成 TW 的資料
        const idx = hkSales.findIndex(g => g.id === tw.id);
        if (idx >= 0) hkSales[idx] = tw;
      }
    }

    hkSales.sort((a, b) => b._discount - a._discount);
    console.log(`[S2] 合併後 ${hkSales.length} 款`);
    return res.status(200).json({ contents: hkSales, total: hkSales.length, source: `HK:${hkSales.length}` });

  } catch (err) {
    console.error('[sales]', err.message);
    return res.status(200).json({ contents: [], total: 0, error: err.message });
  }
}

async function queryPrice(country, nsuids, gameMap) {
  const onSale = [];
  for (let i = 0; i < nsuids.length; i += 50) {
    const batch = nsuids.slice(i, i + 50);
    try {
      const res = await fetch(
        `https://api.ec.nintendo.com/v1/price?country=${country}&ids=${batch.join(',')}&lang=zh`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) continue;
      const data = await res.json();
      for (const p of data.prices || []) {
        if (p.sales_status !== 'onsale' || !p.discount_price) continue;
        const nsuid = String(p.title_id);
        const game = gameMap[nsuid];
        if (!game) continue;
        const sale = parseFloat(p.discount_price.raw_value || 0);
        const orig = parseFloat(p.regular_price?.raw_value || 0);
        if (sale <= 0 || orig <= 0) continue;
        const disc = Math.round((1 - sale / orig) * 100);
        if (disc <= 0) continue;
        const end = p.discount_price.end_datetime;
        onSale.push({
          id: nsuid,
          formal_name: game.name,
          // 圖片透過 /api/img proxy 送出，繞過 hotlink 保護
          hero_banner_url: `/api/img?id=${nsuid}&ext=${game.ext}`,
          description: '', genre: '',
          _discount: disc, _salePrice: sale, _origPrice: orig,
          _expiresIn: end ? Math.max(1, Math.ceil((new Date(end) - Date.now()) / 86400000)) : 7,
          _country: country,
          _eshopLink: country === 'TW'
            ? `https://ec.nintendo.com/TW/zh/titles/${nsuid}`
            : game.hkLink,
          price: { regular_price: p.regular_price, discount_price: p.discount_price },
        });
      }
    } catch (e) { /* 繼續下一批 */ }
  }
  return onSale.sort((a, b) => b._discount - a._discount);
}
