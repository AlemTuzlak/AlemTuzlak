// scripts/update-youtube-readme.mjs
import fs from "node:fs/promises";

const FEED_URL =
  "https://www.youtube.com/feeds/videos.xml?channel_id=UCQVWDtZHhWTDEtr-7bAgKqg";

const README_PATH = "README.md";
const START = "<!-- YOUTUBE:START -->";
const END = "<!-- YOUTUBE:END -->";

const MAX_VIDEOS = Number(process.env.MAX_VIDEOS ?? 6);

function extractVideoIdFromLink(link) {
  // RSS link is usually like: https://www.youtube.com/watch?v=VIDEO_ID
  const url = new URL(link);
  return url.searchParams.get("v");
}

function formatDate(iso) {
  // Keep it stable and readable in GitHub: YYYY-MM-DD
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function escapeMd(text) {
  // basic markdown escaping to avoid breaking formatting
  return String(text)
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .trim();
}

async function fetchFeedXml() {
  const res = await fetch(FEED_URL, { headers: { "user-agent": "github-action" } });
  if (!res.ok) {
    throw new Error(`Failed to fetch RSS feed: ${res.status} ${res.statusText}`);
  }
  return await res.text();
}

/**
 * Minimal RSS parsing without extra dependencies.
 * YouTube feed is Atom XML; entries look like:
 * <entry>
 *   <title>...</title>
 *   <link rel="alternate" href="..."/>
 *   <published>...</published>
 * </entry>
 */
function parseEntries(xml) {
  const entries = [];
  const entryBlocks = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  for (const block of entryBlocks) {
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch = block.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"[^>]*\/?>/);
    const publishedMatch = block.match(/<published>([\s\S]*?)<\/published>/);

    const title = titleMatch?.[1]?.replaceAll("&amp;", "&").replaceAll("&quot;", '"') ?? "";
    const link = linkMatch?.[1] ?? "";
    const published = publishedMatch?.[1] ?? "";

    if (!title || !link) continue;
    entries.push({ title, link, published });
  }
  return entries;
}

function renderMarkdown(entries) {
  const items = entries.slice(0, MAX_VIDEOS).map((e) => {
    const vid = extractVideoIdFromLink(e.link);
    const date = formatDate(e.published);
    const safeTitle = escapeMd(e.title);

    // Thumbnail URL (no API key required)
    const thumb = vid ? `https://img.youtube.com/vi/${vid}/hqdefault.jpg` : "";

    if (thumb && vid) {
      return [
        `- [![${safeTitle}](${thumb})](${e.link})`,
        `  **${safeTitle}**${date ? ` — ${date}` : ""}`,
      ].join("\n");
    }

    // Fallback (should rarely happen)
    return `- [${safeTitle}](${e.link})${date ? ` — ${date}` : ""}`;
  });

  return items.join("\n\n");
}

function replaceSection(readme, replacement) {
  const startIdx = readme.indexOf(START);
  const endIdx = readme.indexOf(END);

  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `Markers not found or invalid. Ensure README contains:\n${START}\n...\n${END}`
    );
  }

  const before = readme.slice(0, startIdx + START.length);
  const after = readme.slice(endIdx);

  return `${before}\n\n${replacement}\n\n${after}`;
}

async function main() {
  const xml = await fetchFeedXml();
  const entries = parseEntries(xml);

  if (entries.length === 0) {
    throw new Error("No entries parsed from the feed. The feed format may have changed.");
  }

  const newSection = renderMarkdown(entries);
  const readme = await fs.readFile(README_PATH, "utf8");
  const updated = replaceSection(readme, newSection);

  if (updated === readme) {
    console.log("README unchanged.");
    return;
  }

  await fs.writeFile(README_PATH, updated, "utf8");
  console.log("README updated successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
