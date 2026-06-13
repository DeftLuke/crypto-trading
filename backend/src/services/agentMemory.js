import { getSupabase } from './supabase.js';

export async function getChatHistory(chatId, limit = 12) {
  const db = getSupabase();
  if (!db) return [];
  const { data } = await db
    .from('agent_chat_messages')
    .select('role, content, created_at')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data || []).reverse();
}

export async function saveChatMessage(chatId, role, content) {
  const db = getSupabase();
  if (!db) return;
  try {
    await db.from('agent_chat_messages').insert({ chat_id: chatId, role, content });
  } catch (err) {
    console.warn('[AgentMemory] saveChatMessage:', err.message);
  }
}

export async function getMemories(chatId, limit = 25) {
  const db = getSupabase();
  if (!db) return [];
  const { data } = await db
    .from('agent_memory')
    .select('id, category, content, created_at')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

export async function saveMemory(chatId, content, category = 'fact') {
  const db = getSupabase();
  if (!db) return null;
  try {
    const { data, error } = await db
      .from('agent_memory')
      .insert({ chat_id: chatId, content, category })
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.warn('[AgentMemory] saveMemory:', err.message);
    return null;
  }
}

export async function getActiveTasks(chatId) {
  const db = getSupabase();
  if (!db) return [];
  const { data } = await db
    .from('agent_tasks')
    .select('*')
    .eq('chat_id', chatId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  return data || [];
}

export async function createTask(chatId, taskType, payload, fireAt = null) {
  const db = getSupabase();
  if (!db) return null;
  const { data } = await db
    .from('agent_tasks')
    .insert({
      chat_id: chatId,
      task_type: taskType,
      payload,
      fire_at: fireAt,
      status: 'active',
    })
    .select()
    .single();
  return data;
}

export async function getDueTasks() {
  const db = getSupabase();
  if (!db) return [];
  const { data } = await db
    .from('agent_tasks')
    .select('*')
    .eq('status', 'active')
    .eq('task_type', 'timer')
    .lte('fire_at', new Date().toISOString());
  return data || [];
}

export async function completeTask(taskId) {
  const db = getSupabase();
  if (!db) return;
  await db.from('agent_tasks').update({ status: 'done' }).eq('id', taskId);
}

export async function getWatchTasksForSymbol(symbol) {
  const db = getSupabase();
  if (!db) return [];
  const { data } = await db
    .from('agent_tasks')
    .select('*')
    .eq('status', 'active')
    .eq('task_type', 'watch_coin')
    .filter('payload->>symbol', 'eq', symbol);
  return data || [];
}

export async function cancelWatchTask(chatId, symbol) {
  const db = getSupabase();
  if (!db) return;
  const { data: tasks } = await db
    .from('agent_tasks')
    .select('id')
    .eq('chat_id', chatId)
    .eq('status', 'active')
    .eq('task_type', 'watch_coin')
    .filter('payload->>symbol', 'eq', symbol);
  for (const t of tasks || []) {
    await db.from('agent_tasks').update({ status: 'cancelled' }).eq('id', t.id);
  }
}
