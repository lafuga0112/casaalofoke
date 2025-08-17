/**
 * Módulo para manejar las interacciones con la API de YouTube
 * Este archivo centraliza todas las funciones relacionadas con la API de YouTube
 * para evitar duplicación de código y peticiones
 */
const config = require('./config');
// Importar axios en lugar de fetch
const axios = require('axios');
const db = require('./database/mysql-init');

// Variable para almacenar el último ID de chat en vivo obtenido
let cachedLiveChatId = null;
let cachedVideoInfo = null;

// Array local para almacenar las claves API cargadas desde la base de datos
let apiKeys = [];
let lastKeyIndex = -1;

// Función para obtener la siguiente API key en rotación
function getNextApiKey() {
    if (!apiKeys || apiKeys.length === 0) {
        console.error('❌ No hay API keys disponibles en la base de datos');
        throw new Error('No hay API keys configuradas en la base de datos');
    }
    
    // Incrementar el índice y hacer rotación si es necesario
    lastKeyIndex = (lastKeyIndex + 1) % apiKeys.length;
    
    const apiKey = apiKeys[lastKeyIndex];
    
    // Actualizar el uso de cuota en la base de datos (asíncrono, no esperamos)
    actualizarUsoApiKey(apiKey).catch(err => {
        console.error('❌ Error actualizando uso de API key:', err.message);
    });
    
    return apiKey;
}

// Función para esperar un tiempo entre intentos
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Función para actualizar el uso de cuota de una clave API
async function actualizarUsoApiKey(apiKey) {
    try {
        if (!db.isInitialized()) {
            console.warn('⚠️ Base de datos no inicializada, no se puede actualizar uso de API key');
            return;
        }
        
        await db.query(
            `UPDATE api_keys 
            SET quota_used = quota_used + 1, 
                last_used = NOW() 
            WHERE api_key = ?`,
            [apiKey]
        );
    } catch (err) {
        console.error('❌ Error actualizando uso de API key:', err.message);
    }
}

// Función para marcar una clave API como inactiva
async function marcarApiKeyInactiva(apiKey, reason) {
    try {
        if (!db.isInitialized()) {
            console.warn('⚠️ Base de datos no inicializada, no se puede marcar API key como inactiva');
            return;
        }
        
        await db.query(
            `UPDATE api_keys 
            SET is_active = FALSE
            WHERE api_key = ?`,
            [apiKey]
        );
        console.log(`⚠️ API key desactivada: ${reason}`);
        
        // Recargar las claves API activas
        await cargarApiKeys();
    } catch (err) {
        console.error('❌ Error marcando API key como inactiva:', err.message);
    }
}

// Función para cargar las claves API desde la base de datos
async function cargarApiKeys() {
    try {
        if (!db.isInitialized()) {
            console.warn('⚠️ Base de datos no inicializada, no se pueden cargar API keys');
            return;
        }
        
        // Cargar únicamente las claves API activas desde la base de datos
        const rows = await db.query(
            `SELECT api_key FROM api_keys WHERE is_active = TRUE ORDER BY id ASC`
        );
        
        if (rows && rows.length > 0) {
            // Extraer las claves API de los resultados
            apiKeys = rows.map(row => row.api_key);
            lastKeyIndex = -1; // Reiniciar el índice
            
            console.log(`✅ Cargadas ${apiKeys.length} claves API desde la base de datos`);
        } else {
            console.warn('⚠️ No hay claves API disponibles en la base de datos');
            apiKeys = [];
        }
    } catch (err) {
        console.error('❌ Error cargando claves API:', err.message);
        apiKeys = [];
    }
}

// Función para manejar errores de cuota de la API de YouTube
async function handleApiRequest(requestFn) {
    const maxRetries = apiKeys.length; // Intentar con todas las API keys disponibles
    if (maxRetries === 0) {
        throw new Error('No hay API keys disponibles en la base de datos');
    }
    
    let lastError = null;
    let startingKeyIndex = lastKeyIndex; // Guardar el índice inicial
    let keysTriedCount = 0;
    
    while (keysTriedCount < maxRetries) {
        try {
            return await requestFn();
        } catch (error) {
            lastError = error;
            
            // Verificar si es un error de cuota o API key inválida
            if (error.message.includes('quota') || 
                error.message.includes('403') || 
                error.message.includes('API key not valid') || 
                error.message.includes('400')) {
                
                const currentApiKey = apiKeys[lastKeyIndex];
                console.error(`❌ Error con API key #${lastKeyIndex + 1}: ${error.message}`);
                
                // Marcar la API key como inactiva si es un error de cuota
                if (error.message.includes('quota') || error.message.includes('exceeded')) {
                    await marcarApiKeyInactiva(currentApiKey, 'Cuota excedida');
                } else if (error.message.includes('API key not valid')) {
                    await marcarApiKeyInactiva(currentApiKey, 'Clave inválida');
                }
                
                // Rotar manualmente a la siguiente API key
                lastKeyIndex = (lastKeyIndex + 1) % apiKeys.length;
                
                // Verificar si hemos probado todas las claves
                if (lastKeyIndex === startingKeyIndex) {
                    keysTriedCount = maxRetries; // Forzar salida del bucle
                } else {
                    console.log(`🔄 Intentando con API key #${lastKeyIndex + 1}...`);
                    keysTriedCount++;
                    
                    // Esperar un poco entre intentos para evitar problemas de límite de tasa
                    await sleep(1000);
                }
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

// Función para verificar que las API keys sean válidas
async function verificarApiKeys() {
    console.log('🔑 Verificando API keys de YouTube...');
    
    // Asegurarse de cargar las claves más recientes de la base de datos
    await cargarApiKeys();
    
    if (!apiKeys || apiKeys.length === 0) {
        console.error('❌ No hay API keys configuradas en la base de datos');
        return false;
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
            
            const res = await axios.get(url.toString());
            const data = res.data;
            
            if (data.error) {
                console.error(`❌ API key #${i+1} inválida: ${data.error.message}`);
                
                // Marcar la API key como inactiva en la base de datos
                if (data.error.message.includes('quota') || data.error.message.includes('exceeded')) {
                    await marcarApiKeyInactiva(apiKey, 'Cuota excedida');
                } else {
                    await marcarApiKeyInactiva(apiKey, 'API key inválida');
                }
            } else {
                console.log(`✅ API key #${i+1} válida`);
                keysValidas++;
            }
        } catch (err) {
            console.error(`❌ Error verificando API key #${i+1}: ${err.message}`);
            // También marcar como inactiva si hay un error en la verificación
            await marcarApiKeyInactiva(apiKey, `Error: ${err.message}`);
        }
    }
    
    // Recargar las claves API después de la verificación para asegurarnos de que solo usamos las válidas
    await cargarApiKeys();
    
    // Verificar que tengamos al menos una clave API válida
    if (apiKeys.length === 0) {
        console.error('❌ Ninguna API key es válida. Verifica tus claves API de YouTube.');
        return false;
    } else {
        console.log(`✅ ${keysValidas} de ${apiKeys.length} API keys son válidas`);
        return true;
    }
}

// Función para obtener información del video
async function getVideoInfo(videoId) {
    // Si ya tenemos la información en caché y es para el mismo video, la devolvemos
    if (cachedVideoInfo && cachedVideoInfo.videoId === videoId) {
        console.log('📋 Usando información de video en caché');
        return cachedVideoInfo.info;
    }
    
    return handleApiRequest(async () => {
        const url = new URL("https://www.googleapis.com/youtube/v3/videos");
        url.search = new URLSearchParams({
            part: "snippet,liveStreamingDetails",
            id: videoId,
            key: getNextApiKey(),
        });

        const res = await axios.get(url.toString());
        const data = res.data;
        
        // Verificar errores de la API
        if (data.error) {
            throw new Error(`Error API: ${data.error.code} ${data.error.message}`);
        }

        if (!data.items?.length) throw new Error("Video no encontrado o no está en vivo.");
        
        const video = data.items[0];
        const liveChatId = video.liveStreamingDetails?.activeLiveChatId;
        if (!liveChatId) throw new Error("Este video no tiene chat en vivo.");
        
        const info = {
            liveChatId,
            titulo: video.snippet?.title || "Sin título",
            descripcion: video.snippet?.description || "",
            fechaInicio: video.liveStreamingDetails?.actualStartTime || new Date().toISOString()
        };
        
        // Guardar en caché
        cachedVideoInfo = {
            videoId,
            info,
            timestamp: Date.now()
        };
        
        return info;
    });
}

// Función para obtener el ID del chat en vivo
async function getLiveChatId(videoId) {
    // Si ya tenemos el liveChatId en caché, lo devolvemos
    if (cachedLiveChatId) {
        console.log('📋 Usando liveChatId en caché');
        return cachedLiveChatId;
    }
    
    const videoInfo = await getVideoInfo(videoId);
    cachedLiveChatId = videoInfo.liveChatId;
    return cachedLiveChatId;
}

// Función para sondear el chat en vivo
async function pollChat(liveChatId, pageToken) {
    return handleApiRequest(async () => {
        const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
        url.search = new URLSearchParams({
            liveChatId,
            part: "snippet,authorDetails",
            key: getNextApiKey(),
            pageToken: pageToken || "",
            maxResults: "200" // Solicitar el máximo de mensajes posible
        });

        try {
            const res = await axios.get(url.toString());
            const data = res.data;
            
            // Verificar errores de la API
            if (data.error) {
                console.error(`❌ Error en respuesta API: ${data.error.code} ${data.error.message}`);
                throw new Error(`Error API: ${data.error.code} ${data.error.message}`);
            }
            
            return data;
        } catch (error) {
            if (error.response) {
                console.error(`❌ Error en respuesta HTTP: ${error.response.status}`);
                throw new Error(`Error API: ${error.response.status} ${JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    });
}

// Exportar las funciones
module.exports = {
    getNextApiKey,
    handleApiRequest,
    getVideoInfo,
    getLiveChatId,
    pollChat,
    verificarApiKeys,
    cargarApiKeys,
    actualizarUsoApiKey,
    marcarApiKeyInactiva
}; 