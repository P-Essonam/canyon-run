import { useSyncExternalStore } from "react"

// English, French and Spanish. Each device picks its own language: the
// screen and every phone remember theirs, and start from the browser's.

export const LANGS = ["en", "fr", "es"] as const
export type Lang = (typeof LANGS)[number]
export const LANG_NAMES: Record<Lang, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
}

const en = {
  // The screen
  openOnComputer: "Open this page on a computer, then scan the code with this phone.",
  play: "Play",
  leaderboard: "Leaderboard",
  scanToFly: "Scan to fly",
  steerHint: "Tilt your phone or slide your thumb to steer",
  players: "Players",
  onePlayer: "1 player",
  twoPlayers: "2 players",
  player: (n: number) => `Player ${n}`,
  waiting: "Waiting",
  reconnecting: "Reconnecting",
  ready: "Ready",
  joined: "Joined",
  gameOver: "Game over",
  tie: "It's a tie!",
  wins: (n: number) => `Player ${n} wins!`,
  soundOn: "Turn sound on",
  soundOff: "Turn sound off",
  volume: "Volume",
  language: "Language",
  range: "Range",
  today: "Today",
  allTime: "All time",
  noRuns: "No runs yet. Be the first!",
  // The phone
  wrongLink: "Wrong link",
  scanAgain: "Scan the code on the screen again.",
  full: "Game is full",
  fullText:
    "Someone is already playing on this screen. Wait for the next game, or pick 2 players on the screen.",
  disconnected: "Disconnected",
  connecting: "Connecting",
  quit: "Quit",
  steering: "Steering",
  steerBy: "Steer by",
  tilt: "Tilt",
  touch: "Touch",
  noSensorHint: "Motion sensors are off on this phone: steer with your thumb.",
  tiltLaunchHint: "Hold your phone the way that feels straight ahead, then tap.",
  touchLaunchHint: "Hold anywhere on the screen and slide your thumb to steer.",
  getReady: "Get ready",
  dragToSteer: "Drag to steer",
  tiltToSteer: "Tilt to steer",
  dragHint: "Hold anywhere and slide your thumb",
  tiltHint: "Left and right to turn, forward and back to dive and climb",
  distance: "Distance",
  otherStillFlying: "The other rocket is still flying…",
  saved: "Saved to the leaderboard",
  nameLabel: "Leaderboard name",
  namePlaceholder: "Your name",
  saving: "Saving…",
  save: "Save",
  skip: "Skip",
  launch: "Launch",
  launchAgain: "Launch again",
  deployYourOwn: "Deploy your own with",
  poweredBy: "Powered by",
  nextGameSoon: "Next game starts soon",
  waitingFor: (n: number) => `Waiting for player ${n}`,
  youWin: "You win",
  playerWins: (n: number) => `Player ${n} wins`,
  tieShort: "It's a tie",
  // Why a score was not saved (the server sends the code).
  noRun: "No run to save",
  badName: "Pick another name",
  implausible: "That run can't be saved",
  saveFailed: "Couldn't save, try again",
}

export type Messages = typeof en

const fr: Messages = {
  openOnComputer: "Ouvre cette page sur un ordinateur, puis scanne le code avec ce téléphone.",
  play: "Jouer",
  leaderboard: "Classement",
  scanToFly: "Scanne pour voler",
  steerHint: "Incline ton téléphone ou glisse ton pouce pour piloter",
  players: "Joueurs",
  onePlayer: "1 joueur",
  twoPlayers: "2 joueurs",
  player: (n) => `Joueur ${n}`,
  waiting: "En attente",
  reconnecting: "Reconnexion",
  ready: "Prêt",
  joined: "Connecté",
  gameOver: "Partie terminée",
  tie: "Égalité !",
  wins: (n) => `Le joueur ${n} gagne !`,
  soundOn: "Activer le son",
  soundOff: "Couper le son",
  volume: "Volume",
  language: "Langue",
  range: "Période",
  today: "Aujourd'hui",
  allTime: "Depuis toujours",
  noRuns: "Aucune partie pour l'instant. Sois le premier !",
  wrongLink: "Lien invalide",
  scanAgain: "Scanne à nouveau le code sur l'écran.",
  full: "Partie complète",
  fullText:
    "Quelqu'un joue déjà sur cet écran. Attends la prochaine partie, ou choisis 2 joueurs sur l'écran.",
  disconnected: "Déconnecté",
  connecting: "Connexion",
  quit: "Quitter",
  steering: "Pilotage",
  steerBy: "Piloter avec",
  tilt: "Inclinaison",
  touch: "Tactile",
  noSensorHint: "Les capteurs de mouvement sont désactivés sur ce téléphone : pilote avec ton pouce.",
  tiltLaunchHint: "Tiens ton téléphone comme si tu regardais droit devant, puis appuie.",
  touchLaunchHint: "Pose ton pouce n'importe où sur l'écran et fais-le glisser pour piloter.",
  getReady: "Prépare-toi",
  dragToSteer: "Glisse pour piloter",
  tiltToSteer: "Incline pour piloter",
  dragHint: "Pose ton pouce n'importe où et fais-le glisser",
  tiltHint: "Gauche et droite pour tourner, avant et arrière pour descendre et monter",
  distance: "Distance",
  otherStillFlying: "L'autre fusée vole encore…",
  saved: "Enregistré dans le classement",
  nameLabel: "Nom pour le classement",
  namePlaceholder: "Ton nom",
  saving: "Enregistrement…",
  save: "Enregistrer",
  skip: "Passer",
  launch: "Décoller",
  launchAgain: "Redécoller",
  deployYourOwn: "Déploie le tien avec",
  poweredBy: "Propulsé par",
  nextGameSoon: "La prochaine partie arrive",
  waitingFor: (n) => `En attente du joueur ${n}`,
  youWin: "Tu gagnes",
  playerWins: (n) => `Le joueur ${n} gagne`,
  tieShort: "Égalité",
  noRun: "Aucune partie à enregistrer",
  badName: "Choisis un autre nom",
  implausible: "Cette partie ne peut pas être enregistrée",
  saveFailed: "Échec de l'enregistrement, réessaie",
}

const es: Messages = {
  openOnComputer: "Abre esta página en un ordenador y escanea el código con este teléfono.",
  play: "Jugar",
  leaderboard: "Clasificación",
  scanToFly: "Escanea para volar",
  steerHint: "Inclina el teléfono o desliza el pulgar para pilotar",
  players: "Jugadores",
  onePlayer: "1 jugador",
  twoPlayers: "2 jugadores",
  player: (n) => `Jugador ${n}`,
  waiting: "Esperando",
  reconnecting: "Reconectando",
  ready: "Listo",
  joined: "Conectado",
  gameOver: "Fin de la partida",
  tie: "¡Empate!",
  wins: (n) => `¡Gana el jugador ${n}!`,
  soundOn: "Activar el sonido",
  soundOff: "Silenciar",
  volume: "Volumen",
  language: "Idioma",
  range: "Periodo",
  today: "Hoy",
  allTime: "Histórico",
  noRuns: "Aún no hay partidas. ¡Sé el primero!",
  wrongLink: "Enlace no válido",
  scanAgain: "Vuelve a escanear el código de la pantalla.",
  full: "Partida completa",
  fullText:
    "Alguien ya está jugando en esta pantalla. Espera a la próxima partida o elige 2 jugadores en la pantalla.",
  disconnected: "Desconectado",
  connecting: "Conectando",
  quit: "Salir",
  steering: "Control",
  steerBy: "Pilotar con",
  tilt: "Inclinación",
  touch: "Táctil",
  noSensorHint: "Los sensores de movimiento están desactivados en este teléfono: pilota con el pulgar.",
  tiltLaunchHint: "Sujeta el teléfono como si miraras al frente y toca.",
  touchLaunchHint: "Mantén el pulgar en cualquier parte de la pantalla y deslízalo para pilotar.",
  getReady: "Prepárate",
  dragToSteer: "Desliza para pilotar",
  tiltToSteer: "Inclina para pilotar",
  dragHint: "Mantén el pulgar en cualquier parte y deslízalo",
  tiltHint: "Izquierda y derecha para girar, adelante y atrás para bajar y subir",
  distance: "Distancia",
  otherStillFlying: "El otro cohete sigue volando…",
  saved: "Guardado en la clasificación",
  nameLabel: "Nombre para la clasificación",
  namePlaceholder: "Tu nombre",
  saving: "Guardando…",
  save: "Guardar",
  skip: "Omitir",
  launch: "Despegar",
  launchAgain: "Despegar otra vez",
  deployYourOwn: "Despliega el tuyo con",
  poweredBy: "Con la tecnología de",
  nextGameSoon: "La próxima partida empieza pronto",
  waitingFor: (n) => `Esperando al jugador ${n}`,
  youWin: "Ganas",
  playerWins: (n) => `Gana el jugador ${n}`,
  tieShort: "Empate",
  noRun: "No hay partida que guardar",
  badName: "Elige otro nombre",
  implausible: "Esta partida no se puede guardar",
  saveFailed: "No se pudo guardar, inténtalo de nuevo",
}

const MESSAGES: Record<Lang, Messages> = { en, fr, es }
const KEY = "canyon-run:lang"

function initial(): Lang {
  if (typeof window === "undefined") return "en"
  try {
    const saved = localStorage.getItem(KEY)
    if (saved && (LANGS as ReadonlyArray<string>).includes(saved)) return saved as Lang
  } catch {
    // Private mode: use the browser's language.
  }
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.slice(0, 2).toLowerCase()
    if ((LANGS as ReadonlyArray<string>).includes(base)) return base as Lang
  }
  return "en"
}

let current: Lang = initial()
const listeners = new Set<() => void>()
if (typeof document !== "undefined") document.documentElement.lang = current

export function setLang(lang: Lang) {
  current = lang
  document.documentElement.lang = lang
  try {
    localStorage.setItem(KEY, lang)
  } catch {
    // Private mode: it just won't be remembered.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// The current language and its messages; re-renders when it changes.
export function useI18n() {
  const lang = useSyncExternalStore(
    subscribe,
    () => current,
    () => "en" as Lang
  )
  return { lang, t: MESSAGES[lang] }
}
