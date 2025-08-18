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
const { cargarTasasConversionAlInicio, convertirAUSD } = require('./conversiones.js');

// Importar el módulo de la API de YouTube
const youtubeApi = require('./youtube-api');

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
let clientesConectados = 0;
let diaActualReality = 1; // Día por defecto
let tituloVideoActual = "";

// WebSocket connections
io.on('connection', (socket) => {
    clientesConectados++;
    
    // Enviar estado inicial al cliente
    socket.emit('monitor-status', {
        isActive: isMonitoringActive,
        diaActual: diaActualReality,
        tituloVideo: tituloVideoActual,
        timestamp: new Date().toISOString()
    });
    
    // Enviar puntuaciones iniciales
    enviarPuntuacionesACliente(socket);
    
    socket.on('disconnect', () => {
        clientesConectados--;
    });
    
    // Handler para solicitud de puntuaciones
    socket.on('get-puntuaciones', () => {
        enviarPuntuacionesACliente(socket);
    });
    
    // Handler para solicitar historial de SuperChats
    socket.on('get-superchats-historial', async (filtros = {}) => {
        try {
            const historial = await obtenerHistorialSuperChats(filtros);
            socket.emit('superchats-historial', {
                success: true,
                data: historial.superchats,
                totalCount: historial.totalCount,
                hasMore: historial.hasMore,
                filtros: filtros
            });
        } catch (error) {
            console.error('❌ Error obteniendo historial SuperChats:', error.message);
            socket.emit('superchats-historial', {
                success: false,
                error: error.message
            });
        }
    });
});

// Función eliminada - ya no necesitamos estadísticas

// Funciones del monitor de Super Chats
// convertirAUSD ahora se importa desde conversiones.js

// Función para obtener historial de SuperChats (solo filtro por fecha)
async function obtenerHistorialSuperChats(filtros = {}) {
    try {
        const {
            fechaInicio,
            fechaFin,
            limite = 50,
            offset = 0
        } = filtros;
        
        let whereConditions = [];
        let queryParams = [];
        
        // Filtro por fecha
        if (fechaInicio) {
            whereConditions.push('timestamp >= ?');
            queryParams.push(fechaInicio);
        }
        
        if (fechaFin) {
            whereConditions.push('timestamp <= ?');
            queryParams.push(fechaFin);
        }
        
        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
        
        // Consulta para obtener el total de registros
        const countQuery = `SELECT COUNT(*) as total FROM superchats_historial ${whereClause}`;
        const totalResult = await db.query(countQuery, queryParams);
        const totalCount = totalResult[0].total;
        
        // Consulta para obtener los SuperChats con paginación
        const dataQuery = `
            SELECT 
                id, autor_chat, mensaje, monto_usd, monto_original, moneda_original,
                concursantes_detectados, es_para_todos, puntos_asignados,
                puntos_por_concursante, distribucion_descripcion, timestamp
            FROM superchats_historial 
            ${whereClause}
            ORDER BY timestamp DESC 
            LIMIT ? OFFSET ?
        `;
        
        const dataParams = [...queryParams, limite, offset];
        const superchats = await db.query(dataQuery, dataParams);
        
        // Procesar los datos para el frontend
        const superchatsProcessed = superchats.map(sc => {
            let concursantesDetectados = [];
            try {
                // Intentar parsear como JSON, si falla asumir que es un array simple
                if (sc.concursantes_detectados) {
                    if (sc.concursantes_detectados.startsWith('[') || sc.concursantes_detectados.startsWith('{')) {
                        concursantesDetectados = JSON.parse(sc.concursantes_detectados);
                    } else {
                        // Si no es JSON, asumir que es un string simple y convertirlo a array
                        concursantesDetectados = [sc.concursantes_detectados];
                    }
                }
            } catch (error) {
                console.error('❌ Error parseando concursantes_detectados:', sc.concursantes_detectados, error.message);
                concursantesDetectados = [];
            }
            
            return {
                id: sc.id,
                author: sc.autor_chat,
                message: sc.mensaje,
                amount: parseFloat(sc.monto_usd),
                currency: 'USD',
                originalAmount: parseFloat(sc.monto_original),
                originalCurrency: sc.moneda_original,
                contestants: concursantesDetectados,
                pointsPerContestant: sc.puntos_por_concursante,
                distribucion: sc.distribucion_descripcion,
                timestamp: sc.timestamp,
                esHistorial: true // Marcar como historial para diferenciarlo en el frontend
            };
        });
        
        const hasMore = (offset + limite) < totalCount;
        
        return {
            superchats: superchatsProcessed,
            totalCount,
            hasMore
        };
        
    } catch (error) {
        console.error('❌ Error en obtenerHistorialSuperChats:', error.message);
        throw error;
    }
}

function detectarConcursantes(mensaje) {
    const mensajeLower = mensaje.toLowerCase();
    const concursantesDetectados = [];
    
    console.log(`🔍 [DETECCIÓN] Mensaje: "${mensaje}"`);
    
    for (const [key, concursante] of Object.entries(CONCURSANTES)) {
        for (const keyword of concursante.keywords) {
            const keywordLower = keyword.toLowerCase();
            if (mensajeLower.includes(keywordLower)) {
                console.log(`✅ [DETECCIÓN] ENCONTRADO: "${keywordLower}" → ${concursante.nombre}`);
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
            // Si no llega a $10, no se distribuye nada
            if (puntosUSD < 10) {
                return `SuperChat de $${puntosUSD} muy pequeño para distribuir entre todos los participantes (mínimo $10 requerido)`;
            }
            
            const puntosPorConcursante = Math.floor(puntosUSD / 10);
            
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



// Función eliminada - no guardamos SuperChats individuales ni estadísticas

// Función eliminada - no necesitamos totales en estadísticas

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static('.')); // Servir archivos estáticos desde la raíz

// Rutas para archivos estáticos
app.use('/images', express.static('images'));

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Rutas para la administración de claves API
app.get('/api/keys', async (req, res) => {
    try {
        const rows = await db.query(
            `SELECT id, api_key, is_active, quota_used, 
            last_used, created_at, updated_at 
            FROM api_keys 
            ORDER BY id ASC`
        );
        
        res.json({
            success: true,
            data: rows,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('❌ Error obteniendo claves API:', err.message);
        res.status(500).json({
            success: false,
            error: err.message,
            timestamp: new Date().toISOString()
        });
    }
});

app.post('/api/keys', async (req, res) => {
    try {
        const { api_key } = req.body;
        
        if (!api_key) {
            return res.status(400).json({
                success: false,
                error: 'La clave API es requerida',
                timestamp: new Date().toISOString()
            });
        }
        
        // Insertar la nueva clave API
        await db.query(
            `INSERT INTO api_keys (api_key) 
            VALUES (?)`,
            [api_key]
        );
        
        // Recargar las claves API
        await youtubeApi.cargarApiKeys();
        
        res.json({
            success: true,
            message: 'Clave API agregada correctamente',
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('❌ Error agregando clave API:', err.message);
        res.status(500).json({
            success: false,
            error: err.message,
            timestamp: new Date().toISOString()
        });
    }
});

app.put('/api/keys/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { is_active } = req.body;
        
        // Actualizar la clave API
        await db.query(
            `UPDATE api_keys 
            SET is_active = ?
            WHERE id = ?`,
            [is_active, id]
        );
        
        // Recargar las claves API
        await youtubeApi.cargarApiKeys();
        
        res.json({
            success: true,
            message: 'Clave API actualizada correctamente',
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('❌ Error actualizando clave API:', err.message);
        res.status(500).json({
            success: false,
            error: err.message,
            timestamp: new Date().toISOString()
        });
    }
});

app.delete('/api/keys/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Eliminar la clave API
        await db.query(
            `DELETE FROM api_keys WHERE id = ?`,
            [id]
        );
        
        // Recargar las claves API
        await youtubeApi.cargarApiKeys();
        
        res.json({
            success: true,
            message: 'Clave API eliminada correctamente',
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('❌ Error eliminando clave API:', err.message);
        res.status(500).json({
            success: false,
            error: err.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Solo ruta para servir la interfaz web

// Servir la interfaz web
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Servir la página de administración
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
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
    return youtubeApi.getVideoInfo(videoId);
}

async function getLiveChatId(videoId) {
    return youtubeApi.getLiveChatId(videoId);
}

async function pollChat(liveChatId, pageToken) {
    return youtubeApi.pollChat(liveChatId, pageToken);
}

// Función para verificar que las API keys sean válidas
async function verificarApiKeys() {
    return youtubeApi.verificarApiKeys();
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

// Monitor de Super Chats integrado
async function iniciarMonitorSuperChats() {
    if (isMonitoringActive) {
        console.log('⚠️ Monitor de Super Chats ya está activo');
        return;
    }
    
    try {
        console.log('🔄 Iniciando monitor de Super Chats...');
        
        // Obtener información del video
        const videoInfo = await youtubeApi.getVideoInfo(config.youtube.videoId);
        
        // Detectar y actualizar el día del reality
        actualizarDiaReality(videoInfo.titulo);
        
        console.log('🎯 Monitor de Super Chats integrado al servidor web');
        
        isMonitoringActive = true;

        // Base de datos lista
        console.log('✅ Base de datos sincronizada');

        // Función para verificar el título del video
        const verificarTitulo = async () => {
            try {
                const videoInfoActualizada = await youtubeApi.getVideoInfo(config.youtube.videoId);
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
                const data = await youtubeApi.pollChat(liveChatId, nextPageToken);
                
                // Contar cuántos SuperChats hay en los mensajes recibidos
                const superChatsCount = data.items?.filter(item => item.snippet?.superChatDetails).length || 0;
                

                for (const item of data.items || []) {
                    const author = item.authorDetails?.displayName || "Desconocido";
                    const snippet = item.snippet;

                    if (snippet?.superChatDetails) {
                        const sc = snippet.superChatDetails;
                        const montoOriginal = Number(sc.amountMicros || 0) / 1_000_000;
                        const moneda = sc.currency || "";
                        const msg = sc.userComment || "";
                        
                        console.log(`💸 SuperChat de ${author}: ${montoOriginal} ${moneda} - "${msg}"`);
                        
                        const concursantes = detectarConcursantes(msg);
                        
                        const montoUSD = Math.round(convertirAUSD(montoOriginal, moneda));
                        
                        try {
                            // Calcular puntos por concursante antes de distribuir
                            let puntosPorConcursante = 0;
                            let contestantsParaEnviar = [];
                            
                            if (concursantes.includes("SIN CLASIFICAR")) {
                                if (montoUSD >= 10) {
                                    puntosPorConcursante = Math.floor(montoUSD / 10);
                                    // Para SIN CLASIFICAR, enviar todos los concursantes
                                    contestantsParaEnviar = Object.values(CONCURSANTES).map(c => c.nombre);
                                } else {
                                    puntosPorConcursante = 0;
                                    contestantsParaEnviar = Object.values(CONCURSANTES).map(c => c.nombre);
                                }
                            } else {
                                puntosPorConcursante = Math.round(montoUSD / concursantes.length);
                                contestantsParaEnviar = concursantes;
                            }
                            
                            // Distribuir puntos
                            const distribucion = await distribuirPuntos(concursantes, montoUSD);
                            
                            // Guardar SuperChat en el historial
                            const esParaTodos = concursantes.includes("SIN CLASIFICAR");
                            const puntosAsignados = esParaTodos ? montoUSD >= 10 : true;
                            
                            await db.query(
                                `INSERT INTO superchats_historial (
                                    autor_chat, mensaje, monto_usd, monto_original, moneda_original,
                                    concursantes_detectados, es_para_todos, puntos_asignados,
                                    puntos_por_concursante, distribucion_descripcion, video_id
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                [
                                    author,
                                    msg,
                                    montoUSD,
                                    montoOriginal,
                                    moneda,
                                    JSON.stringify(concursantes),
                                    esParaTodos,
                                    puntosAsignados,
                                    puntosPorConcursante,
                                    distribucion,
                                    config.youtube.videoId
                                ]
                            );
                            console.log(`💾 SuperChat guardado en historial: ${author} - $${montoUSD}`);
                            
                            // Crear objeto para enviar al frontend
                            const superChatParaEnviar = {
                                id: Date.now(),
                                author: author,
                                message: msg,
                                amount: montoUSD,
                                currency: 'USD',
                                originalAmount: montoOriginal,
                                originalCurrency: moneda,
                                contestants: contestantsParaEnviar,
                                pointsPerContestant: puntosPorConcursante,
                                distribucion: distribucion,
                                timestamp: new Date().toISOString()
                            };
                            
                            // Enviar a todos los clientes conectados
                            io.emit('nuevo-superchat', superChatParaEnviar);
                            
                            // Enviar puntuaciones actualizadas
                            enviarPuntuacionesActualizadas();
                            
                        } catch (err) {
                            console.error('❌ Error procesando SuperChat:', err.message);
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
        // Inicializar la base de datos MySQL primero
        await db.initializeDatabase();
        
        // Cargar las tasas de conversión de moneda online
        console.log('💱 Cargando tasas de conversión de moneda...');
        await cargarTasasConversionAlInicio();
        
        // Cargar las claves API desde la base de datos
        await youtubeApi.cargarApiKeys();
        
        // Verificar API keys antes de iniciar
        const apiKeysValidas = await youtubeApi.verificarApiKeys();
        
        // Luego iniciar el servidor
        server.listen(PORT, () => {
            console.log('🚀 Servidor Express + WebSocket iniciado');
            console.log(`🌐 Interfaz web en: http://localhost:${PORT}`);
            console.log('🔄 Presiona Ctrl+C para detener el servidor\n');
            
            // Iniciar el sistema de reintento automático de API keys
            youtubeApi.iniciarSistemaReintento();
            
            // Iniciar monitor de Super Chats automáticamente solo si hay API keys válidas
            if (apiKeysValidas) {
                setTimeout(() => {
                    iniciarMonitorSuperChats().catch(err => {
                        console.error('❌ Error iniciando monitor de Super Chats:', err.message);
                    });
                }, 2000); // Esperar 2 segundos para que el servidor esté completamente listo
            } else {
                console.error('❌ No hay claves API válidas disponibles. Por favor, agrega claves API válidas en la página de administración.');
                console.log('⚠️ El servidor está funcionando pero sin monitoreo de SuperChats.');
                console.log('💡 El sistema de reintento automático intentará reactivar API keys cada 30 minutos.');
            }
        });
    } catch (err) {
        console.error('❌ Error al iniciar el servidor:', err);
        process.exit(1);
    }
}

// Manejar cierre del servidor
process.on('SIGINT', () => {
    console.log('\n🛑 Deteniendo servidor...');
    youtubeApi.detenerSistemaReintento();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Deteniendo servidor...');
    youtubeApi.detenerSistemaReintento();
    process.exit(0);
});

module.exports = app;

// Iniciar el servidor
startServer(); 