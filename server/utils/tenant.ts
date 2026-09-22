import type { H3Event } from 'h3'

export function getTenantKey(event: H3Event) {
  const host = event.node.req.headers.host || 'local'
  // Strip port
  return host.split(':')[0] || 'local'
}

