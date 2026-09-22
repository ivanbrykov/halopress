import { z } from 'zod'

export const installInputSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email(),
  name: z.string().trim().max(100).optional().default(''),
  password: z.string().min(12).max(256),
  sampleData: z.boolean().optional().default(false)
}).strict()

export type InstallInput = z.infer<typeof installInputSchema>
