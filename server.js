const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const config = require('./config');

// Importar el módulo de base de datos MySQL
const db = require('./database/mysql-init');

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
    try {
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
        
        const row = await db.query(query);
        
        if (row && row.length > 0) {
            socket.emit('estadisticas-update', {
                totalSuperChats: row[0].total_superchats || 0,
                totalPuntosReales: row[0].total_puntos_reales || 0,
                totalPuntosMostrados: row[0].total_puntos_mostrados || 0,
                ultimoSuperChat: row[0].ultimo_autor ? {
                    autor: row[0].ultimo_autor,
                    mensaje: row[0].ultimo_mensaje,
                    montoUSD: row[0].ultimo_monto_usd,
                    timestamp: row[0].ultimo_timestamp
                } : null,
                timestamp: new Date().toISOString()
            });
        }
    } catch (err) {
        console.error('❌ Error obteniendo estadísticas:', err.message);
    }
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
    try {
        if (concursantes.includes("SIN CLASIFICAR")) {
            const puntosPorConcursante = Math.round(puntosUSD / 10);
            
            // Actualizar todos los concursantes
            for (const [key, concursante] of Object.entries(CONCURSANTES)) {
                await db.query(
                    `UPDATE concursantes 
                    SET puntos_reales = puntos_reales + ?,
                        updated_at = NOW()
                    WHERE nombre = ?`,
                    [puntosPorConcursante, concursante.nombre]
                );
            }
            
            return `Distribuido entre los 10 concursantes (${puntosPorConcursante} puntos cada uno)`;
            
        } else {
            const puntosPorConcursante = Math.round(puntosUSD / concursantes.length);
            
            // Actualizar solo los concursantes mencionados
            for (const nombreConcursante of concursantes) {
                await db.query(
                    `UPDATE concursantes 
                    SET puntos_reales = puntos_reales + ?,
                        updated_at = NOW()
                    WHERE nombre = ?`,
                    [puntosPorConcursante, nombreConcursante]
                );
            }
            
            return `Distribuido entre ${concursantes.length} concursante(s) (${puntosPorConcursante} puntos cada uno)`;
        }
    } catch (err) {
        console.error('❌ Error distribuyendo puntos:', err.message);
        throw err;
    }
}



async function guardarSuperChatBD(superChatData) {
    try {
        // Insertar el superchat
        const result = await db.query(
            `INSERT INTO superchats 
            (autor, mensaje, monto_original, moneda, monto_usd, concursantes_detectados, distribucion)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                superChatData.autor,
                superChatData.mensaje,
                superChatData.monto,
                superChatData.moneda,
                superChatData.montoUSD,
                JSON.stringify(superChatData.concursantes),
                superChatData.distribucion
            ]
        );
        
        const superChatId = result.insertId;
        
        // Calcular totales desde la base de datos
        const totales = await db.query(
            `SELECT SUM(puntos_reales) as total_reales
            FROM concursantes`
        );
        
        // Actualizar estadísticas
        await db.query(
            `UPDATE estadisticas 
            SET total_superchats = total_superchats + 1,
                total_puntos_reales = ?,
                ultimo_superchat_id = ?,
                updated_at = NOW()
            WHERE id = 1`,
            [totales[0].total_reales || 0, superChatId]
        );
        
        return superChatId;
    } catch (err) {
        console.error('❌ Error guardando superchat:', err.message);
        throw err;
    }
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
    try {
        const query = `
            SELECT 
                nombre,
                slug,
                puntos_reales,
                instagram_url,
                @rownum := @rownum + 1 as posicion
            FROM concursantes, (SELECT @rownum := 0) r
            ORDER BY puntos_reales DESC
        `;
        
        const rows = await db.query(query);
        
        if (rows && rows.length > 0) {
            socket.emit('puntuaciones-update', {
                success: true,
                data: rows,
                timestamp: new Date().toISOString()
            });
        }
    } catch (err) {
        console.error('❌ Error enviando puntuaciones:', err.message);
    }
}

// Función para enviar puntuaciones actualizadas a todos los clientes
async function enviarPuntuacionesActualizadas() {
    try {
        const query = `
            SELECT 
                nombre,
                slug,
                puntos_reales,
                instagram_url,
                @rownum := @rownum + 1 as posicion
            FROM concursantes, (SELECT @rownum := 0) r
            ORDER BY puntos_reales DESC
        `;
        
        const rows = await db.query(query);
        
        if (rows && rows.length > 0) {
            io.emit('puntuaciones-update', {
                success: true,
                data: rows,
                timestamp: new Date().toISOString()
            });
        }
    } catch (err) {
        console.error('❌ Error enviando puntuaciones actualizadas:', err.message);
    }
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
                
                // Verificar título del video cada 60 iteraciones (aproximadamente cada 5 minutos)
                contadorVerificaciones++;
                if (contadorVerificaciones % 60 === 0) {
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
async function startServer() {
    try {
        // Inicializar la base de datos MySQL primero
        console.log('🔄 Inicializando base de datos MySQL...');
        await db.initializeDatabase();
        console.log('✅ Base de datos MySQL inicializada correctamente');
        
        // Luego iniciar el servidor
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
    } catch (err) {
        console.error('❌ Error al iniciar el servidor:', err);
        process.exit(1);
    }
}

// Iniciar el servidor
startServer();

module.exports = app; 