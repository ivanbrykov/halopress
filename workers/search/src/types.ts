import type { SearchStore } from '../../../shared/search-store'

export type SearchQueueMessage =
  | { kind: 'job', jobId: string }
  | { kind: 'reconcile' }

export type QueueSendBatchEntry<T> = {
  body: T
}

export type QueueBinding<T> = {
  send(message: T): Promise<void>
  sendBatch(messages: Array<QueueSendBatchEntry<T>>): Promise<void>
}

export type SearchWorkerEnv = {
  DB: SearchStore
  SEARCH_INDEX_QUEUE: QueueBinding<SearchQueueMessage>
}

export type QueueMessage<T> = {
  body: T
  ack(): void
  retry(options?: { delaySeconds?: number }): void
}

export type MessageBatch<T> = {
  messages: Array<QueueMessage<T>>
}

export type ExecutionContext = {
  waitUntil(promise: Promise<unknown>): void
}
