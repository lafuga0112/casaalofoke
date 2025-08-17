// Archivo de depuración temporal
const API_KEY = 'AIzaSyBBQNhk91YVg6yWJYFxy5GE8OgR8k62pGg';
const VIDEO_ID = 'gOJvu0xYsdo';

console.log('🚀 Iniciando script de depuración...');
console.log('API_KEY:', API_KEY ? '✅ Configurada' : '❌ No configurada');
console.log('VIDEO_ID:', VIDEO_ID);

async function getLiveChatId(videoId) {
  console.log('🔍 Obteniendo Live Chat ID...');
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.search = new URLSearchParams({
    part: "liveStreamingDetails",
    id: videoId,
    key: API_KEY,
  });

  console.log('📡 URL:', url.toString());
  const res = await fetch(url);
  const data = await res.json();
  console.log('📊 Respuesta completa:', JSON.stringify(data, null, 2));

  if (!data.items?.length) throw new Error("Video no encontrado o no está en vivo.");
  const liveChatId = data.items[0]?.liveStreamingDetails?.activeLiveChatId;
  if (!liveChatId) throw new Error("Este video no tiene chat en vivo.");
  
  console.log('✅ Live Chat ID obtenido:', liveChatId);
  return liveChatId;
}

async function pollChat(liveChatId, pageToken) {
  console.log('📡 Consultando chat...');
  const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
  url.search = new URLSearchParams({
    liveChatId,
    part: "snippet,authorDetails",
    key: API_KEY,
    pageToken: pageToken || "",
  });

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Error API: ${res.status} ${text}`);
  }
  
  const data = await res.json();
  console.log('📋 Datos del chat recibidos:', data);
  return data;
}

(async () => {
  try {
    console.log('🎯 Iniciando proceso principal...');
    const liveChatId = await getLiveChatId(VIDEO_ID);
    console.log('✅ Escuchando chat en vivo… (Ctrl+C para salir)');

    let nextPageToken = undefined;
    let iteration = 0;

    while (true) {
      iteration++;
      console.log(`🔄 Iteración #${iteration}...`);
      
      const data = await pollChat(liveChatId, nextPageToken);
      console.log(`📨 Mensajes recibidos: ${data.items?.length || 0}`);

      // Imprimir mensajes
      for (const item of data.items || []) {
        const author = item.authorDetails?.displayName || "Desconocido";
        const snippet = item.snippet;

        // Mensaje normal de chat
        if (snippet?.type === "textMessageEvent") {
          const text = snippet.textMessageDetails?.messageText || "";
          console.log(`[CHAT] ${author}: ${text}`);
        }

        // Super Chat
        if (snippet?.superChatDetails) {
          const sc = snippet.superChatDetails;
          const amount = Number(sc.amountMicros || 0) / 1_000_000;
          const currency = sc.currency || "";
          const msg = sc.userComment || "";
          console.log(`💥 [SUPERCHAT] ${author}: ${amount} ${currency} — ${msg}`);
        }
      }

      nextPageToken = data.nextPageToken;
      const waitMs = data.pollingIntervalMillis || 2000;
      console.log(`⏰ Esperando ${waitMs}ms...`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  } catch (err) {
    console.error("❌ Error:", err.message);
    console.error("Stack:", err.stack);
    process.exit(1);
  }
})(); 