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
    // Múltiples API keys para rotación (cada una en su propio string)
    apiKeys: (process.env.YT_API_KEYS ? 
      process.env.YT_API_KEYS.split(',') : 
      [
        'AIzaSyDPdhbk59tmWDg17GNkg3XCeprjbP5t6YY', 
        'AIzaSyANHms7VXPx-_Dz_R-0nwmvYraPSU3mEFA',
        'AIzaSyDUFaMXWEES9eJNm2XCe7wpG5ycsRb8RhA',
        'AIzaSyA2j4_L5IW0Aib2StYYerATSdX5adNNFo0', 
        'AIzaSyDGw1WGn9TQeBTvLt6uQNbYse-U4mWXTvI',
        'AIzaSyArO6cPg9_Ysr0uHgsoC7CNHSVOS8j23Ug', 
        'AIzaSyAld1oLpWaPEn16E5lTSYp1qxVvr-HmA_8',
        // Eliminada la clave inválida: 'AIzaSyClJNtL0FbCG8QULGjYeYwjYlwYKfOxx9g',
        'AIzaSyBE-01Ew87_BQKnJjw-TrF2HPm86gOSa6U'
      ]
    ),
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