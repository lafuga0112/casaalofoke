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

// Función para obtener la siguiente API key en rotación
function getNextApiKey() {
    const keys = config.youtube.apiKeys;
    if (!keys || keys.length === 0) {
        throw new Error('No hay API keys configuradas');
    }
    
    // Incrementar el índice y hacer rotación si es necesario
    config.youtube.lastKeyIndex = (config.youtube.lastKeyIndex + 1) % keys.length;
    
    return keys[config.youtube.lastKeyIndex];
}

// Función para manejar errores de cuota de la API de YouTube
async function handleApiRequest(requestFn) {
    const maxRetries = config.youtube.apiKeys.length; // Intentar con todas las API keys disponibles
    let lastError = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await requestFn();
        } catch (error) {
            lastError = error;
            
            // Verificar si es un error de cuota o API key inválida
            if (error.message.includes('quota') || 
                error.message.includes('403') || 
                error.message.includes('API key not valid') || 
                error.message.includes('400')) {
                
                console.error(`❌ Error con API key #${config.youtube.lastKeyIndex + 1}: ${error.message}`);
                console.log(`🔄 Intentando con siguiente API key...`);
                // Ya estamos rotando la API key en cada llamada a getNextApiKey
                continue;
            }
            
            // Si no es un error de cuota o API key, propagar el error
            throw error;
        }
    }
    
    // Si llegamos aquí, todas las API keys han fallado
    console.error('❌ Todas las API keys han fallado. Verifica que sean válidas y tengan cuota disponible.');
    throw lastError;
}

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
        // Ya no insertamos el superchat en la base de datos
        // Solo generamos un ID único para el frontend
        const superChatId = Date.now(); // Usar timestamp como ID único
        
        // Calcular totales desde la base de datos
        const [totales] = await db.query(
            `SELECT SUM(puntos_reales) as total_reales
            FROM concursantes`
        );
        
        // Actualizar estadísticas (sin guardar referencia al superchat)
        await db.query(
            `UPDATE estadisticas 
            SET total_superchats = total_superchats + 1,
                total_puntos_reales = ?,
                updated_at = NOW()
            WHERE id = 1`,
            [totales[0]?.total_reales || 0]
        );
        
        return superChatId;
    } catch (err) {
        console.error('❌ Error actualizando puntos:', err.message);
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
    return handleApiRequest(async () => {
        const url = new URL("https://www.googleapis.com/youtube/v3/videos");
        url.search = new URLSearchParams({
            part: "snippet,liveStreamingDetails",
            id: videoId,
            key: getNextApiKey(),
        });

        const res = await fetch(url);
        const data = await res.json();
        
        // Verificar errores de la API
        if (data.error) {
            throw new Error(`Error API: ${data.error.code} ${data.error.message}`);
        }

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
    });
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
    return handleApiRequest(async () => {
        const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
        url.search = new URLSearchParams({
            liveChatId,
            part: "snippet,authorDetails",
            key: getNextApiKey(),
            pageToken: pageToken || "",
        });

        const res = await fetch(url);
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Error API: ${res.status} ${text}`);
        }
        
        const data = await res.json();
        
        // Verificar errores de la API
        if (data.error) {
            throw new Error(`Error API: ${data.error.code} ${data.error.message}`);
        }
        
        return data;
    });
}

// Monitor de Super Chats integrado
async function iniciarMonitorSuperChats() {
    if (isMonitoringActive) {
        console.log('⚠️ Monitor de Super Chats ya está activo');
        return;
    }
    
    try {
        console.log('🔄 Iniciando monitor de Super Chats...');
        
        // Obtener información del video
        const videoInfo = await getVideoInfo(config.youtube.videoId);
        
        // Detectar y actualizar el día del reality
        actualizarDiaReality(videoInfo.titulo);
        
        console.log('🎯 Monitor de Super Chats integrado al servidor web');
        
        isMonitoringActive = true;

        // Base de datos lista
        console.log('✅ Base de datos sincronizada');

        // Función para verificar el título del video
        const verificarTitulo = async () => {
            try {
                const videoInfoActualizada = await getVideoInfo(config.youtube.videoId);
                const diaActualizado = actualizarDiaReality(videoInfoActualizada.titulo);
                
                if (diaActualizado) {
                    console.log('🔄 Día del reality actualizado automáticamente');
                }
            } catch (err) {
                console.error('⚠️ Error verificando título del video:', err.message);
            }
            
            // Solo programar la próxima verificación si el monitor sigue activo
            if (isMonitoringActive) {
                setTimeout(verificarTitulo, 2 * 60 * 60 * 1000); // 2 horas
            }
        };
        
        // Iniciar verificación periódica (primera verificación inmediata, luego cada 2 horas)
        verificarTitulo();

        // Obtener el liveChatId del videoInfo
        const liveChatId = videoInfo.liveChatId;
        let nextPageToken = null;

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
                        
                        // Distribuir puntos entre los concursantes
                        const distribucion = await distribuirPuntos(concursantes, montoUSD);
                        
                        // Datos mínimos necesarios para actualizar puntos
                        const superChatData = {
                            montoUSD: montoUSD,
                            concursantes: concursantes,
                            distribucion: distribucion
                        };
                        
                        try {
                            // Actualizar puntos sin guardar el mensaje
                            const superChatId = await guardarSuperChatBD(superChatData);
                            
                            // Calcular puntos realmente distribuidos
                            const puntosDistribuidos = concursantes.includes("SIN CLASIFICAR") ? 
                                Math.round(montoUSD / 10) : Math.round(montoUSD / concursantes.length);
                            
                            // Enviar Super Chat via WebSocket a todos los clientes conectados
                            // (mantenemos esto para la visualización en tiempo real)
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
                            
                            // Enviar puntuaciones actualizadas
                            enviarPuntuacionesActualizadas();
                            
                        } catch (err) {
                            console.error('❌ Error actualizando puntos:', err.message);
                        }
                    }
                }

                nextPageToken = data.nextPageToken;
                
                // Usar exclusivamente el valor de pollingIntervalMillis que devuelve la API
                const waitMs = data.pollingIntervalMillis || 5000; // Valor de respaldo de 5 segundos si la API no devuelve un valor
                
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
        // Verificar API keys antes de iniciar
        await verificarApiKeys();
        
        // Inicializar la base de datos MySQL primero
        await db.initializeDatabase();
        
        // Luego iniciar el servidor
        server.listen(PORT, () => {
            console.log('🚀 Servidor Express + WebSocket iniciado');
            console.log(`🌐 Interfaz web en: http://localhost:${PORT}`);
            console.log('🔄 Presiona Ctrl+C para detener el servidor\n');
            
            // Iniciar monitor de Super Chats automáticamente
            setTimeout(() => {
                iniciarMonitorSuperChats().catch(err => {
                    console.error('❌ Error iniciando monitor de Super Chats:', err.message);
                });
            }, 2000); // Esperar 2 segundos para que el servidor esté completamente listo
        });
    } catch (err) {
        console.error('❌ Error al iniciar el servidor:', err);
        process.exit(1);
    }
}

// Función para verificar que las API keys sean válidas
async function verificarApiKeys() {
    console.log('🔑 Verificando API keys de YouTube...');
    
    const apiKeys = config.youtube.apiKeys;
    if (!apiKeys || apiKeys.length === 0) {
        throw new Error('No hay API keys configuradas');
    }
    
    // Verificar cada API key
    let keysValidas = 0;
    for (let i = 0; i < apiKeys.length; i++) {
        const apiKey = apiKeys[i];
        try {
            // Hacer una solicitud simple para verificar la API key
            const url = new URL("https://www.googleapis.com/youtube/v3/videos");
            url.search = new URLSearchParams({
                part: "snippet",
                chart: "mostPopular",
                maxResults: "1",
                key: apiKey
            });
            
            const res = await fetch(url);
            const data = await res.json();
            
            if (data.error) {
                console.error(`❌ API key #${i+1} inválida: ${data.error.message}`);
            } else {
                console.log(`✅ API key #${i+1} válida`);
                keysValidas++;
            }
        } catch (err) {
            console.error(`❌ Error verificando API key #${i+1}: ${err.message}`);
        }
    }
    
    if (keysValidas === 0) {
        throw new Error('Ninguna API key es válida. Verifica tus claves API de YouTube.');
    } else {
        console.log(`✅ ${keysValidas} de ${apiKeys.length} API keys son válidas`);
    }
}

// Iniciar el servidor
startServer();

module.exports = app; 