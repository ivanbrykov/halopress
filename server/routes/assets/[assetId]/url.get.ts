export default defineEventHandler(async (event) => {
  const assetId = event.context.params?.assetId as string
  return { url: `/assets/${assetId}/raw` }
})
