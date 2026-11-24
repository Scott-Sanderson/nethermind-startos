import { FileHelper, z } from '@start9labs/start-sdk'
import { sdk } from '../sdk'
const port = (fallback: number) =>
  z.number().int().min(1025).max(65535).catch(fallback)
export const storeJson = FileHelper.json(
  { base: sdk.volumes.config, subpath: 'store.json' },
  z.looseObject({
    storage: z.string().nullable().catch(null),
    history: z.enum(['rolling', 'post-merge', 'full']).catch('rolling'),
    executionPort: port(30303),
    executionPeers: z.number().int().min(1).max(200).catch(50),
    jwtSecret: z.string().nullable().catch(null),
  }),
)
