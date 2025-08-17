module.exports = {
  // Base de datos MySQL
  database: {
    type: 'mysql',
    host: process.env.DB_HOST || 'mysql-200838-0.cloudclusters.net',
    port: process.env.DB_PORT || 10089,
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || 'XdouTMvd',
    database: process.env.DB_NAME || 'alofoke'
  },
  
  // YouTube API
  youtube: {
    // Las claves API se gestionan exclusivamente desde la base de datos
    apiKeys: [],
    videoId: process.env.YT_VIDEO_ID || 'gOJvu0xYsdo',
    // Índice de la última API key utilizada
    lastKeyIndex: 0
  },
  
  // Servidor
  server: {
    port: process.env.PORT || 8080,
    env: process.env.NODE_ENV || 'development'
  },
  
  // Configuración del sistema
  system: {
    pollingInterval: null, // Usar exclusivamente pollingIntervalMillis de la API
    effectivenessPercentage: parseFloat(process.env.EFFECTIVENESS_PERCENTAGE) || 0.7
  }
};  