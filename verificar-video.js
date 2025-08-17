/**
 * Script para verificar si el video configurado es realmente un video en vivo
 * Ejecutar con: node verificar-video.js
 */
const config = require('./config');
const youtubeApi = require('./youtube-api');

async function verificarVideo() {
    try {
        console.log(`🔍 Verificando video ID: ${config.youtube.videoId}`);
        
        // Cargar las claves API desde la base de datos
        await youtubeApi.cargarApiKeys();
        
        // Obtener información del video
        const videoInfo = await youtubeApi.getVideoInfo(config.youtube.videoId);
        
        console.log('\n📊 INFORMACIÓN DEL VIDEO:');
        console.log('------------------------');
        console.log(`📝 Título: ${videoInfo.titulo}`);
        console.log(`📅 Fecha de inicio: ${videoInfo.fechaInicio}`);
        console.log(`🔗 ID del chat en vivo: ${videoInfo.liveChatId}`);
        
        // Verificar si el video tiene chat en vivo
        if (videoInfo.liveChatId) {
            console.log('\n✅ El video tiene chat en vivo activo');
            
            // Intentar obtener mensajes del chat
            console.log('\n🔄 Obteniendo mensajes del chat...');
            const chatData = await youtubeApi.pollChat(videoInfo.liveChatId);
            
            console.log(`📊 Mensajes recibidos: ${chatData.items?.length || 0}`);
            console.log(`⏱️ Intervalo de sondeo: ${chatData.pollingIntervalMillis || 'no especificado'} ms`);
            
            // Mostrar algunos mensajes de ejemplo
            if (chatData.items?.length > 0) {
                console.log('\n📝 MENSAJES DE EJEMPLO:');
                console.log('---------------------');
                
                const maxMensajes = Math.min(5, chatData.items.length);
                for (let i = 0; i < maxMensajes; i++) {
                    const item = chatData.items[i];
                    const author = item.authorDetails?.displayName || "Desconocido";
                    const snippet = item.snippet;
                    
                    if (snippet?.superChatDetails) {
                        const sc = snippet.superChatDetails;
                        const montoOriginal = Number(sc.amountMicros || 0) / 1_000_000;
                        const moneda = sc.currency || "";
                        const msg = sc.userComment || "";
                        
                        console.log(`💸 SuperChat de ${author}: ${montoOriginal} ${moneda} - "${msg}"`);
                    } else if (snippet?.textMessageDetails) {
                        const msg = snippet.textMessageDetails?.messageText || "";
                        console.log(`💬 ${author}: ${msg}`);
                    }
                }
            } else {
                console.log('❌ No se recibieron mensajes del chat');
            }
        } else {
            console.log('\n❌ El video NO tiene chat en vivo');
        }
        
    } catch (err) {
        console.error(`❌ Error verificando video: ${err.message}`);
    }
}

verificarVideo().catch(err => {
    console.error('❌ Error general:', err);
}); 