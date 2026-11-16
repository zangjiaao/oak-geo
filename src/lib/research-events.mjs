// POST event stream: preserve UTF-8 boundaries and reject an interrupted result.
export async function readResearchEvents(response, onEvent) {
  if (!response.ok) {
    const payload = await response.json();
    throw new Error(payload.error?.message || '调查未能启动');
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream'))
    throw new Error('调查服务未返回进度流，请更新服务后重试');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', completed = false;
  try {
    for (;;) {
      const part = await reader.read();
      buffer += decoder.decode(part.value, {stream: !part.done});
      if (buffer.length > 1048576) throw new Error('调查结果过大，请刷新查看');
      let split;
      while ((split = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0,split); buffer = buffer.slice(split+2);
        const json = block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5)).join('\n');
        if (!json) continue;
        const event = JSON.parse(json);
        if (event.type === 'error') throw new Error(event.message || '调查连接失败');
        if (event.type === 'result') completed = true;
        onEvent(event);
      }
      if (part.done) break;
    }
    if (!completed) throw new Error('调查连接中断，草稿已保留，请刷新查看或重试');
  } finally {
    if (!completed) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
