import { getSchemaPermission } from '../../../utils/schema-permission'
import { badRequest } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const schemaKey = event.context.params?.schemaKey as string
  if (!schemaKey) throw badRequest('Missing schema key')

  const permission = await getSchemaPermission(event, schemaKey)

  return {
    roleKey: permission.roleKey,
    canRead: permission.canRead,
    canWrite: permission.canWrite,
    canPublish: permission.canPublish,
    canArchive: permission.canArchive,
    canDelete: permission.canDelete,
    canAdmin: permission.canAdmin
  }
})
