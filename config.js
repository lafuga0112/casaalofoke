module.exports = {
  // Base de datos MySQL
  database: {
    type: 'mysql',
    host: process.env.DB_HOST || 'mysql-200838-0.cloudclusters.net',
    port: process.env.DB_PORT || 10089,
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || 'XdouTMvd',
    database: process.env.DB_NAME || 'alofoke',
    // Mantener compatibilidad con SQLite para desarrollo local
    path: process.env.DB_PATH || './database/alofoke_reality.db'
  },
  
  // YouTube API
  youtube: {
    apiKey: process.env.YT_API_KEY || 'AIzaSyDPdhbk59tmWDg17GNkg3XCeprjbP5t6YY',
    videoId: process.env.YT_VIDEO_ID || 'gOJvu0xYsdo'
  },
  
  // Servidor
  server: {
    port: process.env.PORT || 8080,
    env: process.env.NODE_ENV || 'development'
  },
  
  // Configuración del sistema
  system: {
    pollingInterval: parseInt(process.env.POLLING_INTERVAL) || 300000,
    effectivenessPercentage: parseFloat(process.env.EFFECTIVENESS_PERCENTAGE) || 0.7
  }
}; 