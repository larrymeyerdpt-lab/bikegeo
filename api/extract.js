// api/extract.js — BikeGeo file upload extraction endpoint
// Accepts base64 PDF or image, passes to Claude Vision for geometry extraction

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { base64, mediaType, brand, model, year } = req.body;
  if (!base64 || !mediaType) return res.status(400).json({ error: 'base64 and mediaType required' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });

  const isPDF = mediaType === 'application/pdf';

  const textPrompt = `Extract the complete bicycle geometry table from this ${isPDF ? 'PDF spec sheet' : 'image'}.

Bike context: ${[year, brand, model].filter(Boolean).join(' ') || 'Unknown — infer from document'}

Return ONLY valid JSON, no markdown, no explanation:
{
  "brand": "string",
  "model": "string",
  "year": "string",
  "category": "Road|Gravel|Mountain|Cyclocross|Triathlon/TT",
  "source_url": "",
  "fetch_method": "upload",
  "sizes": ["XS","S","M","L","XL"],
  "geometry": {
    "stack":              {},
    "reach":              {},
    "head_tube_angle":    {},
    "seat_tube_angle":    {},
    "effective_top_tube": {},
    "head_tube_length":   {},
    "chainstay":          {},
    "bb_drop":            {},
    "wheelbase":          {},
    "fork_rake":          {},
    "trail":              {}
  },
  "notes": "string — note measurement methodology, any fields that were ambiguous, or missing data",
  "data_confidence": "high|medium|low"
}

All linear measurements in mm. Angles in degrees. null for missing fields.
data_confidence should be "high" if the document clearly shows a geometry table.`;

  const fileBlock = isPDF
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image',    source: { type: 'base64', media_type: mediaType, data: base64 } };

  try {
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
        messages: [{
          role: 'user',
          content: [ fileBlock, { type: 'text', text: textPrompt } ]
        }]
      })
    });

    if (!claudeResp.ok) throw new Error('Claude API error: ' + claudeResp.status);

    const claudeData = await claudeResp.json();
    const rawText = claudeData.content.map(c => c.text || '').join('').trim();

    let geoJson;
    try {
      geoJson = JSON.parse(rawText.replace(/```json|```/g, '').trim());
    } catch {
      throw new Error('Claude returned invalid JSON');
    }

    return res.status(200).json({ success: true, data: geoJson });

  } catch (err) {
    console.error('[BikeGeo Extract]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
