const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { CONCURSANTES } = require('../keywords');

// Crear directorio database si no existe
const dbDir = path.dirname(config.database.path);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(config.database.path);

// SQL para crear las tablas
const createTables = `
-- Tabla de concursantes
CREATE TABLE IF NOT EXISTS concursantes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre VARCHAR(50) UNIQUE NOT NULL,
    slug VARCHAR(50) UNIQUE NOT NULL,
    puntos_reales DECIMAL(10,2) DEFAULT 0,
    puntos_mostrados INTEGER DEFAULT 0,
    posicion INTEGER DEFAULT 0,
    instagram_url VARCHAR(255),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de super chats
CREATE TABLE IF NOT EXISTS superchats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    autor VARCHAR(100) NOT NULL,
    mensaje TEXT,
    monto_original DECIMAL(10,2) NOT NULL,
    moneda VARCHAR(10) NOT NULL,
    monto_usd DECIMAL(10,2) NOT NULL,
    concursantes_detectados TEXT, -- JSON array de concursantes
    distribucion TEXT, -- Descripción de cómo se distribuyeron los puntos
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de estadísticas generales
CREATE TABLE IF NOT EXISTS estadisticas (
    id INTEGER PRIMARY KEY,
    total_superchats INTEGER DEFAULT 0,
    total_puntos_reales DECIMAL(10,2) DEFAULT 0,
    total_puntos_mostrados INTEGER DEFAULT 0,
    ultimo_superchat_id INTEGER,
    fecha_inicio DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ultimo_superchat_id) REFERENCES superchats(id)
);

-- Insertar estadísticas iniciales
INSERT OR IGNORE INTO estadisticas (id, fecha_inicio) VALUES (1, datetime('now'));
`;

function initializeDatabase() {
    return new Promise((resolve, reject) => {
        console.log('🔄 Inicializando base de datos SQLite...');
        
        db.serialize(() => {
            // Crear tablas
            db.exec(createTables, (err) => {
                if (err) {
                    console.error('❌ Error creando tablas:', err);
                    reject(err);
                    return;
                }
                
                console.log('✅ Tablas creadas exitosamente');
                
                // Insertar concursantes iniciales
                const insertConcursante = db.prepare(`
                    INSERT OR REPLACE INTO concursantes 
                    (nombre, slug, instagram_url) 
                    VALUES (?, ?, ?)
                `);
                
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
                
                Object.entries(CONCURSANTES).forEach(([key, concursante]) => {
                    const slug = concursante.nombre.toLowerCase().replace('giuseppe', 'giuseppe');
                    const instagram = instagramUrls[concursante.nombre] || '#';
                    
                    insertConcursante.run(concursante.nombre, slug, instagram, (err) => {
                        if (err) {
                            console.error(`❌ Error insertando ${concursante.nombre}:`, err);
                        }
                    });
                });
                
                insertConcursante.finalize((err) => {
                    if (err) {
                        console.error('❌ Error finalizando inserts:', err);
                        reject(err);
                        return;
                    }
                    
                    console.log('✅ Concursantes insertados exitosamente');
                    console.log('🎯 Base de datos lista para usar');
                    resolve();
                });
            });
        });
    });
}

// Función para obtener la instancia de la base de datos
function getDatabase() {
    return new sqlite3.Database(config.database.path);
}

// Si se ejecuta directamente, inicializar la base de datos
if (require.main === module) {
    initializeDatabase()
        .then(() => {
            console.log('✅ Base de datos inicializada correctamente');
            process.exit(0);
        })
        .catch((err) => {
            console.error('❌ Error inicializando base de datos:', err);
            process.exit(1);
        });
}

module.exports = {
    initializeDatabase,
    getDatabase
}; 