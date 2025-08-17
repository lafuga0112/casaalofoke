const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const config = require('./config');
const { getDatabase } = require('./database/init');

// Importar funciones del monitor de Super Chats
const { CONCURSANTES } = require('./keywords.js');
const { TASAS_CONVERSION } = require('./conversiones.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const PORT = config.server.port;

// Variables globales para el monitor de Super Chats
let isMonitoringActive = false;
let contadorSuperChats = 0;
let clientesConectados = 0;
let diaActualReality = 1; // Día por defecto
let tituloVideoActual = "";

// WebSocket connections
io.on('connection', (socket) => {
    clientesConectados++;
    console.log(`🔌 Cliente conectado. Total: ${clientesConectados}`);
    
    // Enviar estado inicial al cliente
    socket.emit('monitor-status', {
        isActive: isMonitoringActive,
        totalSuperChats: contadorSuperChats,
        diaActual: diaActualReality,
        tituloVideo: tituloVideoActual,
        timestamp: new Date().toISOString()
    });
    
    // Enviar estadísticas y puntuaciones iniciales
    obtenerEstadisticasParaSocket(socket);
    enviarPuntuacionesACliente(socket);
    
    socket.on('disconnect', () => {
        clientesConectados--;
        console.log(`🔌 Cliente desconectado. Total: ${clientesConectados}`);
    });
    
    // Handler para solicitud de puntuaciones
    socket.on('get-puntuaciones', () => {
        enviarPuntuacionesACliente(socket);
    });
});

// Función para obtener y enviar estadísticas via socket
async function obtenerEstadisticasParaSocket(socket) {
    const db = getDatabase();
    
    const query = `
        SELECT 
            e.*,
            s.autor as ultimo_autor,
            s.mensaje as ultimo_mensaje,
            s.monto_usd as ultimo_monto_usd,
            s.timestamp as ultimo_timestamp
        FROM estadisticas e
        LEFT JOIN superchats s ON e.ultimo_superchat_id = s.id
        WHERE e.id = 1
    `;
    
    db.get(query, [], (err, row) => {
        db.close();
        if (!err && row) {
            socket.emit('estadisticas-update', {
                totalSuperChats: row.total_superchats || 0,
                totalPuntosReales: row.total_puntos_reales || 0,
                totalPuntosMostrados: row.total_puntos_mostrados || 0,
                ultimoSuperChat: row.ultimo_autor ? {
                    autor: row.ultimo_autor,
                    mensaje: row.ultimo_mensaje,
                    montoUSD: row.ultimo_monto_usd,
                    timestamp: row.ultimo_timestamp
                } : null,
                timestamp: new Date().toISOString()
            });
        }
    });
}

// Funciones del monitor de Super Chats
function convertirAUSD(monto, moneda) {
    const tasa = TASAS_CONVERSION[moneda] || 1.0;
    return monto * tasa;
}

function detectarConcursantes(mensaje) {
    const mensajeLower = mensaje.toLowerCase();
    const concursantesDetectados = [];
    
    for (const [key, concursante] of Object.entries(CONCURSANTES)) {
        for (const keyword of concursante.keywords) {
            if (mensajeLower.includes(keyword.toLowerCase())) {
                if (!concursantesDetectados.includes(concursante.nombre)) {
                    concursantesDetectados.push(concursante.nombre);
                }
                break;
            }
        }
    }
    
    if (concursantesDetectados.length === 0) {
        return ["SIN CLASIFICAR"];
    }
    
    return concursantesDetectados;
}

async function distribuirPuntos(concursantes, puntosUSD) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        
        if (concursantes.includes("SIN CLASIFICAR")) {
            const puntosPorConcursante = Math.round(puntosUSD / 10);
            
            // Actualizar directamente en la base de datos
            const updateStmt = db.prepare(`
                UPDATE concursantes 
                SET puntos_reales = puntos_reales + ?,
                    updated_at = datetime('now')
                WHERE nombre = ?
            `);
            
            Object.values(CONCURSANTES).forEach((concursante) => {
                updateStmt.run(
                    puntosPorConcursante, 
                    concursante.nombre
                );
            });
            
            updateStmt.finalize((err) => {
                db.close();
                if (err) {
                    reject(err);
                } else {
                    resolve(`Distribuido entre los 10 concursantes (${puntosPorConcursante} puntos cada uno)`);
                }
            });
            
        } else {
            const puntosPorConcursante = Math.round(puntosUSD / concursantes.length);
            
            // Actualizar directamente en la base de datos
            const updateStmt = db.prepare(`
                UPDATE concursantes 
                SET puntos_reales = puntos_reales + ?,
                    updated_at = datetime('now')
                WHERE nombre = ?
            `);
            
            concursantes.forEach((nombreConcursante) => {
                updateStmt.run(
                    puntosPorConcursante, 
                    nombreConcursante
                );
            });
            
            updateStmt.finalize((err) => {
                db.close();
                if (err) {
                    reject(err);
                } else {
                    resolve(`Distribuido entre ${concursantes.length} concursante(s) (${puntosPorConcursante} puntos cada uno)`);
                }
            });
        }
    });
}



async function guardarSuperChatBD(superChatData) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        
        db.serialize(() => {
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
                        db.close();
                        reject(err);
                        return;
                    }
                    
                    const superChatId = this.lastID;
                    
                    // Los totales se calcularán desde la base de datos, no desde memoria
                    const totalPuntos = 0; // Se actualizará desde la BD
                    const totalPuntosMostrados = 0; // Se actualizará desde la BD
                    
                    // Calcular totales desde la base de datos
                    db.get(`
                        SELECT 
                            SUM(puntos_reales) as total_reales
                        FROM concursantes
                    `, [], (err, totales) => {
                        if (err) {
                            console.error('❌ Error calculando totales:', err);
                            reject(err);
                            return;
                        }
                        
                        const updateStats = db.prepare(`
                            UPDATE estadisticas 
                            SET total_superchats = total_superchats + 1,
                                total_puntos_reales = ?,
                                ultimo_superchat_id = ?,
                                updated_at = datetime('now')
                            WHERE id = 1
                        `);
                        
                        updateStats.run(
                            totales.total_reales || 0, 
                            superChatId, 
                            (err) => {
                            updateStats.finalize();
                            db.close((closeErr) => {
                                if (closeErr) {
                                    console.error('❌ Error cerrando base de datos:', closeErr);
                                }
                                if (err) {
                                    console.error('❌ Error actualizando estadísticas:', err);
                                    reject(err);
                                } else {
                                    resolve(superChatId);
                                }
                            });
                        });
                    });
                }
            );
            
            insertSuperChat.finalize();
        });
    });
}

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static('.')); // Servir archivos estáticos desde la raíz

// Rutas para archivos estáticos
app.use('/images', express.static('images'));

// Solo ruta para servir la interfaz web

// Servir la interfaz web
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Middleware de manejo de errores
app.use((err, req, res, next) => {
    console.error('Error no manejado:', err);
    res.status(500).json({
        success: false,
        error: 'Error interno del servidor',
        timestamp: new Date().toISOString()
    });
});

// Ruta 404
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Ruta no encontrada',
        timestamp: new Date().toISOString()
    });
});

// Función para enviar puntuaciones a un cliente específico
async function enviarPuntuacionesACliente(socket) {
    const db = getDatabase();
    
    const query = `
        SELECT 
            nombre,
            slug,
            puntos_reales,
            instagram_url,
            ROW_NUMBER() OVER (ORDER BY puntos_reales DESC) as posicion
        FROM concursantes 
        ORDER BY puntos_reales DESC
    `;
    
    db.all(query, [], (err, rows) => {
        db.close();
        if (!err && rows) {
            socket.emit('puntuaciones-update', {
                success: true,
                data: rows,
                timestamp: new Date().toISOString()
            });
        }
    });
}

// Función para enviar puntuaciones actualizadas a todos los clientes
async function enviarPuntuacionesActualizadas() {
    const db = getDatabase();
    
    const query = `
        SELECT 
            nombre,
            slug,
            puntos_reales,
            instagram_url,
            ROW_NUMBER() OVER (ORDER BY puntos_reales DESC) as posicion
        FROM concursantes 
        ORDER BY puntos_reales DESC
    `;
    
    db.all(query, [], (err, rows) => {
        db.close();
        if (!err && rows) {
            io.emit('puntuaciones-update', {
                success: true,
                data: rows,
                timestamp: new Date().toISOString()
            });
        }
    });
}

// Funciones del API de YouTube
async function getVideoInfo(videoId) {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.search = new URLSearchParams({
        part: "snippet,liveStreamingDetails",
        id: videoId,
        key: config.youtube.apiKey,
    });

    const res = await fetch(url);
    const data = await res.json();

    if (!data.items?.length) throw new Error("Video no encontrado o no está en vivo.");
    
    const video = data.items[0];
    const liveChatId = video.liveStreamingDetails?.activeLiveChatId;
    if (!liveChatId) throw new Error("Este video no tiene chat en vivo.");
    
    return {
        liveChatId,
        titulo: video.snippet?.title || "Sin título",
        descripcion: video.snippet?.description || "",
        fechaInicio: video.liveStreamingDetails?.actualStartTime || new Date().toISOString()
    };
}

async function getLiveChatId(videoId) {
    const videoInfo = await getVideoInfo(videoId);
    return videoInfo.liveChatId;
}

// Función para extraer el día del título del video
function extraerDiaDelTitulo(titulo) {
    // Patrones comunes para detectar el día
    const patrones = [
        /LA CASA.*?DIA\s*(\d+)/i,
        /ALOFOKE.*?DIA\s*(\d+)/i,
        /DIA\s*(\d+)/i,
        /DAY\s*(\d+)/i,
        /D(\d+)/i
    ];
    
    for (const patron of patrones) {
        const match = titulo.match(patron);
        if (match && match[1]) {
            const dia = parseInt(match[1]);
            if (dia > 0 && dia <= 100) { // Validar que sea un día razonable
                return dia;
            }
        }
    }
    
    return null; // No se pudo extraer el día
}

// Función para actualizar el día detectado
function actualizarDiaReality(nuevoTitulo) {
    if (nuevoTitulo && nuevoTitulo !== tituloVideoActual) {
        const diaDetectado = extraerDiaDelTitulo(nuevoTitulo);
        
        if (diaDetectado && diaDetectado !== diaActualReality) {
            const diaAnterior = diaActualReality;
            diaActualReality = diaDetectado;
            tituloVideoActual = nuevoTitulo;
            
            console.log(`\n🏠 NUEVO DÍA DETECTADO:`);
            console.log(`📺 Título: "${nuevoTitulo}"`);
            console.log(`📅 Día anterior: ${diaAnterior} → Nuevo día: ${diaActualReality}`);
            
            // Enviar actualización a todos los clientes WebSocket
            io.emit('dia-actualizado', {
                diaAnterior: diaAnterior,
                diaActual: diaActualReality,
                titulo: nuevoTitulo,
                timestamp: new Date().toISOString()
            });
            
            return true; // Día actualizado
        } else if (diaDetectado) {
            // Día detectado pero no cambió
            tituloVideoActual = nuevoTitulo;
        }
    }
    
    return false; // No hubo cambios
}

async function pollChat(liveChatId, pageToken) {
    const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
    url.search = new URLSearchParams({
        liveChatId,
        part: "snippet,authorDetails",
        key: config.youtube.apiKey,
        pageToken: pageToken || "",
    });

    const res = await fetch(url);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Error API: ${res.status} ${text}`);
    }
    return res.json();
}

// Monitor de Super Chats integrado
async function iniciarMonitorSuperChats() {
    if (isMonitoringActive) {
        console.log('⚠️ Monitor de Super Chats ya está activo');
        return;
    }
    
    try {
        console.log('🔄 Iniciando monitor de Super Chats...');
        
        // Obtener información completa del video
        const videoInfo = await getVideoInfo(config.youtube.videoId);
        const liveChatId = videoInfo.liveChatId;
        
        // Detectar y actualizar el día del reality
        actualizarDiaReality(videoInfo.titulo);
        
        console.log('🎯 Monitor de Super Chats integrado al servidor web');
        console.log(`📺 Video: "${videoInfo.titulo}"`);
        console.log(`📅 Día detectado: ${diaActualReality}`);
        console.log('💰 1 USD = 1 punto | Super Chats sin clasificar se distribuyen entre 10 concursantes');
        console.log('📊 Concursantes:', Object.values(CONCURSANTES).map(c => c.nombre).join(", "));
        console.log('🔄 Escuchando Super Chats en tiempo real...\n');

        isMonitoringActive = true;
        let nextPageToken = undefined;
        let contadorVerificaciones = 0;

        // Base de datos lista - los puntos se gestionan directamente en BD
        console.log('✅ Base de datos sincronizada');

        while (isMonitoringActive) {
            try {
                const data = await pollChat(liveChatId, nextPageToken);

                for (const item of data.items || []) {
                    const author = item.authorDetails?.displayName || "Desconocido";
                    const snippet = item.snippet;

                    if (snippet?.superChatDetails) {
                        contadorSuperChats++;
                        const sc = snippet.superChatDetails;
                        const montoOriginal = Number(sc.amountMicros || 0) / 1_000_000;
                        const moneda = sc.currency || "";
                        const msg = sc.userComment || "";
                        const concursantes = detectarConcursantes(msg);
                        
                        const montoUSD = Math.round(convertirAUSD(montoOriginal, moneda));
                        
                        console.log(`\n💥 [SUPERCHAT #${contadorSuperChats}] ${author}: ${montoOriginal} ${moneda} (${montoUSD} USD)`);
                        console.log(`📝 Mensaje: "${msg}"`);
                        
                        if (concursantes.length === 1) {
                            console.log(`🎯 APOYA A: ${concursantes[0]}`);
                        } else {
                            console.log(`🎯 APOYA A: ${concursantes.join(" + ")}`);
                        }
                        
                        const distribucion = await distribuirPuntos(concursantes, montoUSD);
                        console.log(`💰 PUNTOS: ${distribucion}`);
                        
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
                            const superChatId = await guardarSuperChatBD(superChatData);
                            console.log(`✅ Datos guardados en base de datos`);
                            
                            // Calcular puntos realmente distribuidos
                            const puntosDistribuidos = concursantes.includes("SIN CLASIFICAR") ? 
                                Math.round(montoUSD / 10) : Math.round(montoUSD / concursantes.length);
                            
                            // Enviar Super Chat via WebSocket a todos los clientes conectados
                            const superChatParaEnviar = {
                                id: superChatId,
                                numero: contadorSuperChats,
                                autor: author,
                                mensaje: msg,
                                montoOriginal: montoOriginal,
                                moneda: moneda,
                                montoUSD: montoUSD,
                                puntosDistribuidos: puntosDistribuidos,
                                concursantes: concursantes,
                                distribucion: distribucion,
                                puntosAsignados: concursantes.includes("SIN CLASIFICAR") ? 
                                    Object.values(CONCURSANTES).map(c => c.nombre) : concursantes,
                                timestamp: new Date().toISOString()
                            };
                            
                            io.emit('nuevo-superchat', superChatParaEnviar);
                            console.log(`📡 Super Chat enviado a ${clientesConectados} cliente(s) conectado(s)`);
                            
                            // Enviar puntuaciones actualizadas
                            enviarPuntuacionesActualizadas();
                            
                        } catch (err) {
                            console.error('❌ Error guardando en base de datos:', err.message);
                        }
                        
                        console.log('-'.repeat(80));
                    }
                }

                nextPageToken = data.nextPageToken;
                const waitMs = data.pollingIntervalMillis || config.system.pollingInterval;
                
                // Verificar título del video cada 10 iteraciones (aproximadamente cada 50 segundos)
                contadorVerificaciones++;
                if (contadorVerificaciones % 10 === 0) {
                    try {
                        const videoInfoActualizada = await getVideoInfo(config.youtube.videoId);
                        const diaActualizado = actualizarDiaReality(videoInfoActualizada.titulo);
                        
                        if (diaActualizado) {
                            console.log('🔄 Día del reality actualizado automáticamente');
                        }
                    } catch (err) {
                        console.error('⚠️ Error verificando título del video:', err.message);
                    }
                }
                
                await new Promise(r => setTimeout(r, waitMs));
                
            } catch (err) {
                console.error('❌ Error en monitor:', err.message);
                await new Promise(r => setTimeout(r, 10000)); // Esperar 10s antes de reintentar
            }
        }
        
    } catch (err) {
        console.error('❌ Error iniciando monitor:', err.message);
        isMonitoringActive = false;
    }
}

// Iniciar servidor
server.listen(PORT, () => {
    console.log('🚀 Servidor Express + WebSocket iniciado');
    console.log(`🌐 Interfaz web en: http://localhost:${PORT}`);
    console.log(`📡 WebSocket: Tiempo real para Super Chats y puntuaciones`);
    console.log(`🎯 Eventos WebSocket disponibles:`);
    console.log(`   nuevo-superchat - Super Chats en tiempo real`);
    console.log(`   puntuaciones-update - Puntuaciones actualizadas`);
    console.log(`   estadisticas-update - Estadísticas generales`);
    console.log(`   monitor-status - Estado del monitor`);
    console.log('🔄 Presiona Ctrl+C para detener el servidor\n');
    
    // Iniciar monitor de Super Chats automáticamente
    setTimeout(() => {
        iniciarMonitorSuperChats().catch(err => {
            console.error('❌ Error iniciando monitor de Super Chats:', err.message);
            console.log('ℹ️ El servidor web seguirá funcionando sin el monitor');
        });
    }, 2000); // Esperar 2 segundos para que el servidor esté completamente listo
});

module.exports = app; 