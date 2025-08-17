// Node 18+ (fetch nativo). Sistema de puntuación para Super Chats con detección automática de concursantes.
// Sistema de puntuación: 1 USD = 1 punto. Los Super Chats sin clasificar se distribuyen entre los 10 concursantes.

const config = require('./config');
const { getDatabase } = require('./database/init');
const { CONCURSANTES } = require('./keywords.js');
const { TASAS_CONVERSION } = require('./conversiones.js');

const API_KEY = config.youtube.apiKey;
const VIDEO_ID = config.youtube.videoId;

if (!API_KEY || !VIDEO_ID) {
  console.error("Faltan variables de entorno YT_API_KEY o YT_VIDEO_ID");
  process.exit(1);
}

// Función para convertir moneda a USD
function convertirAUSD(monto, moneda) {
  const tasa = TASAS_CONVERSION[moneda] || 1.0;
  return monto * tasa;
}

// Función para detectar qué concursante apoya el mensaje
function detectarConcursantes(mensaje) {
  const mensajeLower = mensaje.toLowerCase();
  const concursantesDetectados = [];
  
  for (const [key, concursante] of Object.entries(CONCURSANTES)) {
    for (const keyword of concursante.keywords) {
      if (mensajeLower.includes(keyword.toLowerCase())) {
        // Evitar duplicados
        if (!concursantesDetectados.includes(concursante.nombre)) {
          concursantesDetectados.push(concursante.nombre);
        }
        break; // Una vez que encontramos una keyword para este concursante, pasamos al siguiente
      }
    }
  }
  
  if (concursantesDetectados.length === 0) {
    return ["SIN CLASIFICAR"];
  }
  
  return concursantesDetectados;
}

// Función para distribuir puntos entre concursantes
function distribuirPuntos(concursantes, puntosUSD) {
  if (concursantes.includes("SIN CLASIFICAR")) {
    // Distribuir entre los 10 concursantes principales
    const puntosPorConcursante = puntosUSD / 10;
    for (const [key, concursante] of Object.entries(CONCURSANTES)) {
      concursante.puntos += puntosPorConcursante;
    }
    return `Distribuido entre los 10 concursantes (${puntosPorConcursante.toFixed(2)} puntos cada uno)`;
  } else {
    // Distribuir entre los concursantes detectados
    const puntosPorConcursante = puntosUSD / concursantes.length;
    for (const nombreConcursante of concursantes) {
      for (const [key, concursante] of Object.entries(CONCURSANTES)) {
        if (concursante.nombre === nombreConcursante) {
          concursante.puntos += puntosPorConcursante;
          break;
        }
      }
    }
    return `Distribuido entre ${concursantes.length} concursante(s) (${puntosPorConcursante.toFixed(2)} puntos cada uno)`;
  }
}

// Función para actualizar puntuaciones en la base de datos
function actualizarPuntuacionesBD() {
  return new Promise((resolve, reject) => {
    const db = getDatabase();
    
    db.serialize(() => {
      const updateStmt = db.prepare(`
        UPDATE concursantes 
        SET puntos_reales = ?, 
            puntos_mostrados = ?,
            updated_at = datetime('now')
        WHERE nombre = ?
      `);
      
      Object.values(CONCURSANTES).forEach((concursante) => {
        const puntosMostrados = Math.round(concursante.puntos * config.system.effectivenessPercentage);
        updateStmt.run(concursante.puntos, puntosMostrados, concursante.nombre);
      });
      
      updateStmt.finalize((err) => {
        if (err) {
          console.error('❌ Error actualizando puntuaciones:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
    
    db.close();
  });
}

// Función para guardar super chat en la base de datos
function guardarSuperChatBD(superChatData) {
  return new Promise((resolve, reject) => {
    const db = getDatabase();
    
    db.serialize(() => {
      // Insertar super chat
      const insertSuperChat = db.prepare(`
        INSERT INTO superchats 
        (autor, mensaje, monto_original, moneda, monto_usd, concursantes_detectados, distribucion)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      insertSuperChat.run(
        superChatData.autor,
        superChatData.mensaje,
        superChatData.monto,
        superChatData.moneda,
        superChatData.montoUSD,
        JSON.stringify(superChatData.concursantes),
        superChatData.distribucion,
        function(err) {
          if (err) {
            console.error('❌ Error insertando super chat:', err);
            reject(err);
            return;
          }
          
          const superChatId = this.lastID;
          
          // Actualizar estadísticas
          const totalPuntos = Object.values(CONCURSANTES).reduce((sum, c) => sum + c.puntos, 0);
          const totalPuntosMostrados = Math.round(totalPuntos * config.system.effectivenessPercentage);
          
          const updateStats = db.prepare(`
            UPDATE estadisticas 
            SET total_superchats = total_superchats + 1,
                total_puntos_reales = ?,
                total_puntos_mostrados = ?,
                ultimo_superchat_id = ?,
                updated_at = datetime('now')
            WHERE id = 1
          `);
          
          updateStats.run(totalPuntos, totalPuntosMostrados, superChatId, (err) => {
            if (err) {
              console.error('❌ Error actualizando estadísticas:', err);
              reject(err);
            } else {
              resolve(superChatId);
            }
          });
          
          updateStats.finalize();
        }
      );
      
      insertSuperChat.finalize();
    });
    
    db.close();
  });
}

// Función para mostrar tabla de puntuación
function mostrarPuntuacion() {
  console.log("\n" + "=".repeat(80));
  console.log("🏆 TABLA DE PUNTUACIÓN ACTUALIZADA");
  console.log("=".repeat(80));
  
  // Ordenar concursantes por puntos (descendente)
  const concursantesOrdenados = Object.values(CONCURSANTES).sort((a, b) => b.puntos - a.puntos);
  
  console.log("Posición | Concursante | Puntos USD | Puntos");
  console.log("-".repeat(80));
  
  concursantesOrdenados.forEach((concursante, index) => {
    const posicion = index + 1;
    const emoji = posicion === 1 ? "🥇" : posicion === 2 ? "🥈" : posicion === 3 ? "🥉" : "  ";
    console.log(`${emoji} ${posicion.toString().padStart(2)}    | ${concursante.nombre.padEnd(12)} | ${concursante.puntos.toFixed(2).padStart(10)} | ${Math.round(concursante.puntos).toString().padStart(6)}`);
  });
  
  console.log("=".repeat(80));
  console.log(`💰 Total de puntos en juego: ${Object.values(CONCURSANTES).reduce((sum, c) => sum + c.puntos, 0).toFixed(2)} USD`);
  console.log("=".repeat(80) + "\n");
}

async function getLiveChatId(videoId) {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.search = new URLSearchParams({
    part: "liveStreamingDetails",
    id: videoId,
    key: API_KEY,
  });

  const res = await fetch(url);
  const data = await res.json();

  if (!data.items?.length) throw new Error("Video no encontrado o no está en vivo.");
  const liveChatId = data.items[0]?.liveStreamingDetails?.activeLiveChatId;
  if (!liveChatId) throw new Error("Este video no tiene chat en vivo.");
  return liveChatId;
}

async function pollChat(liveChatId, pageToken) {
  const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
  url.search = new URLSearchParams({
    liveChatId,
    part: "snippet,authorDetails",
    key: API_KEY,
    pageToken: pageToken || "",
  });

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Error API: ${res.status} ${text}`);
  }
  return res.json();
}

(async () => {
  try {
    const liveChatId = await getLiveChatId(VIDEO_ID);
    console.log("🎯 Sistema de Puntuación para Super Chats - Alofoke Reality Show");
    console.log("💰 1 USD = 1 punto | Los Super Chats sin clasificar se distribuyen entre los 10 concursantes");
    console.log("📊 Concursantes:", Object.values(CONCURSANTES).map(c => c.nombre).join(", "));
    console.log("🔄 Escuchando Super Chats… (Ctrl+C para salir)\n");

    let nextPageToken = undefined;
    let contadorSuperChats = 0;
    
    // Actualizar puntuaciones iniciales en la base de datos
    try {
      await actualizarPuntuacionesBD();
      console.log('✅ Base de datos inicializada');
    } catch (err) {
      console.error('❌ Error inicializando base de datos:', err.message);
    }

    while (true) {
      const data = await pollChat(liveChatId, nextPageToken);

      // Solo procesar Super Chats
      for (const item of data.items || []) {
        const author = item.authorDetails?.displayName || "Desconocido";
        const snippet = item.snippet;

        // Solo Super Chat
        if (snippet?.superChatDetails) {
          contadorSuperChats++;
          const sc = snippet.superChatDetails;
          const montoOriginal = Number(sc.amountMicros || 0) / 1_000_000;
          const moneda = sc.currency || "";
          const msg = sc.userComment || "";
          const concursantes = detectarConcursantes(msg);
          
          // Convertir a USD
          const montoUSD = convertirAUSD(montoOriginal, moneda);
          
          console.log(`💥 [SUPERCHAT #${contadorSuperChats}] ${author}: ${montoOriginal} ${moneda} (${montoUSD.toFixed(2)} USD) — ${msg}`);
          
          if (concursantes.length === 1) {
            console.log(`   🎯 APOYA A: ${concursantes[0]}`);
          } else {
            console.log(`   🎯 APOYA A: ${concursantes.join(" + ")}`);
          }
          
          // Distribuir puntos
          const distribucion = distribuirPuntos(concursantes, montoUSD);
          console.log(`   💰 PUNTOS: ${distribucion}`);
          
          // Guardar en base de datos después de cada Super Chat
          const superChatData = {
            autor: author,
            monto: montoOriginal,
            moneda: moneda,
            montoUSD: montoUSD,
            mensaje: msg,
            concursantes: concursantes,
            distribucion: distribucion
          };
          
          try {
            await guardarSuperChatBD(superChatData);
            await actualizarPuntuacionesBD();
          } catch (err) {
            console.error('❌ Error guardando en base de datos:', err.message);
          }
          
          // Mostrar puntuación actualizada cada 5 Super Chats
          if (contadorSuperChats % 5 === 0) {
            mostrarPuntuacion();
          } else {
            console.log(""); // Línea en blanco para separar
          }
        }
      }

      nextPageToken = data.nextPageToken;
      const waitMs = data.pollingIntervalMillis || config.system.pollingInterval; // Usar el intervalo de YouTube o el configurado
      await new Promise(r => setTimeout(r, waitMs));
    }
  } catch (err) {
    console.error("❌", err.message);
    process.exit(1);
  }
})(); 