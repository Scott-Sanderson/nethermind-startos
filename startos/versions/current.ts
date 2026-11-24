import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '2.2.2:0',
  releaseNotes: {
    en_US:
      'Initial StartOS release of Nethermind for Ethereum Mainnet with shared-volume storage, RAM- and disk-aware tuning, gateway-consistent peer monitoring, detailed sync progress, and automated log health alerts.',
    es_ES:
      'Lanzamiento inicial en StartOS de Nethermind para Ethereum Mainnet con almacenamiento en volúmenes compartidos, ajuste según RAM y disco, supervisión de pasarela de pares, progreso detallado de sincronización y alertas automáticas de registros.',
    de_DE:
      'Erste StartOS-Version von Nethermind für Ethereum Mainnet mit gemeinsam genutztem Speicher, RAM- und speicherbewusster Abstimmung, Peer-Gateway-Prüfung, detailliertem Synchronisierungsfortschritt und automatischer Protokollüberwachung.',
    pl_PL:
      'Pierwsze wydanie Nethermind dla Ethereum Mainnet w StartOS z obsługą wolumenów współdzielonych, dostrajaniem do RAM i dysku, kontrolą bramy peerów, szczegółowym postępem synchronizacji i automatycznym monitorowaniem logów.',
    fr_FR:
      'Première version StartOS de Nethermind pour Ethereum Mainnet avec stockage sur volumes partagés, réglage adapté à la RAM et au disque, suivi de passerelle des pairs, progression détaillée de la synchronisation et surveillance automatique des journaux.',
  },
  migrations: { up: async () => {}, down: IMPOSSIBLE },
})
