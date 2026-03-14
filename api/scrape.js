// api/scrape.js — BikeGeo serverless scraping endpoint
// Vercel serverless function: finds manufacturer geometry page,
// fetches it, passes content to Claude Vision for extraction.

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { brand, model, year } = req.body;
  if (!brand || !model) return res.status(400).json({ error: 'Brand and model required' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const BRAVE_KEY     = process.env.BRAVE_SEARCH_API_KEY;

  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY env var' });

  try {
    let pageContent = null;
    let sourceUrl   = null;
    let fetchMethod = 'knowledge';

    // ── Step 1: Find the geometry URL via Brave Search ──────────────
    if (BRAVE_KEY) {
      const query = `${year || ''} ${brand} ${model} geometry specifications site:${brandDomain(brand)} OR "${brand}" "${model}" geometry chart mm`.trim();
      console.log('[BikeGeo] Brave search query:', query);

      const searchResp = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
        { headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_KEY } }
      );

      if (searchResp.ok) {
        const searchData = await searchResp.json();
        const results = searchData?.web?.results || [];

        // Pick best result — prefer manufacturer domain
        const domain = brandDomain(brand);
        const best = results.find(r => domain && r.url.includes(domain))
                  || results.find(r => r.url.includes(brand.toLowerCase().replace(/\s/g,'')))
                  || results[0];

        if (best) {
          sourceUrl = best.url;
          console.log('[BikeGeo] Best URL:', sourceUrl);

          // ── Step 2: Fetch the page ────────────────────────────────
          const pageResp = await fetch(sourceUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; BikeGeoBot/1.0)',
              'Accept': 'text/html,application/xhtml+xml',
            },
            signal: AbortSignal.timeout(8000)
          });

          if (pageResp.ok) {
            const html = await pageResp.text();
            // Strip scripts/styles, keep text content
            pageContent = stripHtml(html).slice(0, 12000); // Claude context limit friendly
            fetchMethod = 'live_scrape';
            console.log('[BikeGeo] Page fetched, length:', pageContent.length);
          }
        }
      }
    }

    // ── Step 3: Pass to Claude ──────────────────────────────────────
    const userContent = pageContent
      ? `Here is the scraped text content from ${sourceUrl}:\n\n${pageContent}\n\nExtract the geometry table for the ${year || ''} ${brand} ${model}.`
      : `Using your training knowledge, provide the geometry for the ${year || ''} ${brand} ${model}.`;

    const systemPrompt = `You are a bicycle geometry expert for a professional bike fitting lab (BUILD Sports Performance Lab, Louisville CO).

Extract or provide complete geometry data and return ONLY valid JSON — no markdown fences, no explanation, nothing else.

JSON structure:
{
  "brand": "string",
  "model": "string",
  "year": "string",
  "category": "Road|Gravel|Mountain|Cyclocross|Triathlon/TT",
  "source_url": "string",
  "fetch_method": "live_scrape|knowledge",
  "sizes": ["XS","S","M","L","XL"],
  "geometry": {
    "stack":              { "XS": 510, "S": 525 },
    "reach":              { "XS": 368, "S": 380 },
    "head_tube_angle":    { "XS": 71.5 },
    "seat_tube_angle":    { "XS": 74.0 },
    "effective_top_tube": { "XS": 530 },
    "head_tube_length":   { "XS": 100 },
    "chainstay":          { "XS": 408 },
    "bb_drop":            { "XS": 70  },
    "wheelbase":          { "XS": 970 },
    "fork_rake":          { "XS": 45  },
    "trail":              { "XS": 58  }
  },
  "notes": "string",
  "data_confidence": "high|medium|low"
}

Rules:
- All linear measurements in mm. Angles in degrees.
- Use null for unknown fields.
- Set data_confidence: "high" if from live scraped data, "medium" if from reliable training knowledge, "low" if estimated.
- In notes: flag any measurement methodology differences (c-c vs c-t seat tube, etc), missing fields, or caveats.`;

    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }]
      })
    });

    if (!claudeResp.ok) {
      const err = await claudeResp.text();
      throw new Error('Claude API error: ' + err);
    }

    const claudeData = await claudeResp.json();
    const rawText = claudeData.content.map(c => c.text || '').join('').trim();

    let geoJson;
    try {
      geoJson = JSON.parse(rawText.replace(/```json|```/g, '').trim());
    } catch {
      throw new Error('Claude returned invalid JSON: ' + rawText.slice(0, 200));
    }

    // Inject fetch metadata
    geoJson.source_url   = geoJson.source_url || sourceUrl || '';
    geoJson.fetch_method = fetchMethod;

    return res.status(200).json({ success: true, data: geoJson });

  } catch (err) {
    console.error('[BikeGeo] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

// Known brand domains for smarter search targeting
function brandDomain(brand) {
  const map = {
    'trek': 'trekbikes.com',
    'specialized': 'specialized.com',
    'giant': 'giant-bicycles.com',
    'canyon': 'canyon.com',
    'cervelo': 'cervelo.com',
    'scott': 'scott-sports.com',
    'pinarello': 'pinarello.com',
    'bmc': 'bmc-switzerland.com',
    'cannondale': 'cannondale.com',
    'colnago': 'colnago.com',
    'bianchi': 'bianchi.com',
    'orbea': 'orbea.com',
    'ridley': 'ridley-bikes.com',
    'santa cruz': 'santacruzbicycles.com',
    'yeti': 'yeticycles.com',
    'pivot': 'pivotcycles.com',
    'felt': 'feltbicycles.com',
    'argon 18': 'argon18bike.com',
    'factor': 'factorbikes.com',
    'allied': 'alliedcycleworks.com',
    'salsa': 'salsacycles.com',
    'niner': 'ninerbikes.com',
    'wilier': 'wilier.com',
    'look': 'lookcycle.com',
  };
  return map[brand.toLowerCase()] || null;
}

// Strip HTML to readable text
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}
