// api/img.js — Nintendo 圖片 Proxy（繞過 hotlink 保護）
// 用法：/api/img?id=70010000050752&ext=jpeg

export default async function handler(req, res) {
  const { id, ext = 'jpeg' } = req.query || {};
  if (!id || !/^\d{14}$/.test(id)) return res.status(400).end();

  // 圖片快取 24 小時
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // 嘗試多個 Nintendo CDN 格式
  const urls = [
    `https://img-eshop.cdn.nintendo.net/i/${id}.${ext}`,
    `https://img-eshop.cdn.nintendo.net/i/${id}.jpg`,
    `https://img-eshop.cdn.nintendo.net/i/${id}.jpeg`,
  ];

  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Referer': 'https://www.nintendo.com.hk/',
    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Accept-Language': 'zh-TW,zh;q=0.9',
    'sec-fetch-dest': 'image',
    'sec-fetch-mode': 'no-cors',
    'sec-fetch-site': 'cross-site',
  };

  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const contentType = r.headers.get('content-type') || 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      const buf = await r.arrayBuffer();
      return res.status(200).send(Buffer.from(buf));
    } catch (e) { /* 嘗試下一個 */ }
  }

  // 全部失敗：回傳 1x1 透明 PNG（不顯示破圖）
  const EMPTY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  res.setHeader('Content-Type', 'image/png');
  return res.status(200).send(EMPTY_PNG);
}
