# BikeGeo — BUILD Sports Performance Lab

On-demand bike geometry extraction tool. Searches manufacturer websites live, falls back to Claude's training knowledge. Supports PDF and image uploads.

## Project Structure

```
bikegeo/
├── api/
│   ├── scrape.js      ← Brave Search + live page fetch + Claude extraction
│   └── extract.js     ← PDF/image upload → Claude Vision extraction
├── public/
│   └── index.html     ← Frontend (single file, no build step)
├── vercel.json
└── package.json
```

## Deploy to Vercel

### 1. Push to GitHub
Create a new repo and push this folder.

### 2. Import to Vercel
- Go to vercel.com → Add New Project → Import your repo
- Framework preset: **Other**

### 3. Set Environment Variables
In Vercel project settings → Environment Variables, add:

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `BRAVE_SEARCH_API_KEY` | Your Brave Search API key (get free at api.search.brave.com) |

### 4. Deploy
Click Deploy. Done.

## How It Works

1. **Live scrape mode**: Brave Search finds the manufacturer geometry URL → server fetches the page → Claude extracts the geometry table
2. **Upload mode**: Staff uploads PDF spec sheet or screenshot → Claude Vision reads it directly
3. **Fallback**: If scraping fails (JS-rendered pages, etc.), Claude uses training knowledge and flags confidence as medium/low

## Environment Variables

- `ANTHROPIC_API_KEY` — required for all modes
- `BRAVE_SEARCH_API_KEY` — required for live scrape mode (free tier: 2,000 queries/month at api.search.brave.com/register)

## Notes

- Some manufacturer sites (Trek, Specialized) render geometry tables via JavaScript, which means the raw HTML fetch may not include the table. In that case, Claude falls back to training knowledge and flags `data_confidence: medium`.
- For maximum accuracy on any bike, upload the PDF spec sheet directly.
- Stack and reach are highlighted in the geometry table as the primary fit coordinates.

