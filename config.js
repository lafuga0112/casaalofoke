module.exports = {
  // Base de datos SQLite
  database: {
    path: process.env.DB_PATH || './database/alofoke_reality.db'
  },
  
  // YouTube API
  youtube: {
    apiKey: process.env.YT_API_KEY || 'AIzaSyBBQNhk91YVg6yWJYFxy5GE8OgR8k62pGg',
    videoId: process.env.YT_VIDEO_ID || 'gOJvu0xYsdo'
  },
  
  // Servidor
  server: {
    port: process.env.PORT || 8080,
    env: process.env.NODE_ENV || 'development'
  },
  
  // Configuración del sistema
  system: {
    pollingInterval: parseInt(process.env.POLLING_INTERVAL) || 5000,
    effectivenessPercentage: parseFloat(process.env.EFFECTIVENESS_PERCENTAGE) || 0.7
  }
}; 