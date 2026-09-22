import { createError, sendError, type H3Event } from 'h3'

export function badRequest(message: string, data?: unknown) {
  return createError({ statusCode: 400, statusMessage: message, data })
}

export function unauthorized(message = 'Unauthorized') {
  return createError({ statusCode: 401, statusMessage: message })
}

export function forbidden(message = 'Forbidden') {
  return createError({ statusCode: 403, statusMessage: message })
}

export function notFound(message = 'Not found') {
  return createError({ statusCode: 404, statusMessage: message })
}

export function conflict(message = 'Conflict', data?: unknown) {
  return createError({ statusCode: 409, statusMessage: message, data })
}

export function sendH3Error(event: H3Event, err: unknown) {
  sendError(event, err as any)
}
