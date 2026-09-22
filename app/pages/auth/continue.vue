<script setup lang="ts">
import { resolvePostAuthPath } from '~~/shared/auth-redirect'

definePageMeta({ layout: 'blank' })

const route = useRoute()
const { getSession } = useAuth()

onMounted(async () => {
  const session = await getSession()
  const target = session?.user
    ? resolvePostAuthPath(route.query.callbackUrl, session.user)
    : `/login?callbackUrl=${encodeURIComponent(String(route.query.callbackUrl || '/'))}`
  await navigateTo(target, { replace: true })
})
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-muted/60">
    <UIcon name="i-lucide-loader-circle" class="size-7 animate-spin text-muted" />
    <span class="sr-only">Completing sign in</span>
  </div>
</template>
