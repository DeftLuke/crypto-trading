/**
 * Web search — Serper.dev (Google) → SerpAPI → DuckDuckGo fallback.
 */
import { config } from '../config/index.js';

export async function webSearch(query, maxResults = 5) {
  if (config.search?.serperApiKey) {
    const r = await serperSearch(query, maxResults);
    if (r.results?.length) return r;
  }
  if (config.search?.serpApiKey) {
    const r = await serpApiSearch(query, maxResults);
    if (r.results?.length) return r;
  }
  return duckDuckGoSearch(query, maxResults);
}

async function serperSearch(query, maxResults) {
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': config.search.serperApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num: maxResults }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const results = (data.organic || []).slice(0, maxResults).map((r) => ({
      title: r.title,
      snippet: r.snippet,
      url: r.link,
    }));
    if (data.answerBox?.answer) {
      results.unshift({
        title: data.answerBox.title || 'Answer',
        snippet: data.answerBox.answer,
        url: data.answerBox.link || null,
      });
    }
    return { source: 'serper', query, results };
  } catch (err) {
    return { source: 'serper', query, results: [], error: err.message };
  }
}

async function duckDuckGoSearch(query, maxResults) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const data = await res.json();

    const snippets = [];
    if (data.AbstractText) {
      snippets.push({ title: data.Heading || query, snippet: data.AbstractText, url: data.AbstractURL });
    }
    for (const t of (data.RelatedTopics || []).slice(0, maxResults)) {
      if (t.Text) snippets.push({ title: t.Text.split(' - ')[0], snippet: t.Text, url: t.FirstURL });
      if (t.Topics) {
        for (const sub of t.Topics.slice(0, 2)) {
          if (sub.Text) snippets.push({ title: sub.Text.split(' - ')[0], snippet: sub.Text, url: sub.FirstURL });
        }
      }
    }
    return { source: 'duckduckgo', query, results: snippets.slice(0, maxResults) };
  } catch (err) {
    return { source: 'duckduckgo', query, results: [], error: err.message };
  }
}

async function serpApiSearch(query, maxResults) {
  try {
    const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${config.search.serpApiKey}&num=${maxResults}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const data = await res.json();
    const results = (data.organic_results || []).slice(0, maxResults).map((r) => ({
      title: r.title,
      snippet: r.snippet,
      url: r.link,
    }));
    return { source: 'serpapi', query, results };
  } catch (err) {
    return { source: 'serpapi', query, results: [], error: err.message };
  }
}

export function formatSearchResults(search) {
  if (search.error) return `Search failed: ${search.error}`;
  if (!search.results?.length) return `No web results for "${search.query}". Try rephrasing.`;
  let msg = `🔍 <b>${search.query}</b>\n\n`;
  for (const r of search.results.slice(0, 4)) {
    if (r.title && r.title !== r.snippet) msg += `<b>${r.title}</b>\n`;
    msg += `${(r.snippet || r.title)?.slice(0, 220)}\n`;
    if (r.url) msg += `${r.url}\n`;
    msg += '\n';
  }
  return msg.trim();
}
