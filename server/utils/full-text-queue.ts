import type { H3Event } from 'h3'

type QueueBinding = {
  send(message: { kind: 'reconcile' }): Promise<void>
}

function waitUntil(event: H3Event) {
  const cloudflare = (event as any)?.context?.cloudflare
  for (const candidate of [cloudflare?.ctx, cloudflare?.context, cloudflare, event as any]) {
    if (typeof candidate?.waitUntil === 'function') return candidate.waitUntil.bind(candidate)
  }
  return null
}

export function queueFullTextReconcile(event: H3Event) {
  const queue = (event as any)?.context?.cloudflare?.env?.SEARCH_INDEX_QUEUE as QueueBinding | undefined
  if (!queue?.send) {
    if (!(event as any)?.context?.cloudflare) {
      import('../search/node-runtime')
        .then(module => module.nudgeNodeSearchRuntime())
        .catch(() => {})
    }
    return
  }
  const task = queue.send({ kind: 'reconcile' })
  const schedule = waitUntil(event)
  if (schedule) schedule(task)
  else task.catch(() => {})
}
