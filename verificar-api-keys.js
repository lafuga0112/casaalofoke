/**
 * Script para verificar las claves API de YouTube
 * Ejecutar con: node verificar-api-keys.js
 */
const axios = require('axios');
const config = require('./config');

// Función para verificar que las API keys sean válidas
async function verificarApiKeys() {
    console.log('🔑 Verificando API keys de YouTube...');
    
    const apiKeys = config.youtube.apiKeys;
    if (!apiKeys || apiKeys.length === 0) {
        console.error('❌ No hay API keys configuradas');
        return;
    }
    
    console.log(`📋 Total de API keys configuradas: ${apiKeys.length}`);
    
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
            
            console.log(`🔄 Verificando API key #${i+1}: ${apiKey.substring(0, 8)}...`);
            
            const res = await axios.get(url.toString());
            const data = res.data;
            
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
        console.error('❌ Ninguna API key es válida. Verifica tus claves API de YouTube.');
    } else {
        console.log(`✅ ${keysValidas} de ${apiKeys.length} API keys son válidas`);
    }
}

// Ejecutar la verificación
verificarApiKeys().catch(err => {
    console.error('❌ Error general:', err);
}); 