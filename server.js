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
const { detectarConcursantesInteligente } = require('./intelligent-detection.js');

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
    
    // Handler para solicitud de historial de SuperChats
    // NOTA: Solo se muestran SuperChats donde el concursante recibió puntos reales (> 0)
    // Los SuperChats "SIN CLASIFICAR" con monto < $10 no aparecen en el historial individual
    socket.on('get-superchats-history', async (data) => {
        try {
            const { contestant, limit = 50, page = 1 } = data;
            
            if (!contestant) {
                socket.emit('superchats-history', {
                    success: false,
                    error: 'Contestant es requerido',
                    timestamp: new Date().toISOString()
                });
                return;
            }
            
            const offset = (page - 1) * limit;
            
            // Consulta para obtener SuperChats del concursante (solo donde recibió puntos reales)
            const query = `
                SELECT 
                    s.id,
                    s.author,
                    s.message,
                    s.original_amount,
                    s.original_currency,
                    s.amount_usd,
                    s.distribucion_text,
                    s.is_sin_clasificar,
                    s.created_at,
                    sp.points_assigned
                FROM superchats s
                INNER JOIN superchat_participants sp ON s.id = sp.superchat_id
                WHERE sp.concursante_slug = ? 
                AND sp.points_assigned > 0
                ORDER BY s.created_at DESC
                LIMIT ? OFFSET ?
            `;
            
            const results = await db.query(query, [contestant, limit, offset]);
            
            // Verificar si hay más páginas (solo contar SuperChats con puntos reales)
            const countQuery = `
                SELECT COUNT(*) as total
                FROM superchats s
                INNER JOIN superchat_participants sp ON s.id = sp.superchat_id
                WHERE sp.concursante_slug = ? 
                AND sp.points_assigned > 0
            `;
            
            const countResult = await db.query(countQuery, [contestant]);
            const total = countResult[0].total;
            const hasMore = (offset + limit) < total;
            
            socket.emit('superchats-history', {
                success: true,
                data: results,
                hasMore: hasMore,
                total: total,
                page: page,
                limit: limit,
                timestamp: new Date().toISOString()
            });
            
        } catch (err) {
            console.error('❌ Error obteniendo historial de SuperChats:', err.message);
            socket.emit('superchats-history', {
                success: false,
                error: err.message,
                timestamp: new Date().toISOString()
            });
        }
    });

});

// Función eliminada - ya no necesitamos estadísticas

// Funciones del monitor de Super Chats
// convertirAUSD ahora se importa desde conversiones.js

function detectarConcursantes(mensaje) {
    console.log(`\n🧠 === DETECCIÓN INTELIGENTE ===`);
    console.log(`📝 Mensaje original: "${mensaje}"`);
    
    // Usar el nuevo sistema de detección inteligente
    const resultado = detectarConcursantesInteligente(mensaje);
    
    console.log(`🎯 Resultado final: ${resultado.join(', ')}`);
    console.log(`🧠 === FIN DETECCIÓN ===\n`);
    
    return resultado;
}

async function distribuirPuntos(concursantes, puntosUSD) {
    try {
        if (concursantes.includes("SIN CLASIFICAR")) {
            // Contar solo participantes activos (no eliminados)
            const participantesActivos = Object.values(CONCURSANTES).filter(c => !c.eliminado);
            const numeroParticipantesActivos = participantesActivos.length;
            
            // NUEVA LÓGICA: Comparar el monto USD con el número de participantes activos
            if (puntosUSD < numeroParticipantesActivos) {
                // CASO 1: Monto menor que número de participantes → SUMAR TODO AL FONDO COMÚN
                // Crear o actualizar un "fondo común" en la base de datos
                try {
                    // Intentar crear el registro del fondo común si no existe
                    await db.query(
                        `INSERT INTO concursantes (nombre, slug, puntos_reales, eliminado) 
                         VALUES ('FONDO_COMUN', 'fondo_comun', ?, FALSE) 
                         ON DUPLICATE KEY UPDATE 
                         puntos_reales = puntos_reales + ?, 
                         updated_at = NOW()`,
                        [puntosUSD, puntosUSD]
                    );
                } catch (err) {
                    console.error('❌ Error manejando fondo común:', err.message);
                }
                
                return `SuperChat de $${puntosUSD} agregado al fondo común (monto menor que ${numeroParticipantesActivos} participantes)`;
                
            } else {
                // CASO 2: Monto mayor o igual que número de participantes → DIVIDIR ENTRE TODOS
                const puntosPorConcursante = Math.floor(puntosUSD / numeroParticipantesActivos);
                
                // Actualizar solo los concursantes activos (no eliminados)
                for (const [key, concursante] of Object.entries(CONCURSANTES)) {
                    // Saltar participantes eliminados
                    if (concursante.eliminado) {
                        continue;
                    }
                    
                    await db.query(
                        `UPDATE concursantes 
                        SET puntos_reales = puntos_reales + ?,
                            updated_at = NOW()
                        WHERE nombre = ?`,
                        [puntosPorConcursante, concursante.nombre]
                    );
                }
                
                return `Distribuido entre los ${numeroParticipantesActivos} participantes activos (${puntosPorConcursante} puntos cada uno)`;
            }
            
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

// Función para guardar SuperChat en la base de datos
async function guardarSuperChatEnDB(superChatData) {
    console.log(`🔄 [DB] Guardando SuperChat (ya verificado como nuevo) - YouTube ID: ${superChatData.youtubeMessageId}, Autor: ${superChatData.author}`);
    
    try {
        // Ya no necesitamos verificar duplicados - se hace antes en el monitor
        
        // Insertar el SuperChat principal
        const superChatResult = await db.query(
            `INSERT INTO superchats (
                youtube_message_id, author, message, original_amount, original_currency, 
                amount_usd, distribucion_text, is_sin_clasificar, video_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                superChatData.youtubeMessageId,
                superChatData.author,
                superChatData.message,
                superChatData.originalAmount,
                superChatData.originalCurrency,
                superChatData.amount,
                superChatData.distribucion,
                superChatData.contestants.includes("SIN CLASIFICAR"),
                config.youtube.videoId
            ]
        );
        
        const superChatId = superChatResult.insertId;
        
        // Insertar las relaciones con los concursantes
        for (const contestant of superChatData.contestants) {
            // Obtener el slug del concursante
            const contestantResult = await db.query(
                'SELECT slug FROM concursantes WHERE nombre = ?',
                [contestant]
            );
            
            if (contestantResult.length > 0) {
                const slug = contestantResult[0].slug;
                await db.query(
                    `INSERT INTO superchat_participants (
                        superchat_id, concursante_slug, points_assigned
                    ) VALUES (?, ?, ?)`,
                    [superChatId, slug, superChatData.pointsPerContestant]
                );
            }
        }
        
        console.log(`✅ [DB] SuperChat guardado exitosamente - ID: ${superChatId}, YouTube ID: ${superChatData.youtubeMessageId}, Autor: ${superChatData.author}`);
        
    } catch (err) {
        if (err.message.includes('Duplicate entry') && err.message.includes('youtube_message_id')) {
            console.log(`⚠️ [DB] SuperChat ya existe (race condition detectado) - YouTube ID: ${superChatData.youtubeMessageId}, Autor: ${superChatData.author}`);
        } else {
            console.error('❌ [DB] Error guardando SuperChat:', err.message);
        }
        // No lanzar error para no interrumpir el flujo principal
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
                eliminado,
                @rownum := @rownum + 1 as posicion
            FROM concursantes, (SELECT @rownum := 0) r
            ORDER BY 
                eliminado ASC, 
                CASE 
                    WHEN eliminado = 0 THEN puntos_reales 
                    ELSE 0 
                END DESC,
                CASE 
                    WHEN eliminado = 1 THEN nombre 
                    ELSE '' 
                END ASC
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
        return;
    }
    
    try {
        
        // Obtener información del video
        const videoInfo = await youtubeApi.getVideoInfo(config.youtube.videoId);
        
        // Detectar y actualizar el día del reality
        actualizarDiaReality(videoInfo.titulo);
        
        
        isMonitoringActive = true;

        // Base de datos lista

        // Función para verificar el título del video
        const verificarTitulo = async () => {
            try {
                const videoInfoActualizada = await youtubeApi.getVideoInfo(config.youtube.videoId);
                const diaActualizado = actualizarDiaReality(videoInfoActualizada.titulo);
                

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
                    const youtubeMessageId = item.id; // ID único del mensaje de YouTube

                    if (snippet?.superChatDetails) {
                        console.log(`📥 [MONITOR] Procesando SuperChat - YouTube ID: ${youtubeMessageId}, Autor: ${author}`);
                        
                        // 🚀 OPTIMIZACIÓN: Verificar duplicados PRIMERO antes de procesamiento pesado
                        const existingSuperChat = await db.query(
                            'SELECT id FROM superchats WHERE youtube_message_id = ?',
                            [youtubeMessageId]
                        );
                        
                        if (existingSuperChat.length > 0) {
                            console.log(`⚠️ [MONITOR] SuperChat ya existe - saltando procesamiento completo - YouTube ID: ${youtubeMessageId}, Autor: ${author}`);
                            continue; // Saltar al siguiente mensaje sin procesar nada más
                        }
                        
                        console.log(`✨ [MONITOR] SuperChat nuevo - procediendo con procesamiento completo`);
                        
                        const sc = snippet.superChatDetails;
                        const montoOriginal = Number(sc.amountMicros || 0) / 1_000_000;
                        const moneda = sc.currency || "";
                        const msg = sc.userComment || "";
                        
                        
                        const concursantes = detectarConcursantes(msg);
                        
                        const montoUSD = Math.round(convertirAUSD(montoOriginal, moneda));
                        
                        try {
                            // Calcular puntos por concursante antes de distribuir
                            let puntosPorConcursante = 0;
                            let contestantsParaEnviar = [];
                            
                            if (concursantes.includes("SIN CLASIFICAR")) {
                                // Contar solo participantes activos (no eliminados)
                                const participantesActivos = Object.values(CONCURSANTES).filter(c => !c.eliminado);
                                const numeroParticipantesActivos = participantesActivos.length;
                                
                                if (montoUSD >= 10) {
                                    puntosPorConcursante = Math.floor(montoUSD / numeroParticipantesActivos);
                                    // Para SIN CLASIFICAR, enviar solo participantes activos
                                    contestantsParaEnviar = participantesActivos.map(c => c.nombre);
                                } else {
                                    puntosPorConcursante = 0;
                                    contestantsParaEnviar = participantesActivos.map(c => c.nombre);
                                }
                            } else {
                                puntosPorConcursante = Math.round(montoUSD / concursantes.length);
                                contestantsParaEnviar = concursantes; // Ya contiene solo el resultado final del sistema inteligente
                            }
                            
                            // Obtener puntuaciones actuales ANTES de distribuir (para mostrar progresión)
                            let puntuacionesAnteriores = {};
                            if (!concursantes.includes("SIN CLASIFICAR")) {
                                for (const nombreConcursante of concursantes) {
                                    const resultado = await db.query(
                                        'SELECT puntos_reales FROM concursantes WHERE nombre = ?',
                                        [nombreConcursante]
                                    );
                                    if (resultado.length > 0) {
                                        puntuacionesAnteriores[nombreConcursante] = Math.round(resultado[0].puntos_reales);
                                    }
                                }
                            }
                            
                            // Distribuir puntos
                            const distribucion = await distribuirPuntos(concursantes, montoUSD);
                            
                            // Crear objeto para enviar al frontend
                            const superChatParaEnviar = {
                                id: Date.now(),
                                youtubeMessageId: youtubeMessageId, // ID único de YouTube
                                author: author,
                                message: msg,
                                amount: montoUSD,
                                currency: 'USD',
                                originalAmount: montoOriginal,
                                originalCurrency: moneda,
                                contestants: contestantsParaEnviar,
                                pointsPerContestant: puntosPorConcursante,
                                distribucion: distribucion,
                                timestamp: new Date().toISOString(),
                                puntuacionesAnteriores: puntuacionesAnteriores // Para mostrar progresión
                            };
                            
                            // Enviar a todos los clientes conectados
                            io.emit('nuevo-superchat', superChatParaEnviar);
                            
                            // Guardar SuperChat en la base de datos
                            await guardarSuperChatEnDB(superChatParaEnviar);
                            
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