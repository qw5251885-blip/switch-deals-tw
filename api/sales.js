// api/sales.js — 快速版：只查特價，平行批次，嚴格超時控制

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const startTime = Date.now();

  try {
    // Step 1: 抓 HK 遊戲列表
    console.log('[S1] 抓遊戲列表...');
    const r = await fetch('https://www.nintendo.com.hk/data/json/switch_software.json', {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.nintendo.com.hk/' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`HK JSON ${r.status}`);
    const rawList = await r.json();

    // 只取 eshop 數位版，建立 nsuid 表
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
    console.log(`[S1] ${nsuids.length} 款，耗時 ${Date.now()-startTime}ms`);

    // Step 2: 平行批次查詢 HK 價格（每批 50 個，全部平行發出）
    console.log('[S2] 平行查詢 HK 特價...');
    const BATCH = 50;
    const batches = [];
    for (let i = 0; i < nsuids.length; i += BATCH) {
      batches.push(nsuids.slice(i, i + BATCH));
    }

    // 全部批次同時發出，最多等 25 秒
    const batchResults = await Promise.allSettled(
      batches.map(batch =>
        fetch(`https://api.ec.nintendo.com/v1/price?country=HK&ids=${batch.join(',')}&lang=zh`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(20000),
        }).then(r => r.ok ? r.json() : null).catch(() => null)
      )
    );

    const onSale = [];
    for (const result of batchResults) {
      if (result.status !== 'fulfilled' || !result.value?.prices) continue;
      for (const p of result.value.prices) {
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
          // eshop-prices.com 圖片 CDN — 穩定可靠
          hero_banner_url: `https://images.eshop-prices.com/games/${nsuid}/50w.jpeg`,
          description: '', genre: '',
          _discount: disc, _salePrice: sale, _origPrice: orig,
          _expiresIn: end ? Math.max(1, Math.ceil((new Date(end) - Date.now()) / 86400000)) : 7,
          _country: 'HK',
          _eshopLink: game.hkLink,
          price: { regular_price: p.regular_price, discount_price: p.discount_price },
        });
      }
    }

    // 再查 TW（平行）
    console.log('[S3] 平行查詢 TW 特價...');
    const twResults = await Promise.allSettled(
      batches.map(batch =>
        fetch(`https://api.ec.nintendo.com/v1/price?country=TW&ids=${batch.join(',')}&lang=zh`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(20000),
        }).then(r => r.ok ? r.json() : null).catch(() => null)
      )
    );

    const hkIds = new Set(onSale.map(g => g.id));
    for (const result of twResults) {
      if (result.status !== 'fulfilled' || !result.value?.prices) continue;
      for (const p of result.value.prices) {
        if (p.sales_status !== 'onsale' || !p.discount_price) continue;
        const nsuid = String(p.title_id);
        if (hkIds.has(nsuid)) continue; // HK 已有，跳過
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
          hero_banner_url: `https://images.eshop-prices.com/games/${nsuid}/50w.jpeg`,
          description: '', genre: '',
          _discount: disc, _salePrice: sale, _origPrice: orig,
          _expiresIn: end ? Math.max(1, Math.ceil((new Date(end) - Date.now()) / 86400000)) : 7,
          _country: 'TW',
          _eshopLink: `https://ec.nintendo.com/TW/zh/titles/${nsuid}`,
          price: { regular_price: p.regular_price, discount_price: p.discount_price },
        });
      }
    }

    onSale.sort((a, b) => b._discount - a._discount);
    const elapsed = Date.now() - startTime;
    console.log(`[完成] ${onSale.length} 款特價，耗時 ${elapsed}ms`);

    return res.status(200).json({ contents: onSale, total: onSale.length, source: 'HK+TW', elapsed });

  } catch (err) {
    console.error('[sales]', err.message);
    return res.status(200).json({ contents: [], total: 0, error: err.message });
  }
}
