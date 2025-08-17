const mysql = require('mysql2/promise');
const config = require('./config');

async function main() {
  const pool = await mysql.createPool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database
  });

  try {
    console.log('Buscando concursantes en la base de datos...');
    
    // Consulta todos los concursantes para ver sus nombres y slugs
    const [rows] = await pool.query('SELECT id, nombre, slug, puntos_reales FROM concursantes ORDER BY nombre');
    
    console.log('Resultados:');
    console.log(JSON.stringify(rows, null, 2));
    
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

main().catch(err => console.error('Error general:', err)); 