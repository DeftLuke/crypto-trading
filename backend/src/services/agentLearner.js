/**
 * Self-learning agent — web search with rate limiting (protect SERP API quota).
 */
import { webSearch, formatSearchResults } from './webSearch.js';
import { saveMemory, getMemories } from './agentMemory.js';
import { callN8nWebhook } from './n8n.js';
import { config } from '../config/index.js';

const SYSTEM_CHAT_ID = 0;
const MAX_SEARCHES_PER_HOUR = parseInt(process.env.MAX_AGENT_SEARCHES_PER_HOUR || '5', 10);
const searchTimestamps = [];

export function canSearch() {
  const hourAgo = Date.now() - 3600000;
  searchTimestamps.splice(0, searchTimestamps.length, ...searchTimestamps.filter((t) => t > hourAgo));
  return searchTimestamps.length < MAX_SEARCHES_PER_HOUR;
}

export async function agentLearn(topic, reason = 'agent_request') {
  if (!canSearch()) {
    return {
      learned: false,
      message: 'Search quota reached this hour. Using existing knowledge.',
    };
  }

  searchTimestamps.push(Date.now());

  if (config.n8n.baseUrl) {
    try {
      const webhookUrl = `${config.n8n.baseUrl}/webhook/agent-learn`;
      const n8nResult = await callN8nWebhook(webhookUrl, { topic, reason });
      if (n8nResult?.results?.length) {
        const summary = n8nResult.summary || JSON.stringify(n8nResult.results.slice(0, 3));
        await saveMemory(SYSTEM_CHAT_ID, `[${topic}] ${summary}`, 'note');
        return { learned: true, source: 'n8n', summary };
      }
    } catch {
      /* fallback */
    }
  }

  const search = await webSearch(`smart money concepts trading ${topic}`, 4);
  if (!search.results?.length) {
    return { learned: false, message: 'No search results found.' };
  }

  const summary = search.results.map((r) => r.snippet).join('\n').slice(0, 800);
  await saveMemory(SYSTEM_CHAT_ID, `[Learned: ${topic}] ${summary}`, 'note');

  return {
    learned: true,
    source: search.source,
    summary: summary.slice(0, 400),
    formatted: formatSearchResults(search),
  };
}

export async function getLearnedKnowledge(topic) {
  const memories = await getMemories(SYSTEM_CHAT_ID, 50);
  const key = topic.toLowerCase();
  const match = memories.find((m) => m.content?.toLowerCase().includes(key));
  return match?.content || null;
}
