// api/sales.js
// Vercel Serverless Function — 作為 Nintendo eShop API 的 Proxy
// 部署到 Vercel 後，網址會是：https://你的網站.vercel.app/api/sales

export default async function handler(req, res) {
  // 允許任何來源存取（CORS）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=3600'); // 快取 1 小時

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const count = req.query.count || 50;
  const offset = req.query.offset || 0;

  // Nintendo eShop 台灣區（使用 HK/zh 端點，台灣 eShop 與香港共用）
  const NINTENDO_URL = `https://ec.nintendo.com/api/HK/zh/search/sales?count=${count}&offset=${offset}`;

  try {
    const response = await fetch(NINTENDO_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SwitchDealsBot/1.0)',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Nintendo API 回應錯誤: ${response.status}`);
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (error) {
    console.error('Proxy 錯誤:', error.message);
    return res.status(502).json({
      error: 'Nintendo API 暫時無法存取',
      message: error.message,
    });
  }
}
