const mysql = require('mysql2/promise');
const config = require('../config');
const { CONCURSANTES } = require('../keywords');

// Configuración de la conexión MySQL
const dbConfig = {
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4' // Soporte para emojis y caracteres especiales
};

// SQL para crear las tablas
const createConcursantesTable = `
CREATE TABLE IF NOT EXISTS concursantes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(50) UNIQUE NOT NULL,
    slug VARCHAR(50) UNIQUE NOT NULL,
    puntos_reales DECIMAL(10,2) DEFAULT 0,
    puntos_mostrados INT DEFAULT 0,
    posicion INT DEFAULT 0,
    instagram_url VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`;

const createApiKeysTable = `
CREATE TABLE IF NOT EXISTS api_keys (
    id INT AUTO_INCREMENT PRIMARY KEY,
    api_key VARCHAR(100) UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    quota_used INT DEFAULT 0,
    last_used TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`;

// Configurar la base de datos para usar UTF-8mb4
const setDatabaseCharset = `
ALTER DATABASE ${config.database.database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
`;

// Pool de conexiones
let pool;
let initialized = false;

// Inicializar la base de datos
async function initializeDatabase() {
    try {
        // Crear el pool de conexiones
        pool = mysql.createPool(dbConfig);
        
        // Verificar conexión
        const connection = await pool.getConnection();
        
        // Configurar la base de datos para usar UTF-8mb4
        try {
            await connection.query(setDatabaseCharset);
        } catch (err) {
            console.warn('⚠️ No se pudo configurar el charset de la base de datos:', err.message);
            console.warn('⚠️ Algunas características como emojis pueden no funcionar correctamente');
        }
        
        connection.release();
        
        // Crear tablas
        await pool.query(createConcursantesTable);
        await pool.query(createApiKeysTable);
        
        console.log('✅ Tablas creadas exitosamente');
        
        // Verificar si ya existen claves API en la tabla
        const [apiKeys] = await pool.query('SELECT COUNT(*) as count FROM api_keys');
        console.log(`ℹ️ Se encontraron ${apiKeys[0].count} claves API en la base de datos`);
        
        // Insertar concursantes iniciales
        
        // URLs de Instagram (actualizar con las reales)
        const instagramUrls = {
            'GIGI': 'https://www.instagram.com/lagigird/',
            'GIUSEPPE': 'https://www.instagram.com/gbenignini/',
            'VLADY': 'https://www.instagram.com/justvladyg/',
            'CRAZY': 'https://www.instagram.com/crazydesignrd/',
            'PAMELA': 'https://www.instagram.com/shuupamela6.9/',
            'KAROLA': 'https://www.instagram.com/karolalcendra_/',
            'JIMENEZ': 'https://www.instagram.com/jimenez_tv/',
            'PEKY': 'https://www.instagram.com/lapekipr/',
            'CRUSITA': 'https://www.instagram.com/crusita___/',
            'LUISE': 'https://www.instagram.com/luisemartinezz12/'
        };
        
        // Insertar o actualizar cada concursante
        for (const [key, concursante] of Object.entries(CONCURSANTES)) {
            try {
                await pool.query(
                    'INSERT INTO concursantes (nombre, slug, instagram_url) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE instagram_url = ?',
                    [concursante.nombre, concursante.nombre.toLowerCase(), instagramUrls[concursante.nombre] || '', instagramUrls[concursante.nombre] || '']
                );
            } catch (err) {
                console.error(`❌ Error insertando concursante ${concursante.nombre}:`, err.message);
            }
        }
        
        console.log('✅ Concursantes insertados exitosamente');
        
        // Marcar como inicializada
        initialized = true;
        
        return pool;
    } catch (err) {
        console.error('❌ Error inicializando la base de datos:', err.message);
        throw err;
    }
}

// Función para verificar si la base de datos está inicializada
function isInitialized() {
    return initialized;
}

// Función para ejecutar consultas
async function query(sql, params) {
    if (!pool) {
        throw new Error('La base de datos no ha sido inicializada');
    }
    
    try {
        const [results] = await pool.query(sql, params);
        return results;
    } catch (err) {
        console.error('❌ Error en consulta SQL:', err.message);
        throw err;
    }
}

// Exportar funciones
module.exports = {
    initializeDatabase,
    query,
    isInitialized
}; 