// Node 18+ (fetch nativo). Sistema de puntuación para Super Chats (MODO BATCH).
// - Lee hasta MAX_PAGES por corrida
// - Filtra SOLO los Super Chats desde la última ejecución
// - Evita reprocesar entre corridas usando lastRunTs y nextPageToken
// - Guarda en BD y actualiza puntuaciones
// - Termina con process.exit(0)

// Importar dependencias
const fs = require('fs').promises;
const config = require('./config');
const mysql = require('mysql2/promise');
const { CONCURSANTES } = require('./keywords.js');
const { convertirAUSD } = require('./conversiones.js');
const youtubeApi = require('./youtube-api');

// Configuración de MySQL
let pool;

async function getPool() {
  if (!pool) {
    pool = await mysql.createPool({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
  }
  return pool;
}

// Constantes
const MAX_PAGES = 5; // Máximo de páginas a traer en cada corrida
const WINDOW_MS = 5 * 60 * 1000; // 5 minutos
const STATE_FILE = './state.json'; // Archivo para guardar el estado entre corridas

if (!config.youtube.apiKeys || config.youtube.apiKeys.length === 0) {
  console.error("No hay API keys configuradas");
  process.exit(1);
}

if (!config.youtube.videoId) {
  console.error("Falta variable de entorno YT_VIDEO_ID");
  process.exit(1);
}

// ===================== UTILIDADES =====================
function detectarConcursantes(mensaje) {
  const mensajeLower = (mensaje || '').toLowerCase();
  const concursantesDetectados = [];

  for (const [, concursante] of Object.entries(CONCURSANTES)) {
    for (const keyword of concursante.keywords) {
      if (mensajeLower.includes(String(keyword).toLowerCase())) {
        if (!concursantesDetectados.includes(concursante.nombre)) {
          concursantesDetectados.push(concursante.nombre);
        }
        break;
      }
    }
  }
  return concursantesDetectados.length ? concursantesDetectados : ["SIN CLASIFICAR"];
}

function distribuirPuntos(concursantes, puntosUSD) {
  if (concursantes.includes("SIN CLASIFICAR")) {
    const puntosPorConcursante = puntosUSD / 10;
    for (const [, concursante] of Object.entries(CONCURSANTES)) {
      concursante.puntos += puntosPorConcursante;
    }
    return `Distribuido entre los 10 concursantes (${puntosPorConcursante.toFixed(2)} puntos cada uno)`;
  } else {
    const puntosPorConcursante = puntosUSD / concursantes.length;
    for (const nombreConcursante of concursantes) {
      for (const [, concursante] of Object.entries(CONCURSANTES)) {
        if (concursante.nombre === nombreConcursante) {
          concursante.puntos += puntosPorConcursante;
          break;
        }
      }
    }
    return `Distribuido entre ${concursantes.length} concursante(s) (${puntosPorConcursante.toFixed(2)} puntos cada uno)`;
  }
}

async function actualizarPuntuacionesBD() {
  try {
    const db = await getPool();
    
    // Actualizar puntuaciones de concursantes
    for (const [key, concursante] of Object.entries(CONCURSANTES)) {
      await db.query(
        `UPDATE concursantes 
        SET puntos_reales = ?, 
            puntos_mostrados = ?,
            updated_at = NOW() 
        WHERE nombre = ?`,
        [
          concursante.puntos,
          Math.round(concursante.puntos * config.system.effectivenessPercentage),
          concursante.nombre
        ]
      );
    }
    
    console.log('✅ Puntuaciones actualizadas en la base de datos');
  } catch (err) {
    console.error('❌ Error actualizando puntuaciones:', err);
    throw err;
  }
}

async function actualizarTotalPuntos() {
  try {
    const db = await getPool();
    
    // Calcular totales desde la base de datos
    const [totales] = await db.query(
      `SELECT SUM(puntos_reales) as total_reales, 
              SUM(puntos_mostrados) as total_mostrados
      FROM concursantes`
    );
    
    // Actualizar estadísticas
    await db.query(
      `UPDATE estadisticas 
      SET total_puntos_reales = ?,
          total_puntos_mostrados = ?,
          updated_at = NOW()
      WHERE id = 1`,
      [
        totales[0]?.total_reales || 0,
        totales[0]?.total_mostrados || 0
      ]
    );
  } catch (err) {
    console.error('❌ Error actualizando total de puntos:', err);
  }
}

async function guardarSuperChatBD(superChatData) {
  try {
    const db = await getPool();
    
    // Generamos un ID único para el frontend
    const superChatId = Date.now();

    // Actualizar estadísticas
    await db.query(
      `UPDATE estadisticas 
      SET total_superchats = total_superchats + 1,
          updated_at = NOW()
      WHERE id = 1`
    );
    
    return superChatId;
  } catch (err) {
    console.error('❌ Error actualizando estadísticas:', err);
    throw err;
  }
}

function mostrarPuntuacion() {


  const concursantesOrdenados = Object.values(CONCURSANTES).sort((a, b) => b.puntos - a.puntos);


  concursantesOrdenados.forEach((concursante, index) => {
    const posicion = index + 1;
    const emoji = posicion === 1 ? "🥇" : posicion === 2 ? "🥈" : posicion === 3 ? "🥉" : "  ";
  });


}

// ===================== API YOUTUBE =====================
async function getLiveChatId(videoId) {
  return youtubeApi.getLiveChatId(videoId);
}

async function pollChat(liveChatId, pageToken) {
  return youtubeApi.pollChat(liveChatId, pageToken);
}

// ===================== ESTADO BATCH =====================
async function loadState() {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { nextPageToken: null, lastRunTs: 0 };
  }
}

async function saveState(state) {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

// ===================== MAIN (BATCH) =====================
(async () => {
  try {
    // Cargar las claves API desde la base de datos
    await youtubeApi.cargarApiKeys();
    
    const liveChatId = await youtubeApi.getLiveChatId(config.youtube.videoId);
    const state = await loadState();

    // Ventana de análisis: últimos 5 minutos, pero no repetimos respecto a la última corrida
    const now = Date.now();
    const lowerBound = Math.max(state.lastRunTs || 0, now - WINDOW_MS);

    let nextToken = state.nextPageToken || null;
    let pagesFetched = 0;
    let allItems = [];

    // Trae hasta MAX_PAGES
    while (true) {
      const data = await youtubeApi.pollChat(liveChatId, nextToken);
      allItems = allItems.concat(data.items || []);
      nextToken = data.nextPageToken || null;
      pagesFetched += 1;

      if (!nextToken || pagesFetched >= MAX_PAGES) break;
    }

    // Procesa SOLO Super Chats dentro de la ventana (>= lowerBound)
    const PROCESADOS = new Set(); // dedupe dentro de la corrida
    let contadorSC = 0;
    let totalUSDenVentana = 0;

    // DB: preparar un batch "lógico": guardamos cada SC, y actualizamos puntuaciones al final
    for (const item of allItems) {
      if (!item || PROCESADOS.has(item.id)) continue;
      PROCESADOS.add(item.id);

      const sn = item.snippet;
      const ts = new Date(sn.publishedAt).getTime();
      if (ts < lowerBound) continue;

      const sc = sn.superChatDetails;
      if (!sc) continue;

      contadorSC++;
      const author = (item.authorDetails && item.authorDetails.displayName) || "Desconocido";
      const montoOriginal = Number(sc.amountMicros || 0) / 1_000_000;
      const moneda = sc.currency || "";
      const msg = sc.userComment || "";

      const concursantes = detectarConcursantes(msg);
      const montoUSD = convertirAUSD(montoOriginal, moneda);
      totalUSDenVentana += montoUSD;

      const distribucion = distribuirPuntos(concursantes, montoUSD);


      // Guarda cada SC en BD
      try {
        await guardarSuperChatBD({
          montoUSD,
          concursantes,
          distribucion
        });
      } catch (err) {
        console.error('❌ Error actualizando puntos:', err.message);
      }
    }

    // Actualiza puntuaciones al final del batch
    try {
      await actualizarPuntuacionesBD();
      await actualizarTotalPuntos(); // Actualizar el total de puntos
    } catch (err) {
      console.error('❌ Error actualizando puntuaciones:', err.message);
    }

    // Persistimos el avance para la próxima corrida
    await saveState({ nextPageToken: nextToken, lastRunTs: now });

    // Fin batch
    process.exit(0);
  } catch (err) {
    console.error("❌", err.message);
    process.exit(1);
  }
})();
