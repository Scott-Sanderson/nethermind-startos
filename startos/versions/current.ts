import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '2.2.2:2',
  releaseNotes: {
    en_US:
      'Add RAM- and disk-aware resource tuning, a Disk Space health check, StartTunnel/WAN gateway consistency detection without intermediate restarts, automatic retirement of old peer port bindings, and detailed block sync progress.',
    es_ES:
      'Añade ajuste automático de memoria y disco, comprobación de espacio en disco, detección de coherencia de pasarela StartTunnel/WAN sin reinicios intermedios, liberación automática de puertos de pares anteriores y progreso detallado de sincronización.',
    de_DE:
      'Fügt RAM- und speicherbewusste Abstimmung, eine Speicherplatz-Prüfung, StartTunnel/WAN-Gateway-Konsistenzprüfung ohne Zwischenneustarts, automatische Freigabe alter Peer-Port-Bindungen und detaillierten Synchronisierungsfortschritt hinzu.',
    pl_PL:
      'Dodaje dostrajanie do pamięci RAM i dysku, kontrolę miejsca na dysku, wykrywanie spójności bramy StartTunnel/WAN bez pośrednich restartów, automatyczne zwalnianie starych portów peerów oraz szczegółowy postęp synchronizacji bloków.',
    fr_FR:
      'Ajoute le réglage adapté à la RAM et au disque, un contrôle d’espace disque, la détection de cohérence de passerelle StartTunnel/WAN sans redémarrages intermédiaires, la libération automatique des anciens ports de pairs et la progression détaillée de la synchronisation.',
  },
  migrations: { up: async () => {}, down: IMPOSSIBLE },
})
