import { getDb } from '../server/db/db'
import { syncContentListing } from '../server/cms/content-listing'

const schemaKey = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : undefined
const onlyMissing = !process.argv.includes('--force')

const db = await getDb()
const result = await syncContentListing({ db, schemaKey, onlyMissing })

const scopeLabel = schemaKey ? `schema ${schemaKey}` : 'all schemas'
const modeLabel = onlyMissing ? 'only missing' : 'full sync'
console.log(`[content_listing backfill] ${scopeLabel} (${modeLabel})`)
console.log(result)
