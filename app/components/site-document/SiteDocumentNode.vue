<script setup lang="ts">
import type { AuthoredDocumentNode } from '~~/shared/authored-document'
import SiteTextNode from './SiteTextNode'

defineOptions({ name: 'SiteDocumentNode' })
defineProps<{ node: AuthoredDocumentNode }>()
</script>

<template>
  <SiteTextNode v-if="node.type === 'text'" :node="node" />
  <br v-else-if="node.type === 'hardBreak'">
  <hr v-else-if="node.type === 'horizontalRule'" class="site-document-divider">
  <img
    v-else-if="node.type === 'image'"
    class="site-document-image"
    :src="node.src"
    :alt="node.alt"
    :title="node.title"
    :width="node.width"
    :height="node.height"
    loading="lazy"
    decoding="async"
  >
  <span v-else-if="node.type === 'mention'" class="site-document-mention">@{{ node.label }}</span>
  <p
    v-else-if="node.type === 'fallback'"
    class="site-document-fallback"
    role="status"
    data-site-document-fallback
  >
    {{ node.message }}
  </p>
  <p v-else-if="node.type === 'paragraph'" :data-halo-align="node.textAlign">
    <SiteDocumentNode v-for="(child, index) in node.content" :key="index" :node="child" />
  </p>
  <h1 v-else-if="node.type === 'heading' && node.level === 1" :id="node.id" :data-halo-align="node.textAlign">
    <SiteDocumentNode v-for="(child, index) in node.content" :key="index" :node="child" />
  </h1>
  <h2 v-else-if="node.type === 'heading' && node.level === 2" :id="node.id" :data-halo-align="node.textAlign">
    <SiteDocumentNode v-for="(child, index) in node.content" :key="index" :node="child" />
  </h2>
  <h3 v-else-if="node.type === 'heading' && node.level === 3" :id="node.id" :data-halo-align="node.textAlign">
    <SiteDocumentNode v-for="(child, index) in node.content" :key="index" :node="child" />
  </h3>
  <h4 v-else-if="node.type === 'heading'" :id="node.id" :data-halo-align="node.textAlign">
    <SiteDocumentNode v-for="(child, index) in node.content" :key="index" :node="child" />
  </h4>
  <blockquote v-else-if="node.type === 'blockquote'" class="site-document-blockquote">
    <SiteDocumentNode v-for="(child, index) in node.content" :key="index" :node="child" />
  </blockquote>
  <ul v-else-if="node.type === 'bulletList'" class="site-document-list">
    <SiteDocumentNode v-for="(child, index) in node.content" :key="index" :node="child" />
  </ul>
  <ol v-else-if="node.type === 'orderedList'" class="site-document-list" :start="node.start">
    <SiteDocumentNode v-for="(child, index) in node.content" :key="index" :node="child" />
  </ol>
  <li v-else-if="node.type === 'listItem'">
    <SiteDocumentNode v-for="(child, index) in node.content" :key="index" :node="child" />
  </li>
  <pre v-else-if="node.type === 'codeBlock'" class="site-document-code"><code><SiteDocumentNode v-for="(child, index) in node.content" :key="index" :node="child" /></code></pre>
  <section
    v-else-if="node.type === 'pageHero'"
    class="halo-block halo-hero site-document-hero"
    data-halo-block="hero"
    :data-halo-orientation="node.orientation"
    :data-halo-reverse="node.reverse ? 'true' : undefined"
  >
    <div class="halo-block-content">
      <SiteDocumentNode v-for="(child, index) in node.content" :key="index" :node="child" />
    </div>
  </section>
  <p v-else class="site-document-fallback" role="status" data-site-document-fallback>
    Unsupported content
  </p>
</template>
