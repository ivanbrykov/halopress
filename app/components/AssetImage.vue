<script setup lang="ts">
defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  src: string
  alt?: string
}>(), {
  alt: ''
})

const optimizedImageFailed = ref(false)

watch(() => props.src, () => {
  optimizedImageFailed.value = false
})
</script>

<template>
  <NuxtImg
    v-if="!optimizedImageFailed"
    :src="src"
    :alt="alt"
    v-bind="$attrs"
    @error="optimizedImageFailed = true"
  />
  <img
    v-else
    :src="src"
    :alt="alt"
    v-bind="$attrs"
  />
</template>
