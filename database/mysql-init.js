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
    queueLimit: 0
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
)`;

const createSuperchatsTable = `
CREATE TABLE IF NOT EXISTS superchats (
    id INT AUTO_INCREMENT PRIMARY KEY,
    autor VARCHAR(100) NOT NULL,
    mensaje TEXT,
    monto_original DECIMAL(10,2) NOT NULL,
    moneda VARCHAR(10) NOT NULL,
    monto_usd DECIMAL(10,2) NOT NULL,
    concursantes_detectados TEXT,
    distribucion TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`;

const createEstadisticasTable = `
CREATE TABLE IF NOT EXISTS estadisticas (
    id INT PRIMARY KEY,
    total_superchats INT DEFAULT 0,
    total_puntos_reales DECIMAL(10,2) DEFAULT 0,
    total_puntos_mostrados INT DEFAULT 0,
    ultimo_superchat_id INT,
    fecha_inicio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (ultimo_superchat_id) REFERENCES superchats(id)
)`;

const insertEstadisticasIniciales = `
INSERT IGNORE INTO estadisticas (id, fecha_inicio) VALUES (1, NOW())
`;

// Pool de conexiones
let pool;

// Inicializar la base de datos
async function initializeDatabase() {
    try {
        console.log('🔄 Inicializando conexión a MySQL...');
        console.log(`🌐 Host: ${config.database.host}:${config.database.port}`);
        console.log(`📊 Base de datos: ${config.database.database}`);
        
        // Crear el pool de conexiones
        pool = mysql.createPool(dbConfig);
        
        // Verificar conexión
        const connection = await pool.getConnection();
        console.log('✅ Conexión a MySQL establecida correctamente');
        connection.release();
        
        // Crear tablas
        console.log('🔄 Creando tablas si no existen...');
        await pool.query(createConcursantesTable);
        await pool.query(createSuperchatsTable);
        await pool.query(createEstadisticasTable);
        await pool.query(insertEstadisticasIniciales);
        console.log('✅ Tablas creadas exitosamente');
        
        // Insertar concursantes iniciales
        console.log('🔄 Verificando concursantes...');
        
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
            'LUISE': 'https://www.instagram.com/luisemartinezz12/',
        };
        
        // Insertar cada concursante
        for (const [key, concursante] of Object.entries(CONCURSANTES)) {
            const slug = concursante.nombre.toLowerCase();
            const instagram = instagramUrls[concursante.nombre] || '#';
            
            try {
                await pool.query(
                    'INSERT INTO concursantes (nombre, slug, instagram_url) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE instagram_url = ?',
                    [concursante.nombre, slug, instagram, instagram]
                );
            } catch (err) {
                console.error(`❌ Error insertando ${concursante.nombre}:`, err.message);
            }
        }
        
        console.log('✅ Concursantes verificados exitosamente');
        console.log('🎯 Base de datos MySQL lista para usar');
        
        return pool;
    } catch (err) {
        console.error('❌ Error inicializando MySQL:', err.message);
        throw err;
    }
}

// Función para obtener una conexión de la base de datos
async function getConnection() {
    if (!pool) {
        await initializeDatabase();
    }
    return pool.getConnection();
}

// Función para ejecutar una consulta
async function query(sql, params = []) {
    if (!pool) {
        await initializeDatabase();
    }
    try {
        const [results] = await pool.query(sql, params);
        return results;
    } catch (err) {
        console.error('❌ Error en consulta MySQL:', err.message);
        console.error('SQL:', sql);
        throw err;
    }
}

// Si se ejecuta directamente, inicializar la base de datos
if (require.main === module) {
    initializeDatabase()
        .then(() => {
            console.log('✅ Base de datos MySQL inicializada correctamente');
            process.exit(0);
        })
        .catch((err) => {
            console.error('❌ Error inicializando base de datos MySQL:', err);
            process.exit(1);
        });
}

module.exports = {
    initializeDatabase,
    getConnection,
    query
}; 