// ========================================
// SISTEMA DE APRENDIZAJE AUTOMÁTICO
// Analiza TODOS los mensajes del chat para mejorar detección
// ========================================

const { CONCURSANTES } = require('./keywords');

// ========================================
// FUNCIONES DE NORMALIZACIÓN Y SIMILITUD
// ========================================

function normalizarTexto(texto) {
    if (!texto) return '';
    return texto
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')  // quitar acentos
        .replace(/[^\w\s]/g, ' ')         // quitar signos
        .replace(/\s+/g, ' ')             // espacios únicos
        .trim();
}

function calcularDistanciaLevenshtein(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    
    return matrix[str2.length][str1.length];
}

function calcularSimilitud(palabra1, palabra2) {
    const maxLength = Math.max(palabra1.length, palabra2.length);
    if (maxLength === 0) return 100;
    
    const distancia = calcularDistanciaLevenshtein(palabra1, palabra2);
    return ((maxLength - distancia) / maxLength) * 100;
}

// ========================================
// GUARDADO DE MENSAJES PARA APRENDIZAJE
// ========================================

async function guardarMensajeParaAprendizaje(db, mensajeData) {
    try {
        const {
            tipo,
            mensaje,
            autor,
            montoUSD = 0,
            monedaOriginal = null,
            montoOriginal = null,
            concursanteDetectado = null,
            confianzaDeteccion = 0,
            metodoDeteccion = null
        } = mensajeData;

        await db.query(`
            INSERT INTO chat_completo_aprendizaje 
            (tipo_mensaje, mensaje, autor, monto_usd, moneda_original, monto_original, 
             concursante_detectado, confianza_deteccion, metodo_deteccion)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            tipo, mensaje, autor, montoUSD, monedaOriginal, montoOriginal,
            concursanteDetectado, confianzaDeteccion, metodoDeteccion
        ]);

        console.log(`📝 [APRENDIZAJE] Mensaje guardado: ${tipo} - "${mensaje.substring(0, 50)}..."`);
    } catch (error) {
        console.error('❌ Error guardando mensaje para aprendizaje:', error.message);
    }
}

// ========================================
// ANÁLISIS DE PATRONES AUTOMÁTICO
// ========================================

async function analizarPatronesNoDetectados(db) {
    try {
        console.log('🧠 [ANÁLISIS] Iniciando análisis de patrones...');
        
        // Obtener mensajes no detectados de las últimas 24 horas
        const [mensajesNoDetectados] = await db.query(`
            SELECT mensaje, COUNT(*) as frecuencia, autor
            FROM chat_completo_aprendizaje 
            WHERE concursante_detectado IS NULL 
            AND timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
            AND mensaje IS NOT NULL
            AND LENGTH(mensaje) >= 3
            GROUP BY mensaje
            HAVING frecuencia >= 2
            ORDER BY frecuencia DESC
            LIMIT 200
        `);

        console.log(`🔍 [ANÁLISIS] Encontrados ${mensajesNoDetectados.length} mensajes únicos no detectados`);

        const sugerenciasNuevas = [];

        for (const row of mensajesNoDetectados) {
            const mensaje = row.mensaje;
            const frecuencia = row.frecuencia;
            
            const sugerencias = await encontrarSimilitudesConConcursantes(mensaje, frecuencia);
            sugerenciasNuevas.push(...sugerencias);
        }

        // Guardar sugerencias en base de datos
        for (const sugerencia of sugerenciasNuevas) {
            await guardarSugerenciaKeyword(db, sugerencia);
        }

        console.log(`✅ [ANÁLISIS] Procesadas ${sugerenciasNuevas.length} sugerencias nuevas`);
        return sugerenciasNuevas;

    } catch (error) {
        console.error('❌ Error en análisis de patrones:', error.message);
        return [];
    }
}

async function encontrarSimilitudesConConcursantes(mensaje, frecuencia) {
    const mensajeNormalizado = normalizarTexto(mensaje);
    const palabras = mensajeNormalizado.split(' ').filter(p => p.length >= 3);
    const sugerencias = [];

    for (const palabra of palabras) {
        // Comparar con nombres de concursantes
        for (const [key, concursante] of Object.entries(CONCURSANTES)) {
            const nombreNormalizado = normalizarTexto(concursante.nombre);
            const similitud = calcularSimilitud(palabra, nombreNormalizado);

            // Si la similitud es alta (75%+), es una buena sugerencia
            if (similitud >= 75) {
                sugerencias.push({
                    palabraEncontrada: palabra,
                    concursanteSugerido: concursante.nombre,
                    similitudPorcentaje: similitud,
                    frecuenciaAparicion: frecuencia,
                    mensajeOriginal: mensaje
                });
            }

            // También comparar con keywords existentes
            for (const keyword of concursante.keywords) {
                const keywordNormalizada = normalizarTexto(keyword);
                const similitudKeyword = calcularSimilitud(palabra, keywordNormalizada);

                if (similitudKeyword >= 80) {
                    sugerencias.push({
                        palabraEncontrada: palabra,
                        concursanteSugerido: concursante.nombre,
                        similitudPorcentaje: similitudKeyword,
                        frecuenciaAparicion: frecuencia,
                        mensajeOriginal: mensaje,
                        keywordSimilar: keyword
                    });
                }
            }
        }
    }

    return sugerencias;
}

async function guardarSugerenciaKeyword(db, sugerencia) {
    try {
        await db.query(`
            INSERT INTO sugerencias_keywords 
            (palabra_encontrada, concursante_sugerido, similitud_porcentaje, frecuencia_aparicion)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
            frecuencia_aparicion = frecuencia_aparicion + VALUES(frecuencia_aparicion),
            ultima_actualizacion = NOW()
        `, [
            sugerencia.palabraEncontrada,
            sugerencia.concursanteSugerido,
            sugerencia.similitudPorcentaje,
            sugerencia.frecuenciaAparicion
        ]);

        console.log(`💡 [SUGERENCIA] "${sugerencia.palabraEncontrada}" → ${sugerencia.concursanteSugerido} (${sugerencia.similitudPorcentaje.toFixed(1)}%)`);
    } catch (error) {
        if (!error.message.includes('Duplicate entry')) {
            console.error('❌ Error guardando sugerencia:', error.message);
        }
    }
}

// ========================================
// OBTENER SUGERENCIAS PENDIENTES
// ========================================

async function obtenerSugerenciasPendientes(db, limite = 50) {
    try {
        const [sugerencias] = await db.query(`
            SELECT 
                palabra_encontrada,
                concursante_sugerido,
                similitud_porcentaje,
                frecuencia_aparicion,
                primera_deteccion
            FROM sugerencias_keywords 
            WHERE estado = 'pendiente'
            ORDER BY frecuencia_aparicion DESC, similitud_porcentaje DESC
            LIMIT ?
        `, [limite]);

        return sugerencias;
    } catch (error) {
        console.error('❌ Error obteniendo sugerencias:', error.message);
        return [];
    }
}

async function aprobarSugerencia(db, palabraEncontrada, concursanteSugerido) {
    try {
        await db.query(`
            UPDATE sugerencias_keywords 
            SET estado = 'aprobada', ultima_actualizacion = NOW()
            WHERE palabra_encontrada = ? AND concursante_sugerido = ?
        `, [palabraEncontrada, concursanteSugerido]);

        console.log(`✅ [APROBADA] "${palabraEncontrada}" → ${concursanteSugerido}`);
        return true;
    } catch (error) {
        console.error('❌ Error aprobando sugerencia:', error.message);
        return false;
    }
}

async function rechazarSugerencia(db, palabraEncontrada, concursanteSugerido) {
    try {
        await db.query(`
            UPDATE sugerencias_keywords 
            SET estado = 'rechazada', ultima_actualizacion = NOW()
            WHERE palabra_encontrada = ? AND concursante_sugerido = ?
        `, [palabraEncontrada, concursanteSugerido]);

        console.log(`❌ [RECHAZADA] "${palabraEncontrada}" → ${concursanteSugerido}`);
        return true;
    } catch (error) {
        console.error('❌ Error rechazando sugerencia:', error.message);
        return false;
    }
}

// ========================================
// ESTADÍSTICAS DEL SISTEMA
// ========================================

async function obtenerEstadisticasAprendizaje(db) {
    try {
        // Total de mensajes capturados
        const [totalMensajes] = await db.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN concursante_detectado IS NOT NULL THEN 1 END) as detectados,
                COUNT(CASE WHEN concursante_detectado IS NULL THEN 1 END) as no_detectados
            FROM chat_completo_aprendizaje 
            WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        `);

        // Sugerencias por estado
        const [sugerenciasPorEstado] = await db.query(`
            SELECT estado, COUNT(*) as cantidad
            FROM sugerencias_keywords
            GROUP BY estado
        `);

        // Top palabras no detectadas
        const [topPalabrasNoDetectadas] = await db.query(`
            SELECT mensaje, COUNT(*) as frecuencia
            FROM chat_completo_aprendizaje 
            WHERE concursante_detectado IS NULL 
            AND timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
            GROUP BY mensaje
            ORDER BY frecuencia DESC
            LIMIT 10
        `);

        return {
            mensajes: totalMensajes[0],
            sugerencias: sugerenciasPorEstado,
            topNoDetectadas: topPalabrasNoDetectadas
        };
    } catch (error) {
        console.error('❌ Error obteniendo estadísticas:', error.message);
        return null;
    }
}

// ========================================
// INICIALIZACIÓN DEL SISTEMA
// ========================================

function iniciarSistemaAprendizaje(db) {
    console.log('🚀 [APRENDIZAJE] Sistema de aprendizaje automático iniciado');
    
    // Análisis cada hora
    const intervaloAnalisis = setInterval(async () => {
        try {
            console.log('⏰ [APRENDIZAJE] Ejecutando análisis programado...');
            await analizarPatronesNoDetectados(db);
        } catch (error) {
            console.error('❌ Error en análisis programado:', error.message);
        }
    }, 60 * 60 * 1000); // 1 hora

    // Análisis inicial después de 5 minutos
    setTimeout(async () => {
        try {
            console.log('🎯 [APRENDIZAJE] Ejecutando análisis inicial...');
            await analizarPatronesNoDetectados(db);
        } catch (error) {
            console.error('❌ Error en análisis inicial:', error.message);
        }
    }, 5 * 60 * 1000); // 5 minutos

    return intervaloAnalisis;
}

module.exports = {
    guardarMensajeParaAprendizaje,
    analizarPatronesNoDetectados,
    obtenerSugerenciasPendientes,
    aprobarSugerencia,
    rechazarSugerencia,
    obtenerEstadisticasAprendizaje,
    iniciarSistemaAprendizaje,
    normalizarTexto,
    calcularSimilitud
}; 