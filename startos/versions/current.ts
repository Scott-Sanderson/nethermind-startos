import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '2.2.2:4',
  releaseNotes: {
    en_US:
      'Add richer Execution Sync progress (phase percentages, ETAs, DB clearing elapsed time, header/target blocks, and synced block height) and an automated Log Health check with rate-limited critical alerts.',
    es_ES:
      'Añade progreso detallado en Sincronización de ejecución (porcentajes por fase, tiempo estimado, limpieza de BD, bloques cabecera/objetivo y bloque sincronizado) y una comprobación automática de Estado de registros con alertas críticas.',
    de_DE:
      'Fügt detaillierteren Synchronisierungsfortschritt (Phasenprozente, Restzeit, DB-Bereinigung, Header-/Zielblöcke und synchronisierten Block) sowie eine automatische Protokollstatus-Prüfung mit kritischen Benachrichtigungen hinzu.',
    pl_PL:
      'Dodaje szczegółowy postęp Synchronizacji wykonawczej (procenty faz, szacowany czas, czyszczenie bazy, bloki nagłówka/docelowy i zsynchronizowany blok) oraz automatyczną kontrolę Stanu logów z powiadomieniami krytycznymi.',
    fr_FR:
      'Ajoute une progression détaillée de Synchronisation d’exécution (pourcentages par phase, temps restant, nettoyage de la base, blocs en-tête/cible et bloc synchronisé) ainsi qu’un contrôle Santé des journaux avec alertes critiques.',
  },
  migrations: { up: async () => {}, down: IMPOSSIBLE },
})
