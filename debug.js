// Archivo de depuración temporal
const config = require('./config');


// Función para obtener la siguiente API key en rotación
function getNextApiKey() {
  const keys = config.youtube.apiKeys;
  if (!keys || keys.length === 0) {
    throw new Error('No hay API keys configuradas');
  }
  
  // Incrementar el índice y hacer rotación si es necesario
  config.youtube.lastKeyIndex = (config.youtube.lastKeyIndex + 1) % keys.length;
  
  const apiKey = keys[config.youtube.lastKeyIndex];
  
  return apiKey;
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
      
      // Verificar si es un error de cuota
      if (error.message.includes('quota') || error.message.includes('403')) {
        // Ya estamos rotando la API key en cada llamada a getNextApiKey
        continue;
      }
      
      // Si no es un error de cuota, propagar el error
      throw error;
    }
  }
  
  // Si llegamos aquí, todas las API keys han fallado
  throw lastError;
}

async function getLiveChatId(videoId) {
  
  return handleApiRequest(async () => {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.search = new URLSearchParams({
      part: "liveStreamingDetails",
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
    const liveChatId = data.items[0]?.liveStreamingDetails?.activeLiveChatId;
    if (!liveChatId) throw new Error("Este video no tiene chat en vivo.");
    
    return liveChatId;
  });
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

(async () => {
  try {
    const liveChatId = await getLiveChatId(config.youtube.videoId);

    let nextPageToken = undefined;
    let iteration = 0;

    while (true) {
      iteration++;
      
      const data = await pollChat(liveChatId, nextPageToken);

      // Imprimir mensajes
      for (const item of data.items || []) {
        const author = item.authorDetails?.displayName || "Desconocido";
        const snippet = item.snippet;

        // Mensaje normal de chat
        if (snippet?.type === "textMessageEvent") {
          const text = snippet.textMessageDetails?.messageText || "";
        }

        // Super Chat
        if (snippet?.superChatDetails) {
          const sc = snippet.superChatDetails;
          const amount = Number(sc.amountMicros || 0) / 1_000_000;
          const currency = sc.currency || "";
          const msg = sc.userComment || "";
        }
      }

      nextPageToken = data.nextPageToken;
      const waitMs = data.pollingIntervalMillis || 2000;
      await new Promise(r => setTimeout(r, waitMs));
    }
  } catch (err) {
    process.exit(1);
  }
})(); 