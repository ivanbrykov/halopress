<script setup lang="ts">
const props = defineProps<{
  modelValue: string | null | undefined
  targetSchemaKey?: string | null
  label?: string
  required?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: string | null): void
}>()

const open = ref(false)
const selected = ref<string | null>(props.modelValue ?? null)

watch(() => props.modelValue, (v) => {
  selected.value = v ?? null
})

const fetchUrl = computed(() => props.targetSchemaKey ? `/api/content/${props.targetSchemaKey}` : '/api/content/__none__')
const { data: list, refresh } = await useFetch<{ items: any[] }>(fetchUrl, {
  immediate: false,
  query: { pageSize: 50 }
})

watch(() => props.targetSchemaKey, async (v) => {
  if (v) await refresh()
}, { immediate: true })

const options = computed(() => (list.value?.items ?? []).map((c: any) => ({
  label: c.title || c.id,
  value: c.id
})))

function apply() {
  emit('update:modelValue', selected.value)
  open.value = false
}
</script>

<template>
  <fieldset class="min-w-0 space-y-2">
    <legend class="mb-2 text-sm font-medium text-highlighted">
      {{ label || 'Reference' }}<span v-if="required" class="ms-0.5 text-error" aria-hidden="true">*</span>
    </legend>

    <div class="flex items-center gap-2">
      <UInput
        :model-value="modelValue || ''"
        placeholder="Target ID"
        class="min-w-0 flex-1"
        @update:model-value="emit('update:modelValue', $event || null)"
      />
      <UButton
        size="xs"
        color="neutral"
        variant="outline"
        icon="i-lucide-search"
        :disabled="!targetSchemaKey"
        @click="open = true;"
      >
        Browse
      </UButton>
    </div>

    <UModal
      v-model:open="open"
      :title="`Pick ${targetSchemaKey || 'reference'}`"
      description="Select the content item to reference."
    >
      <template #body>
        <UFormField label="Select">
          <USelectMenu v-model="selected" value-key="value" :items="options" class="w-full" />
        </UFormField>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="outline" @click="open = false;">
            Cancel
          </UButton>
          <UButton icon="i-lucide-check" @click="apply">
            Apply
          </UButton>
        </div>
      </template>
    </UModal>
  </fieldset>
</template>
