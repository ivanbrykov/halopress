import type { MaybeRefOrGetter } from 'vue'
import { onBeforeUnmount, onMounted, ref, toValue } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'

const DEFAULT_MESSAGE = 'You have unsaved changes. Leave this page and discard them?'

type RouteLeaveDecisionOptions = {
  isDirty: () => boolean
  consumeAllowedNavigation: () => boolean
  confirmDiscard: () => Promise<boolean>
}

export function createUnsavedRouteLeaveDecision({
  isDirty,
  consumeAllowedNavigation,
  confirmDiscard
}: RouteLeaveDecisionOptions) {
  let pendingConfirmation: Promise<boolean> | null = null

  return async () => {
    if (consumeAllowedNavigation()) return true
    if (!isDirty()) return true
    if (!pendingConfirmation) {
      pendingConfirmation = confirmDiscard().finally(() => {
        pendingConfirmation = null
      })
    }
    return await pendingConfirmation
  }
}

export function useUnsavedNavigationGuard(
  isDirty: MaybeRefOrGetter<boolean>,
  message = DEFAULT_MESSAGE
) {
  const allowNext = ref(false)
  const { confirm } = useConfirmDialog()

  function allowNextNavigation() {
    allowNext.value = true
  }

  const decideRouteLeave = createUnsavedRouteLeaveDecision({
    isDirty: () => toValue(isDirty),
    consumeAllowedNavigation: () => {
      if (!allowNext.value) return false
      allowNext.value = false
      return true
    },
    confirmDiscard: () => confirm({
        title: 'Discard unsaved changes?',
        body: message,
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
        confirmColor: 'warning'
    })
  })

  onBeforeRouteLeave(() => {
    if (typeof window === 'undefined') return true
    return decideRouteLeave()
  })

  function handleBeforeUnload(event: BeforeUnloadEvent) {
    if (!toValue(isDirty)) return
    event.preventDefault()
    event.returnValue = ''
  }

  onMounted(() => window.addEventListener('beforeunload', handleBeforeUnload))
  onBeforeUnmount(() => window.removeEventListener('beforeunload', handleBeforeUnload))

  return { allowNextNavigation }
}
