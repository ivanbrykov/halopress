<script setup lang="ts">
import {
  isSiteMenuDynamicItem,
  type SiteMenuChild,
  type SiteMenuItem,
  type SiteMenuSourceOptionsResponse,
  type SiteMenuValidationIssue
} from '~~/shared/site-menu'

const model = defineModel<SiteMenuItem | SiteMenuChild>({ required: true })
defineProps<{
  pathPrefix: string
  isParent: boolean
  hasChildren?: boolean
  validationIssues?: SiteMenuValidationIssue[]
  sourceOptions?: SiteMenuSourceOptionsResponse | null
  sourceOptionsPending?: boolean
  sourceOptionsError?: boolean
}>()
</script>

<template>
  <div class="space-y-4" data-menu-detail-editor>
    <div class="space-y-1">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="text-base font-semibold text-highlighted" data-menu-detail-heading tabindex="-1">
          Edit {{ siteMenuAuthoredItemLabel(model) || 'menu item' }}
        </h3>
        <UBadge color="neutral" variant="soft">
          {{ isSiteMenuDynamicItem(model) ? 'Dynamic source' : isParent ? 'Top-level link' : 'Child link' }}
        </UBadge>
      </div>
      <p class="text-xs text-muted">Stable item ID: {{ model.id }}</p>
    </div>

    <UAlert
      v-if="!isSiteMenuDynamicItem(model) && isParent && hasChildren"
      title="This link opens a submenu"
      description="Its destination remains saved and becomes active again if all child links are removed."
      color="info"
      variant="subtle"
      icon="i-lucide-list-tree"
    />

    <SiteMenuSourceEditor
      v-if="isSiteMenuDynamicItem(model)"
      v-model="model"
      :path-prefix="pathPrefix"
      :options="sourceOptions"
      :options-pending="sourceOptionsPending"
      :options-error="sourceOptionsError"
      :validation-issues="validationIssues"
    />
    <SiteMenuItemEditor
      v-else
      v-model="model"
      :path-prefix="pathPrefix"
      :validation-issues="validationIssues"
    />
  </div>
</template>
