// api/sales.js — 升級版 Nintendo eShop Proxy
// 同時抓台灣(HK)、美國(US)特價遊戲，並補充圖片
// 部署到 Vercel 後網址：/api/sales

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ─── 策略：同時抓 HK(台灣) 和 US 區，用 US 補圖片 ───
    const [hkResult, usResult] = await Promise.allSettled([
      fetchAllSales('HK', 'zh'),
      fetchAllSales('US', 'en'),
    ]);

    const hkList = hkResult.status === 'fulfilled' ? hkResult.value : [];
    const usList = usResult.status === 'fulfilled' ? usResult.value : [];

    // 用遊戲名稱建立 US 的圖片對照表
    const usImageMap = {};
    for (const g of usList) {
      const key = normalize(g.formal_name || '');
      if (key && g.hero_banner_url) usImageMap[key] = g.hero_banner_url;
    }

    // 合併：以 HK 區資料為主，從 US 補圖片
    const merged = hkList.map(g => {
      const key = normalize(g.formal_name || '');
      return {
        ...g,
        hero_banner_url: g.hero_banner_url || usImageMap[key] || null,
      };
    });

    // HK 沒資料就退回用 US 區
    const finalList = merged.length > 0 ? merged : usList;

    return res.status(200).json({
      contents: finalList,
      total: finalList.length,
      source: merged.length > 0 ? 'HK+US' : 'US-only',
    });

  } catch (err) {
    console.error('Proxy 錯誤:', err);
    return res.status(502).json({ error: err.message });
  }
}

// ─── 分頁抓完所有特價遊戲（最多 500 款）──────────────────
async function fetchAllSales(country, lang) {
  const results = [];
  const pageSize = 50;
  let offset = 0;
  let total = Infinity;

  while (offset < total && offset < 500) {
    const url = `https://ec.nintendo.com/api/${country}/${lang}/search/sales?count=${pageSize}&offset=${offset}`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': lang === 'zh' ? 'zh-TW,zh;q=0.9' : 'en-US,en;q=0.9',
        'Referer': `https://ec.nintendo.com/${country}/${lang}/`,
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) break;

    const data = await res.json();
    if (!data?.contents?.length) break;

    results.push(...data.contents);
    total = data.total ?? Infinity;
    offset += pageSize;

    if (data.contents.length < pageSize) break;
  }

  return results;
}

// 標準化名稱做跨區比對
function normalize(name) {
  return name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '').slice(0, 30);
}
