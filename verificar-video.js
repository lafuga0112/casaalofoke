/**
 * Script para verificar si el video configurado es realmente un video en vivo
 * Ejecutar con: node verificar-video.js
 */
const config = require('./config');
const youtubeApi = require('./youtube-api');

async function verificarVideo() {
    try {
        
        // Cargar las claves API desde la base de datos
        await youtubeApi.cargarApiKeys();
        
        // Obtener información del video
        const videoInfo = await youtubeApi.getVideoInfo(config.youtube.videoId);
        
        // Verificar si el video tiene chat en vivo
        if (videoInfo.liveChatId) {
            
            // Intentar obtener mensajes del chat
            const chatData = await youtubeApi.pollChat(videoInfo.liveChatId);
            
            
            // Mostrar algunos mensajes de ejemplo
            if (chatData.items?.length > 0) {
                
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
                        
                    } else if (snippet?.textMessageDetails) {
                        const msg = snippet.textMessageDetails?.messageText || "";
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