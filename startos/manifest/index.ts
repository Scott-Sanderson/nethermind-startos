import { setupManifest } from '@start9labs/start-sdk'
import { short, long } from './i18n'

export const manifest = setupManifest({
  id: 'nethermind',
  title: 'Nethermind',
  license: 'LGPL-3.0-only',
  packageRepo: 'https://github.com/Scott-Sanderson/nethermind-startos',
  upstreamRepo: 'https://github.com/NethermindEth/nethermind',
  marketingUrl: 'https://nethermind.io/',
  donationUrl: null,
  description: { short, long },
  hardwareRequirements: {
    ram: 12 * 1024 ** 3, // 12 GiB floor excludes 8 GB devices while allowing 16 GB hosts with iGPU carve-outs
  },
  sharedVolumes: true,
  volumes: ['config', 'chain', 'engine-auth'],
  images: {
    nethermind: {
      source: { dockerTag: 'nethermind/nethermind:2.2.2' },
      arch: ['x86_64', 'aarch64'],
      emulateMissing: false,
    },
  },
})
