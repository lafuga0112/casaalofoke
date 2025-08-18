// Palabras clave para detectar qué concursante apoya cada Super Chat
// Sistema de puntuación: 1 USD = 1 punto
const CONCURSANTES = {
  GIUSEPPE: {
    nombre: "GIUSEPPE",
    puntos: 0,
    keywords: [
      "team trujillo",
      "#teamtrujillo", 
      "trujillo",
      "trujillano",
      "voy a trujillo",
      "vamos trujillo",
      "trujillo va a ganar",
      "team trujillo ❤️",
      "team trujillo 🔥",
      "trujillo el mejor",
      "trujillo y",
      "trujillo,",
      "trujillo &",
      "giuseppe",
      "team giuseppe",
      "#teamgiuseppe",
      "giusepe",
      "team giusepe",
      "#teamgiusepe",
      'Trujilo'
    ]
  },
  JIMENEZ: {
    nombre: "JIMENEZ", 
    puntos: 0,
    keywords: [
      "team jimenez",
      "#teamjimenez",
      "jimenez",
      "jiménez",
      "voy a jimenez",
      "vamos jimenez",
      "team jiménez",
      "la casa de jimenez",
      "jiménez va a ganar",
      "jiménez y",
      "jiménez,",
      "jiménez &"
    ]
  },
  CRUSITA: {
    nombre: "CRUSITA",
    puntos: 0,
    keywords: [
      "team crusita",
      "#teamcrusita",
      "crusita",
      "voy a crusita", 
      "vamos crusita",
      "crusita 💚",
      "team crusita 💚💚💚",
      "crusita va a ganar",
      "crusita y",
      "crusita,",
      "crusita &",
      "Team Crucita",
      'Cruzita',
      'CRUCITAAAA',
      'Crucita',
      'Crisita'
    ]
  },
  LUISE: {
    nombre: "LUISE",
    puntos: 0,
    keywords: [
      "team luise",
      "#teamluise",
      "luise",
      "luice",
      "voy a luise",
      "vamos luise",
      "luise 1000 punto",
      "team luise 😻",
      "luise va a ganar",
      "luise y",
      "luise,",
      "luise &",
      'TEAMÑAÑO',
      'Ñaño',
      "Ñañitoo",
      'Louise',
      'Luis',
      'LUÍSSE'
    ]
  },
  GIGI: {
    nombre: "GIGI",
    puntos: 0,
    keywords: [
      "team gigi",
      "#teamgigi",
      "gigi",
      "voy a gigi",
      "vamos gigi", 
      "gigi 💗",
      "team gigi 💕",
      "gigi va a ganar",
      "gigi y",
      "gigi,",
      "gigi &",
      'GIIIIIIIGIIIIIIIIII',
      'teamgg',
      'gg',
    ]
  },
  PAMELA: {
    nombre: "PAMELA",
    puntos: 0,
    keywords: [
      "team pamela",
      "#teampamela",
      "pamela",
      "voy a pamela",
      "vamos pamela",
      "pamela 30",
      "team pamela 💕",
      "pamela y",
      "pamela,",
      "pamela &",
      "shupamela",
      "shup",
      'teamshuuu'
    ]
  },
  CRAZY: {
    nombre: "CRAZY",
    puntos: 0,
    keywords: [
      "team crazy",
      "#teamcrazy",
      "crazy",
      "voy a crazy",
      "vamos crazy",
      "team crazy 🪖",
      "crazy va a ganar",
      "crazy y",
      "crazy,",
      "crazy &",
      'desing'
    ]
  },
  VLADY: {
    nombre: "VLADY",
    puntos: 0,
    keywords: [
      "team vlady",
      "#teamvlady",
      "vlady",
      "voy a vlady",
      "vamos vlady",
      "team vlady 💙",
      "vlady va a ganar",
      "vlady y",
      "vlady,",
      "vlady &",
      'bladdy',
      'Blady',
      'bladi',
      'Vladi'
    ]
  },
  KAROLA: {
    nombre: "KAROLA",
    puntos: 0,
    keywords: [
      "team karola",
      "#teamkarola",
      "karola",
      "voy a karola",
      "vamos karola",
      "team karola 💜",
      "karola va a ganar",
      "karola y",
      "karola,",
      "karola &",
      'Karo',
      'Karina',
      'kaola'
    ]
  },
  PEKY: {
    nombre: "PEKY",
    puntos: 0,
    keywords: [
      "team peky",
      "#teampeky",
      "peky",
      "voy a peky",
      "vamos peky",
      "team peky 🎯",
      "peky va a ganar",
      "peky y",
      "peky,",
      "peky &",
      'peki'
    ]
  }
};

module.exports = { CONCURSANTES }; 