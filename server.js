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
const aprendizaje = require('./aprendizaje-automatico');

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
});

// Función eliminada - ya no necesitamos estadísticas

// Funciones del monitor de Super Chats
// convertirAUSD ahora se importa desde conversiones.js

// ========================================
// SISTEMA DE DETECCIÓN MEJORADO
// ========================================

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
    
    console.log(`🎯 [DETECCIÓN] Concursantes detectados: ${concursantesDetectados.length > 0 ? concursantesDetectados.join(', ') : 'NINGUNO'}`);
    
    if (concursantesDetectados.length === 0) {
        return ["SIN CLASIFICAR"];
    }
    
    return concursantesDetectados;
}

// ========================================
// PROCESAMIENTO COMPLETO DEL CHAT
// ========================================

function extraerMensajeDeItem(item) {
    const snippet = item.snippet;
    
    switch (snippet.type) {
        case 'textMessageDetails':
            return {
                tipo: 'mensaje',
                mensaje: snippet.textMessageDetails.messageText,
                autor: snippet.authorDetails.displayName,
                montoUSD: 0
            };
        case 'superChatDetails':
            return {
                tipo: 'superchat',
                mensaje: snippet.superChatDetails.userComment || '',
                autor: snippet.authorDetails.displayName,
                montoUSD: snippet.superChatDetails.amountMicros / 1000000,
                monedaOriginal: snippet.superChatDetails.currency,
                montoOriginal: snippet.superChatDetails.amountMicros / 1000000
            };
        case 'memberMilestoneChatDetails':
            return {
                tipo: 'membership',
                mensaje: snippet.memberMilestoneChatDetails.userComment || `Miembro por ${snippet.memberMilestoneChatDetails.memberMonth} meses`,
                autor: snippet.authorDetails.displayName,
                montoUSD: 0
            };
        case 'newSponsorDetails':
            return {
                tipo: 'membership',
                mensaje: 'Nuevo miembro del canal',
                autor: snippet.authorDetails.displayName,
                montoUSD: 0
            };
        default:
            return {
                tipo: 'otro',
                mensaje: snippet.displayMessage || '',
                autor: snippet.authorDetails?.displayName || 'Usuario',
                montoUSD: 0
            };
    }
}

async function procesarMensajeCompleto(mensajeData) {
    try {
        // Detectar concursantes en TODOS los mensajes
        const concursantesDetectados = detectarConcursantes(mensajeData.mensaje);
        const hayDeteccion = !concursantesDetectados.includes("SIN CLASIFICAR");
        
        // Preparar datos para guardar en aprendizaje
        const datosAprendizaje = {
            tipo: mensajeData.tipo,
            mensaje: mensajeData.mensaje,
            autor: mensajeData.autor,
            montoUSD: mensajeData.montoUSD || 0,
            monedaOriginal: mensajeData.monedaOriginal || null,
            montoOriginal: mensajeData.montoOriginal || null,
            concursanteDetectado: hayDeteccion ? concursantesDetectados.join(',') : null,
            confianzaDeteccion: hayDeteccion ? 100 : 0,
            metodoDeteccion: hayDeteccion ? 'KEYWORDS_EXACTAS' : null
        };
        
        // Guardar TODOS los mensajes para aprendizaje
        await aprendizaje.guardarMensajeParaAprendizaje(db, datosAprendizaje);
        
        // Solo procesar puntos para SuperChats
        if (mensajeData.tipo === 'superchat' && mensajeData.montoUSD > 0) {
            console.log(`💸 [SUPERCHAT] ${mensajeData.autor}: ${mensajeData.montoOriginal} ${mensajeData.monedaOriginal} - "${mensajeData.mensaje}"`);
            
            // Convertir a USD si es necesario
            let montoUSD = mensajeData.montoUSD;
            if (mensajeData.monedaOriginal !== 'USD') {
                montoUSD = Math.round(convertirAUSD(mensajeData.montoOriginal, mensajeData.monedaOriginal));
                console.log(`💵 [CONVERSIÓN] ${mensajeData.montoOriginal} ${mensajeData.monedaOriginal} = $${montoUSD} USD`);
            }
            
            // Distribuir puntos
            const distribucion = await distribuirPuntos(concursantesDetectados, montoUSD);
            
            // Crear objeto para enviar al frontend
            const superChatParaEnviar = {
                id: Date.now(),
                author: mensajeData.autor,
                message: mensajeData.mensaje,
                amount: montoUSD,
                currency: 'USD',
                originalAmount: mensajeData.montoOriginal,
                originalCurrency: mensajeData.monedaOriginal,
                contestants: hayDeteccion ? concursantesDetectados : [],
                distribucion: distribucion,
                timestamp: new Date().toISOString()
            };
            
            // Enviar a todos los clientes conectados
            io.emit('nuevo-superchat', superChatParaEnviar);
            
            // Enviar puntuaciones actualizadas
            enviarPuntuacionesActualizadas();
            console.log(`✅ [PRODUCCIÓN] Puntuaciones actualizadas y enviadas a todos los clientes`);
        }
        
    } catch (error) {
        console.error('❌ Error procesando mensaje completo:', error.message);
    }
}

async function distribuirPuntos(concursantes, puntosUSD) {
    try {
        if (concursantes.includes("SIN CLASIFICAR")) {
            // Si no llega a $10, no se distribuye nada
            if (puntosUSD < 10) {
                console.log(`⚠️ [PRODUCCIÓN] SuperChat de $${puntosUSD} muy pequeño para distribuir entre 10 participantes. No se asignan puntos.`);
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
            
            console.log(`✅ [PRODUCCIÓN] Distribuidos ${puntosPorConcursante} puntos a cada uno de los 10 concursantes`);
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
            
            console.log(`✅ [PRODUCCIÓN] Distribuidos ${puntosPorConcursante} puntos a ${concursantes.join(', ')}`);
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
                
                // Procesar cada mensaje recibido
                for (const item of data.items || []) {
                    const mensajeData = extraerMensajeDeItem(item);
                    await procesarMensajeCompleto(mensajeData);
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
            
            // Iniciar el sistema de aprendizaje automático
            console.log('🧠 Iniciando sistema de aprendizaje automático...');
            const intervaloAprendizaje = aprendizaje.iniciarSistemaAprendizaje(db);
            
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