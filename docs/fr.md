# Genius Hub pour Gladys Assistant

Intégration non officielle, sans lien avec Genius Hub (Heat Genius Ltd).
Elle lit un Genius Hub par son **API locale** (port 1223 du hub, sans cloud)
et permet à Gladys de voir et de piloter les zones de chauffage de la maison.
**Jamais testé avec un vrai Genius Hub** : écrit d'après la documentation
publique et la bibliothèque geniushub-client, celle de Home Assistant.
Signalez ce qui diffère sur votre hub.

## Ce que vous obtenez

Un appareil Gladys par **zone** du hub :

| Type de zone                           | Lecture                                                                                                                                     | Commandes                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Pièce à radiateurs, plancher chauffant | température, consigne, mode du thermostat, demande de chauffe, mode Genius, dérogation restante, présence (zones avec détecteur), anomalies | consigne, mode du thermostat (arrêt / chauffage), mode Genius (off, timer, footprint, override) |
| Eau chaude                             | température de l'eau, consigne, mode eau chaude, chauffe, dérogation restante, anomalies                                                    | consigne, mode eau chaude (arrêt / timer / override)                                            |
| Minuterie marche/arrêt                 | marche, mode Genius, dérogation restante, anomalies                                                                                         | marche / arrêt, mode Genius (off, timer, override)                                              |

Et un appareil **en lecture seule** par appareil relié au hub (vanne de
radiateur, thermostat d'ambiance, prise, récepteur, détecteur de mouvement ou
capteur de pièce) : température, consigne de la vanne, batterie, luminosité,
mouvement, sortie. Le hub les pilote depuis ses zones ; Gladys ne les
commande jamais. La zone « My House » (gestionnaire), les groupes et le
module OpenTherm ne sont pas proposés.

## Configuration

1. Trouvez l'**adresse IP** du hub (votre box, ou l'application Genius Hub :
   Réglages > Hub). Donnez-lui une adresse fixe dans votre box si possible.
2. Saisissez le **nom d'utilisateur et le mot de passe du hub** (ceux de son
   interface web locale, tels que le hub les demande ; pas le compte
   my.geniushub.co.uk). Le mot de passe est gardé par Gladys dans sa base,
   jamais réaffiché, jamais écrit dans les journaux, envoyé seulement au
   hub, comme il le demande (HTTP sur votre réseau, le mot de passe sous
   forme de hachage).
3. Enregistrez, puis ouvrez l'onglet **Découverte** et créez les zones et
   appareils voulus.
4. Les commandes sont **désactivées par défaut** : activez « Autoriser les
   commandes de consigne » et/ou « Autoriser les commandes de mode et de
   marche » quand vous voulez piloter le chauffage depuis Gladys. « Arrêt »
   n'a pas besoin d'option.

Le hub est lu toutes les 60 s par défaut (jamais moins), et les zones à
nouveau 5 s et 20 s après une commande.

## Les commandes en détail

- Une **consigne** envoyée depuis Gladys est une **dérogation** de la zone
  pour la durée configurée (60 min par défaut, de 10 à 1440), comme le
  « boost » de l'application ; la zone revient ensuite à son timer ou à son
  mode. Consignes de pièce : de 4 à 28 °C par demi-degré, plafonnées par
  « Consigne de pièce la plus haute » (25 °C par défaut). Eau chaude :
  degrés entiers, de 30 à 60 °C, plafonnés par « Consigne d'eau chaude la
  plus haute » (55 °C par défaut, 60 au plus).
- **Mode du thermostat** : « Chauffage » met la zone sur son timer ;
  « Arrêt » l'arrête. **Mode Genius** : off, timer, footprint (zones avec
  détecteur de présence seulement), override (la consigne actuelle pour la
  durée configurée). **Mode eau chaude** : arrêt, timer, override (boost à
  la consigne actuelle). **Zone marche/arrêt** : « marche » est une
  dérogation de la durée configurée, « arrêt » arrête la zone.
- Avant qu'une consigne, un mode ou une « marche » ne parte, les zones sont
  relues : la commande est décidée sur cette lecture fraîche, jamais sur des
  valeurs en mémoire. Elle est refusée, rien envoyé, quand : son option est
  désactivée ; la valeur n'est pas valide ou hors des bornes ci-dessus ; le
  hub ne liste pas la zone, ou la liste avec un autre type ; un autre hub
  répond à l'adresse (lancez un Scan pour l'adopter) ; le hub refuse les
  identifiants ; le hub a demandé d'attendre après une erreur (une pause) ;
  la zone traite encore une commande ou une est partie il y a moins de 2 s ;
  « Arrêt » a été envoyé à la zone il y a moins de 2 min (voir ci-dessous) ;
  le hub a mis plus d'environ 3 s à répondre à la lecture fraîche. Le
  message du refus dit laquelle.
- **« Arrêt »** (mode du thermostat, mode Genius, mode eau chaude ou état
  marche/arrêt) n'a pas besoin d'option, n'attend aucune lecture, passe
  pendant une pause et malgré des identifiants refusés (un essai), et annule
  une consigne ou un mode de la même zone pas encore envoyé. Il est refusé,
  rien envoyé, seulement quand : l'adresse ou les identifiants du hub ne
  sont pas renseignés ; la requête n'a pas pu partir en environ 3 s (une
  écriture de la même zone encore en train de partir, un hub qui refuse la
  connexion) ; le hub la rejette (numéro d'erreur dans le message). Quand
  une consigne ou un mode de la zone est parti moins de 2 min avant
  l'« Arrêt », le hub peut encore l'appliquer après : l'« Arrêt » est alors
  **maintenu** pendant 2 min (les relectures le réécrivent si la zone se
  montre en marche, 3 fois au plus) et aucune commande qui relancerait la
  zone n'est prise entre-temps ; l'état le dit.
- Une écriture à laquelle le hub n'a pas répondu (silence, connexion coupée,
  erreur serveur) est annoncée « envoyée, sans confirmation » : les lectures
  suivantes montrent si le hub l'a appliquée. Une écriture à laquelle le hub
  a répondu est relue aussitôt quand le budget le permet, et dans tous les
  cas 5 s et 20 s après.

## Valeurs

- Les valeurs d'une zone sont publiées à chaque lecture. Celles d'un
  appareil relié au hub ne le sont que quand l'appareil a communiqué avec le
  hub depuis les dernières valeurs publiées (le hub donne l'heure de sa
  dernière communication), et pas quand c'était il y a plus de 2 h : l'état
  compte alors ces appareils.
- Les valeurs inchangées sont renvoyées toutes les 30 min.

## État et pauses

- Des identifiants refusés par le hub (HTTP 401 ou 403) arrêtent les
  lectures jusqu'à ce que vous les changiez ou cliquiez sur « Tester la
  connexion », qui réessaie une fois.
- Après un 429 ou un 5xx du hub, les lectures font une pause (1 min, doublée
  jusqu'à 6 h, ou le délai demandé par le hub), gardée au redémarrage. Un
  hub injoignable est réessayé après 30 s, 1 min, 2 min... jusqu'à 10 min,
  jamais plus tôt que l'intervalle de lecture.
- Le hub est reconnu par son identifiant unique. Si un autre hub répond à
  l'adresse, rien n'est publié vers les appareils de l'ancien tant que vous
  n'avez pas lancé un Scan depuis l'onglet Découverte, qui adopte le nouveau
  hub.

## Pas dans cette version

L'API cloud v1 (my.geniushub.co.uk), les programmes (timer et footprint), la
zone « My House » et les modes de toute la maison, les groupes, le module
OpenTherm de la chaudière, les anomalies en appareils séparés, les commandes
sur les appareils eux-mêmes (prises, vannes). Voir `TODO.md`.
