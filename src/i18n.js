// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys. Every text is a { en, fr } object. They
// never quote a free text of the hub beyond the zone names it gave (checked
// in src/model.js: printable, bounded): only our own words, error codes and
// the values we checked. Never the login.
// -----------------------------------------------------------------------------

const seconds = (ms) => Math.max(1, Math.round(ms / 1000));
const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));
const hours = (ms) => Math.max(1, Math.round(ms / 3_600_000));
export const delay = (ms) => {
  if (ms >= 2 * 3_600_000) return { en: `${hours(ms)} h`, fr: `${hours(ms)} h` };
  // Rounded first: 59.99 s is told "1 min", never "60 s".
  if (Math.round(ms / 1000) >= 60) return { en: `${minutes(ms)} min`, fr: `${minutes(ms)} min` };
  return { en: `${seconds(ms)} s`, fr: `${seconds(ms)} s` };
};

/** Our words for an error code of src/client.js and src/app.js. */
const REASON = {
  timeout: { en: 'no answer', fr: 'pas de réponse' },
  unreachable: { en: 'unreachable', fr: 'injoignable' },
  http: { en: 'HTTP error', fr: 'erreur HTTP' },
  redirect: {
    en: 'redirect refused (is it the hub?)',
    fr: 'redirection refusée (est-ce bien le hub ?)',
  },
  not_found: {
    en: 'no API at this address (is it a Genius Hub, port 1223?)',
    fr: 'pas d’API à cette adresse (est-ce bien un Genius Hub, port 1223 ?)',
  },
  server: { en: 'error of the hub', fr: 'erreur du hub' },
  rate_limited: { en: 'too many requests', fr: 'trop de requêtes' },
  refused: { en: 'login refused', fr: 'identifiants refusés' },
  page_refused: {
    en: 'access to this page refused to this login',
    fr: 'accès à cette page refusé à ces identifiants',
  },
  too_large: { en: 'answer too large', fr: 'réponse trop grande' },
  not_json: { en: 'answer that is not data', fr: 'réponse qui n’est pas une donnée' },
  unknown_answer: {
    en: 'not an answer of a Genius Hub',
    fr: 'ce n’est pas une réponse d’un Genius Hub',
  },
  late: { en: 'too slow', fr: 'trop lent' },
  rejected: { en: 'rejected by the hub', fr: 'rejeté par le hub' },
};

export function reason(err) {
  const text = REASON[err?.code] ?? { en: 'unexpected error', fr: 'erreur inattendue' };
  const status =
    (err?.code === 'http' || err?.code === 'server') && Number.isInteger(err.status)
      ? ` ${err.status}`
      : '';
  const error = err?.code === 'rejected' && Number.isInteger(err.error) ? ` (${err.error})` : '';
  // geniushub-client (const.py): the hub answers 503 to a wrong login too.
  const login =
    err?.code === 'server' && err.status === 503
      ? {
          en: ', also given for a wrong login: check the user name and password',
          fr: ', aussi renvoyée pour des identifiants faux : vérifiez-les',
        }
      : { en: '', fr: '' };
  return {
    en: `${text.en}${status}${error}${login.en}`,
    fr: `${text.fr}${status}${error}${login.fr}`,
  };
}

const list = (items) => items.join(', ');

/** `ago` ms ago, or undefined for a read made by this click. */
const when = (ago) =>
  ago === undefined
    ? { en: 'Read now', fr: 'Lu à l’instant' }
    : { en: `Last read ${delay(ago).en} ago`, fr: `Dernière lecture il y a ${delay(ago).fr}` };

const join = (lang, first, notes) => [first[lang], ...notes.map((n) => n[lang])].join(' ');
const withNotes = (first, notes) => ({
  en: join('en', first, notes),
  fr: join('fr', first, notes),
});

/** The next read, or nothing when no read is planned (a refused login). */
const nextRead = (next) =>
  next === undefined
    ? { en: '', fr: '' }
    : { en: ` Next read in ${delay(next).en}.`, fr: ` Prochaine lecture dans ${delay(next).fr}.` };

const hubName = (hub) => (hub?.release ? `Genius Hub ${hub.release}` : 'Genius Hub');

export const T = {
  incomplete: {
    en: 'Enter the address of your Genius Hub (its IP address on your network) and the user name and password of the hub.',
    fr: 'Saisissez l’adresse de votre Genius Hub (son adresse IP sur votre réseau) ainsi que le nom d’utilisateur et le mot de passe du hub.',
  },
  badAddress: {
    en: 'The hub address is not valid: enter an IP address or a host name, with an optional port (e.g. 192.168.1.50).',
    fr: 'L’adresse du hub n’est pas valide : saisissez une adresse IP ou un nom d’hôte, avec un port éventuel (ex. 192.168.1.50).',
  },
  badLogin: {
    en: 'The login is incomplete or not valid: fill both the user name (without ":") and the password of the hub.',
    fr: 'Les identifiants sont incomplets ou invalides : remplissez le nom d’utilisateur (sans « : ») et le mot de passe du hub.',
  },
  refused: (address, notes = []) =>
    withNotes(
      {
        en: `The Genius Hub at ${address} refuses this login: reads stopped. Correct the user name or the password and save. If you already did, click "Test the connection": a read leaves once the read interval is over.`,
        fr: `Le Genius Hub à l’adresse ${address} refuse ces identifiants : lectures arrêtées. Corrigez le nom d’utilisateur ou le mot de passe et enregistrez. Si c’est déjà fait, cliquez sur « Tester la connexion » : une lecture part dès la fin de l’intervalle de lecture.`,
      },
      notes,
    ),
  unreachable: (address, err, wait, notes = []) =>
    withNotes(
      {
        en: `The Genius Hub at ${address} could not be read (${reason(err).en}): new try in ${delay(wait).en}.`,
        fr: `Le Genius Hub à l’adresse ${address} n’a pas pu être lu (${reason(err).fr}) : nouvel essai dans ${delay(wait).fr}.`,
      },
      notes,
    ),
  paused: (address, err, wait, notes = []) =>
    withNotes(
      {
        en: `The Genius Hub at ${address} asks to wait (${reason(err).en}): reads paused, new try in ${delay(wait).en}.`,
        fr: `Le Genius Hub à l’adresse ${address} demande d’attendre (${reason(err).fr}) : lectures en pause, nouvel essai dans ${delay(wait).fr}.`,
      },
      notes,
    ),
  waiting: (address, notes = []) =>
    withNotes(
      {
        en: `Waiting for the first answer of the Genius Hub at ${address}.`,
        fr: `En attente de la première réponse du Genius Hub à l’adresse ${address}.`,
      },
      notes,
    ),
  ok: (address, hub, zones, devices, notes = []) =>
    withNotes(
      {
        en: `Connected to the ${hubName(hub)} at ${address}: ${zones} zone(s) and ${devices} device(s) read.`,
        fr: `Connecté au ${hubName(hub)} à l’adresse ${address} : ${zones} zone(s) et ${devices} appareil(s) lus.`,
      },
      notes,
    ),
  otherHub: (address, uid, notes = []) =>
    withNotes(
      {
        en: `Another Genius Hub answers at ${address} (id ${uid}): its values are not sent to the devices of the former hub. Run a Scan from the "Discover" tab to adopt it (its zones and devices then take the place of the former ones).`,
        fr: `Un autre Genius Hub répond à l’adresse ${address} (id ${uid}) : ses valeurs ne sont pas envoyées aux appareils de l’ancien hub. Lancez un Scan depuis l’onglet « Découverte » pour l’adopter (ses zones et appareils prennent alors la place des anciens).`,
      },
      notes,
    ),
  configRetry: (wait) => ({
    en: `The configuration of the integration could not be read from Gladys: new try in ${delay(wait).en}.`,
    fr: `La configuration de l’intégration n’a pas pu être lue depuis Gladys : nouvel essai dans ${delay(wait).fr}.`,
  }),
  notes: {
    outOfBounds: (name, { setpoint, left }) => ({
      en: `The hub applied ${setpoint ?? '?'} °C for ${Math.round(left / 60)} min on zone ${name}, outside the bounds of the integration: "Off" sent and kept for two minutes.`,
      fr: `Le hub a appliqué ${setpoint ?? '?'} °C pendant ${Math.round(left / 60)} min sur la zone ${name}, hors des bornes de l’intégration : « Arrêt » envoyé et maintenu pendant deux minutes.`,
    }),
    notApplied: (name) => ({
      en: `The last command of zone ${name} was accepted by the hub but not applied within 20 s.`,
      fr: `La dernière commande de la zone ${name} a été acceptée par le hub mais pas appliquée en 20 s.`,
    }),
    offFailed: (names, resends) => ({
      en: `"Off" did not take effect on zone(s) ${list(names)}: the hub shows them on; it is written again (${resends} times at most within two minutes).`,
      fr: `« Arrêt » n’a pas pris effet sur la ou les zones ${list(names)} : le hub les montre en marche ; il est réécrit (${resends} fois au plus en deux minutes).`,
    }),
    noDevice: (names) => ({
      en: `Create the device of zone(s) ${list(names)} from the "Discover" tab to receive their values.`,
      fr: `Créez l’appareil de la ou des zones ${list(names)} depuis l’onglet « Découverte » pour recevoir leurs valeurs.`,
    }),
    devicesUnread: (err) => ({
      en: `The devices of the hub (valves, thermostats, plugs, sensors) could not be read this time (${reason(err).en}); the zones are read.`,
      fr: `Les appareils du hub (vannes, thermostats, prises, capteurs) n’ont pas pu être lus cette fois (${reason(err).fr}) ; les zones sont lues.`,
    }),
    stale: (count, after) => ({
      en: `${count} device(s) have not talked to the hub for ${delay(after).en} or more: their values are not sent.`,
      fr: `${count} appareil(s) n’ont pas communiqué avec le hub depuis ${delay(after).fr} ou plus : leurs valeurs ne sont pas envoyées.`,
    }),
    sticky: (names) => ({
      en: `"Off" is being enforced on zone(s) ${list(names)}: a setting sent just before it may still be applied by the hub; it is written again if the next reads show the zone on.`,
      fr: `« Arrêt » est maintenu sur la ou les zones ${list(names)} : un réglage envoyé juste avant peut encore être appliqué par le hub ; il est réécrit si les lectures suivantes montrent la zone en marche.`,
    }),
  },
  test: {
    reading: (hub, address, zones, devices, ago, next) => {
      const one = (z) =>
        `${z.name}: ${z.mode}${z.temperature === undefined ? '' : `, ${z.temperature} °C`}${z.setpoint === undefined ? '' : ` / ${z.setpoint} °C`}`;
      const en = zones.map(one);
      return {
        en: `${when(ago).en}: ${hubName(hub)} at ${address}, ${zones.length} zone(s) and ${devices} device(s)${en.length ? `: ${en.join('; ')}` : ''}.${nextRead(next).en}`,
        fr: `${when(ago).fr} : ${hubName(hub)} à l’adresse ${address}, ${zones.length} zone(s) et ${devices} appareil(s)${en.length ? ` : ${en.join(' ; ')}` : ''}.${nextRead(next).fr}`,
      };
    },
    failed: (address, err, ago, next) => ({
      en: `${when(ago).en}: the hub at ${address} could not be read (${reason(err).en}).${nextRead(next).en}`,
      fr: `${when(ago).fr} : le hub à l’adresse ${address} n’a pas pu être lu (${reason(err).fr}).${nextRead(next).fr}`,
    }),
    notYet: (next, interval) => ({
      en: `No read yet with this configuration: the first one comes in ${delay(next).en} (never more than one every ${delay(interval).en}).`,
      fr: `Pas encore de lecture avec cette configuration : la première vient dans ${delay(next).fr} (jamais plus d’une toutes les ${delay(interval).fr}).`,
    }),
    slow: {
      en: 'The hub is slow to answer: look at the integration status in a minute.',
      fr: 'Le hub tarde à répondre : regardez l’état de l’intégration dans une minute.',
    },
  },
  /** The refusals of a command (the message of the failed ack). */
  command: {
    readOnly: {
      en: 'This value cannot be set from Gladys.',
      fr: 'Cette valeur ne se règle pas depuis Gladys.',
    },
    badValue: { en: 'Value not valid.', fr: 'Valeur non valide.' },
    outOfRange: (low, high) => ({
      en: `Setpoint out of range: ${low} to ${high} °C (the ceiling is set in the configuration of the integration).`,
      fr: `Consigne hors bornes : de ${low} à ${high} °C (le plafond se règle dans la configuration de l’intégration).`,
    }),
    setpointDisabled: {
      en: 'Setpoint commands are off: turn on "Allow the setpoint commands" in the configuration of the integration.',
      fr: 'Les commandes de consigne sont désactivées : activez « Autoriser les commandes de consigne » dans la configuration de l’intégration.',
    },
    modesDisabled: {
      en: 'Mode commands are off: turn on "Allow the mode and on commands" in the configuration of the integration ("Off" needs no option).',
      fr: 'Les commandes de mode sont désactivées : activez « Autoriser les commandes de mode et de marche » dans la configuration de l’intégration (« Arrêt » n’a pas besoin d’option).',
    },
    noSession: {
      en: 'The hub address or login is not set: nothing sent.',
      fr: 'L’adresse ou les identifiants du hub ne sont pas renseignés : rien envoyé.',
    },
    refusedLogin: {
      en: 'The hub refuses the login: nothing sent. Correct it in the configuration.',
      fr: 'Le hub refuse les identifiants : rien envoyé. Corrigez-les dans la configuration.',
    },
    paused: {
      en: 'The hub asked to wait after an error: nothing sent until the pause ends (see the integration status).',
      fr: 'Le hub a demandé d’attendre après une erreur : rien envoyé avant la fin de la pause (voir l’état de l’intégration).',
    },
    otherHub: {
      en: 'Another hub answers at this address: nothing sent. Run a Scan to adopt it.',
      fr: 'Un autre hub répond à cette adresse : rien envoyé. Lancez un Scan pour l’adopter.',
    },
    unknownZone: {
      en: 'The hub does not list this zone (or not with this kind): nothing sent. Run a Scan.',
      fr: 'Le hub ne liste pas cette zone (ou pas de ce type) : rien envoyé. Lancez un Scan.',
    },
    noFootprint: {
      en: 'This zone has no occupancy sensor: Footprint is not available.',
      fr: 'Cette zone n’a pas de détecteur de présence : Footprint n’est pas disponible.',
    },
    stillRunning: {
      en: 'A command of this zone is still running or just left: try again in a few seconds.',
      fr: 'Une commande de cette zone est encore en cours ou vient de partir : réessayez dans quelques secondes.',
    },
    stopped: {
      en: '"Off" was sent to this zone just before and is still being checked (two minutes at most): nothing sent.',
      fr: '« Arrêt » vient d’être envoyé à cette zone et est encore vérifié (deux minutes au plus) : rien envoyé.',
    },
    configChanged: {
      en: 'The configuration of the integration changed during the command: nothing sent. Send it again.',
      fr: 'La configuration de l’intégration a changé pendant la commande : rien envoyé. Renvoyez-la.',
    },
    notLoaded: {
      en: 'The configuration of the integration is not read from Gladys yet: nothing sent (see the integration status).',
      fr: 'La configuration de l’intégration n’est pas encore lue depuis Gladys : rien envoyé (voir l’état de l’intégration).',
    },
    notReadYet: {
      en: 'The hub has not been read yet: nothing sent. Try again after the first read.',
      fr: 'Le hub n’a pas encore été lu : rien envoyé. Réessayez après la première lecture.',
    },
    currentOutOfRange: (value, low, high) => ({
      en: `The current setpoint of the zone (${value ?? '?'} °C) is outside the bounds of the integration (${low} to ${high} °C): nothing sent. Send a setpoint instead.`,
      fr: `La consigne actuelle de la zone (${value ?? '?'} °C) est hors des bornes de l’intégration (${low} à ${high} °C) : rien envoyé. Envoyez plutôt une consigne.`,
    }),
    sentUnchecked: {
      en: 'Command sent and accepted by the hub, not shown yet by the zone read back: the reads of 5 s and 20 s check it (the status tells if it is not applied or applied otherwise).',
      fr: 'Commande envoyée et acceptée par le hub, pas encore visible à la relecture de la zone : les relectures à 5 s et 20 s la vérifient (l’état dit si elle n’est pas appliquée ou appliquée autrement).',
    },
    modeNotApplied: (shown, wanted) => ({
      en: `The hub accepted the command but shows the zone in mode "${shown}" instead of "${wanted}".`,
      fr: `Le hub a accepté la commande mais montre la zone en mode « ${shown} » au lieu de « ${wanted} ».`,
    }),
    appliedOther: (shown, wanted) => ({
      en: `The hub applied ${shown ?? '?'} °C instead of ${wanted} °C.`,
      fr: `Le hub a appliqué ${shown ?? '?'} °C au lieu de ${wanted} °C.`,
    }),
    appliedOutOfBounds: (shown, left) => ({
      en: `The hub applied values outside the bounds of the integration (${shown ?? '?'} °C, ${Math.round(left / 60)} min): "Off" sent to the zone.`,
      fr: `Le hub a appliqué des valeurs hors des bornes de l’intégration (${shown ?? '?'} °C, ${Math.round(left / 60)} min) : « Arrêt » envoyé à la zone.`,
    }),
    offUnchecked: {
      en: '"Off" sent and accepted by the hub, but the zone could not be read back in time: the next reads check it and write it again if needed.',
      fr: '« Arrêt » envoyé et accepté par le hub, mais la zone n’a pas pu être relue à temps : les prochaines relectures le vérifient et le réécrivent si besoin.',
    },
    offPending: (shown) => ({
      en: `"Off" sent and accepted by the hub, but the zone read back right after still shows mode "${shown}": the reads of 5 s and 20 s check it and write it again if the zone still shows on.`,
      fr: `« Arrêt » envoyé et accepté par le hub, mais la zone relue juste après montre encore le mode « ${shown} » : les relectures à 5 s et 20 s le vérifient et le réécrivent si la zone est encore en marche.`,
    }),
    tooSlow: {
      en: 'The hub was too slow to answer before the command: nothing sent.',
      fr: 'Le hub a mis trop de temps à répondre avant la commande : rien envoyé.',
    },
    unknownState: (err) => ({
      en: `The zone could not be read before the command (${reason(err).en}): nothing sent.`,
      fr: `La zone n’a pas pu être lue avant la commande (${reason(err).fr}) : rien envoyé.`,
    }),
    notSent: (err) => ({
      en: `Nothing sent (${reason(err).en}).`,
      fr: `Rien envoyé (${reason(err).fr}).`,
    }),
    rejected: (err) => ({
      en: `The hub rejected the command (${reason(err).en}): not applied.`,
      fr: `Le hub a rejeté la commande (${reason(err).fr}) : non appliquée.`,
    }),
    sentUnconfirmed: (err) => ({
      en: `Command sent, without confirmation (${reason(err).en}): the next reads tell whether the hub applied it.`,
      fr: `Commande envoyée, sans confirmation (${reason(err).fr}) : les prochaines lectures diront si le hub l’a appliquée.`,
    }),
  },
};

/** A refusal: an Error whose message is the English text (Gladys shows the message of a failed ack). */
export class Refusal extends Error {
  constructor(text) {
    super(text.en);
    this.name = 'Refusal';
    this.text = text;
  }
}
