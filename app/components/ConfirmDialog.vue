<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'

const props = withDefaults(defineProps<{
  title?: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  confirmColor?: ButtonProps['color']
  confirmVariant?: ButtonProps['variant']
}>(), {
  title: 'Confirm',
  body: '',
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  confirmColor: 'error',
  confirmVariant: 'solid'
})

const emit = defineEmits<{ close: [boolean] }>()

const closeButton = computed<ButtonProps>(() => ({
  color: 'neutral',
  variant: 'ghost',
  onClick: () => emit('close', false)
}))
</script>

<template>
  <UModal
    :dismissible="false"
    :title="props.title"
    :close="closeButton"
  >
    <template #body>
      <p v-if="props.body" class="text-sm text-muted">
        {{ props.body }}
      </p>
    </template>

    <template #footer>
      <div class="flex items-center justify-end gap-2">
        <UButton color="neutral" variant="outline" @click="emit('close', false)">
          {{ props.cancelLabel }}
        </UButton>
        <UButton :color="props.confirmColor" :variant="props.confirmVariant" @click="emit('close', true)">
          {{ props.confirmLabel }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
