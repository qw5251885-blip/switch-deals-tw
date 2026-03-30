// api/sales.js — 使用 nintendo.com.hk JSON + api.ec.nintendo.com/v1/price
// 關鍵發現：
//   - HK JSON 的 nsuid 藏在 link 欄位（store.nintendo.com.hk/70010000XXXXX）
//   - 圖片用 img-eshop.cdn.nintendo.net/i/{nsuid}.jpg
//   - 只抓 media === 'eshop' 的數位版

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── Step 1: 抓 HK 遊戲列表 ────────────────────────────
    console.log('[Step1] 抓 HK JSON...');
    const r = await fetch('https://www.nintendo.com.hk/data/json/switch_software.json', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://www.nintendo.com.hk/',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw new Error(`HK JSON ${r.status}`);
    const raw = await r.json();

    // 只取數位版（media === 'eshop'），並從 link 中提取 nsuid
    const gameMap = {};
    for (const g of raw) {
      if (g.media !== 'eshop') continue;

      // 從 link 取出 nsuid：https://store.nintendo.com.hk/70010000050752
      const m = (g.link || '').match(/(\d{14})$/);
      if (!m) continue;
      const nsuid = m[1];

      // 圖片：Nintendo CDN 標準格式
      const imgBase = nsuid.startsWith('7007') ? null : `https://img-eshop.cdn.nintendo.net/i/${nsuid}.jpg`;

      gameMap[nsuid] = {
        nsuid,
        name: g.title || '',
        imgUrl: imgBase,
        link: g.link || '',
      };
    }

    const nsuids = Object.keys(gameMap);
    console.log(`[Step1] 找到 ${nsuids.length} 款數位遊戲`);
    if (!nsuids.length) throw new Error('沒有找到任何數位遊戲 ID');

    // ── Step 2: 批次查詢 HK 特價 ──────────────────────────
    console.log('[Step2] 查詢 HK 特價...');
    const onSale = [];
    const BATCH = 50;

    for (let i = 0; i < nsuids.length; i += BATCH) {
      const batch = nsuids.slice(i, i + BATCH);
      try {
        const pr = await fetch(
          `https://api.ec.nintendo.com/v1/price?country=HK&ids=${batch.join(',')}&lang=zh`,
          {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
            signal: AbortSignal.timeout(8000),
          }
        );
        if (!pr.ok) { console.log(`[Step2] batch ${i} → ${pr.status}`); continue; }

        const pd = await pr.json();
        for (const p of (pd.prices || [])) {
          if (p.sales_status !== 'onsale' || !p.discount_price) continue;

          const nsuid = String(p.title_id);
          const game  = gameMap[nsuid];
          if (!game) continue;

          const salePr = parseFloat(p.discount_price.raw_value || 0);
          const origPr = parseFloat(p.regular_price?.raw_value  || 0);
          if (salePr <= 0 || origPr <= 0) continue;

          const discount  = Math.round((1 - salePr / origPr) * 100);
          const endDt     = p.discount_price.end_datetime;
          const expiresIn = endDt
            ? Math.max(1, Math.ceil((new Date(endDt) - Date.now()) / 86400000))
            : 7;

          onSale.push({
            id:               nsuid,
            formal_name:      game.name,
            hero_banner_url:  game.imgUrl,
            genre:            '',
            description:      '',
            _discount:        discount,
            _salePrice:       salePr,
            _origPrice:       origPr,
            _expiresIn:       expiresIn,
            _currency:        p.discount_price.currency || 'TWD',
            _eshopLink:       game.link,
            price: {
              regular_price:  p.regular_price,
              discount_price: p.discount_price,
            },
          });
        }
      } catch (e) {
        console.log(`[Step2] batch ${i} error: ${e.message}`);
      }
    }

    onSale.sort((a, b) => b._discount - a._discount);
    console.log(`[Step2] 找到 ${onSale.length} 款特價`);

    if (onSale.length > 0) {
      return res.status(200).json({ contents: onSale, total: onSale.length, source: 'hk' });
    }

    // ── Step 3: HK 沒特價，改查 TW ───────────────────────
    console.log('[Step3] 改查 TW 特價...');
    const twSale = [];
    for (let i = 0; i < nsuids.length; i += BATCH) {
      const batch = nsuids.slice(i, i + BATCH);
      try {
        const pr = await fetch(
          `https://api.ec.nintendo.com/v1/price?country=TW&ids=${batch.join(',')}&lang=zh`,
          { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }
        );
        if (!pr.ok) continue;
        const pd = await pr.json();
        for (const p of (pd.prices || [])) {
          if (p.sales_status !== 'onsale' || !p.discount_price) continue;
          const nsuid  = String(p.title_id);
          const game   = gameMap[nsuid];
          if (!game) continue;
          const salePr = parseFloat(p.discount_price.raw_value || 0);
          const origPr = parseFloat(p.regular_price?.raw_value  || 0);
          if (salePr <= 0 || origPr <= 0) continue;
          const discount  = Math.round((1 - salePr / origPr) * 100);
          const endDt     = p.discount_price.end_datetime;
          const expiresIn = endDt ? Math.max(1, Math.ceil((new Date(endDt) - Date.now()) / 86400000)) : 7;
          twSale.push({
            id: nsuid, formal_name: game.name, hero_banner_url: game.imgUrl,
            genre: '', description: '',
            _discount: discount, _salePrice: salePr, _origPrice: origPr,
            _expiresIn: expiresIn, _currency: p.discount_price.currency || 'TWD',
            _eshopLink: game.link,
            price: { regular_price: p.regular_price, discount_price: p.discount_price },
          });
        }
      } catch (e) { /* 繼續 */ }
    }
    twSale.sort((a, b) => b._discount - a._discount);
    console.log(`[Step3] TW 找到 ${twSale.length} 款特價`);

    return res.status(200).json({
      contents: twSale,
      total:    twSale.length,
      source:   twSale.length > 0 ? 'tw' : 'none',
      error:    twSale.length === 0 ? 'no-sales-found' : undefined,
    });

  } catch (err) {
    console.error('[sales] 錯誤:', err.message);
    return res.status(200).json({ contents: [], total: 0, source: 'error', error: err.message });
  }
}
