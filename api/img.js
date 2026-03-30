// api/img.js — 圖片 Proxy
// 讓 Vercel 伺服器去抓 Nintendo CDN 圖片，繞過 hotlink 保護
// 用法：/api/img?id=70010000050752&ext=jpeg

export default async function handler(req, res) {
  const { id, ext = 'jpeg' } = req.query;

  if (!id || !/^\d{14}$/.test(id)) {
    return res.status(400).json({ error: 'invalid id' });
  }

  const imgUrl = `https://img-eshop.cdn.nintendo.net/i/${id}.${ext}`;

  try {
    const r = await fetch(imgUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://www.nintendo.com.hk/',
        'Accept': 'image/webp,image/jpeg,image/*',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!r.ok) {
      // 嘗試 jpg 副檔名
      const r2 = await fetch(imgUrl.replace(/\.\w+$/, '.jpg'), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Referer': 'https://www.nintendo.com.hk/',
        },
        signal: AbortSignal.timeout(6000),
      });
      if (!r2.ok) return res.status(404).end();
      
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const buf = await r2.arrayBuffer();
      return res.send(Buffer.from(buf));
    }

    const contentType = r.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 快取 24 小時
    const buf = await r.arrayBuffer();
    return res.send(Buffer.from(buf));

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
