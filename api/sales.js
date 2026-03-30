// api/sales.js — 抓所有遊戲 + 標示特價 + 用 eshop-prices 圖片

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Step 1: HK 完整遊戲列表
    console.log('[S1] 抓 HK 遊戲列表...');
    const r = await fetch('https://www.nintendo.com.hk/data/json/switch_software.json', {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.nintendo.com.hk/' },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw new Error(`HK JSON ${r.status}`);
    const rawList = await r.json();

    // 從 thumb_img 取 nsuid，建立遊戲表（去除重複）
    const gameMap = {};
    for (const g of rawList) {
      if (!g.thumb_img) continue;
      const nsuid = g.thumb_img.replace(/\.[^.]+$/, '');
      if (!/^\d{14}$/.test(nsuid)) continue;
      if (!gameMap[nsuid]) {
        gameMap[nsuid] = {
          nsuid,
          name: g.title || '',
          // eshop-prices.com 提供穩定的遊戲封面圖
          imgUrl: `https://images.eshop-prices.com/games/${nsuid}/50w.jpeg`,
          hkLink: g.link?.startsWith('http') ? g.link : `https://store.nintendo.com.hk/${nsuid}`,
        };
      }
    }
    const nsuids = Object.keys(gameMap);
    console.log(`[S1] ${nsuids.length} 款遊戲`);

    // Step 2: 同時查 HK + TW 的所有價格（不限特價）
    console.log('[S2] 查詢所有遊戲價格...');
    const allGames = [];
    const BATCH = 50;

    // 先查 TW，再查 HK 補充
    for (const country of ['TW', 'HK']) {
      for (let i = 0; i < nsuids.length; i += BATCH) {
        const batch = nsuids.slice(i, i + BATCH);
        try {
          const pr = await fetch(
            `https://api.ec.nintendo.com/v1/price?country=${country}&ids=${batch.join(',')}&lang=zh`,
            { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }
          );
          if (!pr.ok) continue;
          const pd = await pr.json();

          for (const p of pd.prices || []) {
            const nsuid = String(p.title_id);
            const game = gameMap[nsuid];
            if (!game) continue;
            if (p.sales_status === 'not_found') continue;

            const origAmt = parseFloat(p.regular_price?.raw_value || 0);
            if (origAmt <= 0) continue;

            const isOnSale = p.sales_status === 'onsale' && p.discount_price;
            const saleAmt = isOnSale ? parseFloat(p.discount_price.raw_value || 0) : origAmt;
            const discount = isOnSale ? Math.round((1 - saleAmt / origAmt) * 100) : 0;
            const end = p.discount_price?.end_datetime;

            // 只加一次（TW 優先）
            const existing = allGames.find(g => g.id === nsuid);
            if (existing) {
              // 如果 TW 有特價但 HK 沒有，更新
              if (country === 'TW' && isOnSale && !existing.onSale) {
                existing.onSale = true;
                existing.salePrice = saleAmt;
                existing.discount = discount;
                existing.country = 'TW';
                existing.eshopLink = `https://ec.nintendo.com/TW/zh/titles/${nsuid}`;
              }
              continue;
            }

            allGames.push({
              id: nsuid,
              formal_name: game.name,
              hero_banner_url: game.imgUrl,
              description: '',
              genre: '',
              onSale: isOnSale,
              _discount: discount,
              _salePrice: saleAmt,
              _origPrice: origAmt,
              _expiresIn: end ? Math.max(1, Math.ceil((new Date(end) - Date.now()) / 86400000)) : 0,
              _country: country,
              _eshopLink: country === 'TW'
                ? `https://ec.nintendo.com/TW/zh/titles/${nsuid}`
                : game.hkLink,
              price: { regular_price: p.regular_price, discount_price: p.discount_price || null },
            });
          }
        } catch (e) { /* 繼續 */ }
      }
    }

    // 特價的排前面，其餘按名稱
    allGames.sort((a, b) => {
      if (a.onSale && !b.onSale) return -1;
      if (!a.onSale && b.onSale) return 1;
      return b._discount - a._discount;
    });

    const onSaleCount = allGames.filter(g => g.onSale).length;
    console.log(`[S2] 共 ${allGames.length} 款，其中 ${onSaleCount} 款特價`);

    return res.status(200).json({
      contents: allGames,
      total: allGames.length,
      onSaleCount,
      source: 'all-games',
    });

  } catch (err) {
    console.error('[sales]', err.message);
    return res.status(200).json({ contents: [], total: 0, error: err.message });
  }
}
