import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '2.2.2:3',
  releaseNotes: {
    en_US:
      'Report live Snap Sync, Old Headers, Old Bodies, and Old Receipts percentages in Execution Sync instead of showing 0.0% while eth_syncing reports block 0.',
    es_ES:
      'Muestra los porcentajes en vivo de Snap Sync, Old Headers, Old Bodies y Old Receipts en Sincronización de ejecución en lugar de 0.0% mientras eth_syncing informa el bloque 0.',
    de_DE:
      'Zeigt Live-Prozentwerte für Snap Sync, Old Headers, Old Bodies und Old Receipts in der Ausführungs-Synchronisierung statt 0,0 %, solange eth_syncing Block 0 meldet.',
    pl_PL:
      'Pokazuje na żywo postęp Snap Sync, Old Headers, Old Bodies i Old Receipts w Synchronizacji wykonawczej zamiast 0,0%, gdy eth_syncing zwraca blok 0.',
    fr_FR:
      'Affiche les pourcentages en direct de Snap Sync, Old Headers, Old Bodies et Old Receipts dans Synchronisation d’exécution au lieu de 0,0 % tant que eth_syncing renvoie le bloc 0.',
  },
  migrations: { up: async () => {}, down: IMPOSSIBLE },
})
