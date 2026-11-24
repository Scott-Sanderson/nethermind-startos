import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { sdk } from '../sdk'
import { storeJson } from '../fileModels/store.json'
import { configure } from '../actions/configure'
import { i18n } from '../i18n'
import { storageReady } from '../utils'
export const seed = sdk.setupOnInit(async (effects) => {
  await storeJson.merge(effects, {})

  const stored = await storeJson.read().once()
  const secret = stored?.jwtSecret || randomBytes(32).toString('hex')
  if (!stored?.jwtSecret) await storeJson.merge(effects, { jwtSecret: secret })
  await writeFile(sdk.volumes['engine-auth'].subpath('jwt.hex'), secret, {
    mode: 0o644,
  })
})
export const watchStorage = sdk.setupOnInit(async (effects) => {
  const store = await storeJson.read().const(effects)
  const grants = await sdk.getSharedVolumes(effects).const()
  if (!storageReady(store?.storage, grants))
    await sdk.action.createOwnTask(effects, configure, 'critical', {
      reason: i18n(
        'Choose available storage with read/write access before starting this service.',
      ),
    })
})
