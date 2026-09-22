<script setup lang="ts">
import SiteRichTextRenderer from '~/components/site-document/SiteRichTextRenderer.vue'
import { formatPresentationDate, safePresentationLink } from '~/utils/schema-presentation'

const props = defineProps<{
  field: any
  value: unknown
}>()
const safeLink = computed(() => safePresentationLink(props.value))
const formattedDate = computed(() => formatPresentationDate(props.value, props.field.renderer === 'datetime'))
</script>

<template>
  <SiteRichTextRenderer
    v-if="field.renderer === 'rich_text'"
    :document="value"
    :field-id="field.fieldId"
    :field-key="field.fieldKey"
  />
  <PublicAssetGallery v-else-if="field.renderer === 'asset_gallery'" :value="value" :label="field.title" />
  <AssetImage v-else-if="field.renderer === 'asset' && typeof value === 'string'" :src="`/assets/${value}/raw`" :alt="field.title || ''" preset="content" sizes="(max-width: 768px) 100vw, 960px" class="max-h-[70vh] w-full rounded-xl bg-elevated object-contain" />
  <a v-else-if="field.renderer === 'link' && safeLink" :href="safeLink" class="text-primary underline underline-offset-4" rel="noopener noreferrer">{{ value }}</a>
  <UBadge v-else-if="field.renderer === 'badge'" color="neutral" variant="soft">{{ String(value) }}</UBadge>
  <span v-else-if="field.renderer === 'boolean'">{{ value ? 'Yes' : 'No' }}</span>
  <time v-else-if="field.renderer === 'date' || field.renderer === 'datetime'" :datetime="typeof value === 'string' ? value : undefined">{{ formattedDate }}</time>
  <span v-else-if="field.renderer === 'number'" class="tabular-nums">{{ typeof value === 'number' ? value.toLocaleString() : String(value) }}</span>
  <span v-else-if="field.renderer === 'reference' || field.renderer === 'reference_list'" class="text-muted">{{ Array.isArray(value) ? `${value.length} related items` : 'Related content' }}</span>
  <p v-else-if="field.renderer === 'long_text'" class="whitespace-pre-wrap text-pretty">{{ String(value) }}</p>
  <span v-else>{{ String(value) }}</span>
</template>
