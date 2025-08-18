const db = require('./database/mysql-init');

async function verificarSuperChatsGuardados() {
    try {
        // Inicializar la base de datos
        await db.initializeDatabase();
        
        console.log('🔍 VERIFICANDO TODOS LOS SUPERCHATS GUARDADOS EN LA BASE DE DATOS');
        console.log('='.repeat(80));
        
        // Consulta básica para ver cuántos SuperChats hay
        const totalResult = await db.query('SELECT COUNT(*) as total FROM superchats_historial');
        const total = totalResult[0].total;
        
        console.log(`📊 TOTAL DE SUPERCHATS GUARDADOS: ${total}`);
        console.log('='.repeat(80));
        
        if (total === 0) {
            console.log('❌ No hay SuperChats guardados en la base de datos');
            return;
        }
        
        // Obtener TODOS los SuperChats con TODAS las columnas
        const superchats = await db.query(`
            SELECT * FROM superchats_historial 
            ORDER BY timestamp DESC
        `);
        
        console.log(`📝 TODOS LOS ${superchats.length} SUPERCHATS GUARDADOS:`);
        console.log('='.repeat(80));
        
        superchats.forEach((sc, index) => {
            console.log(`\n🔸 SUPERCHAT #${index + 1}:`);
            console.log(`   ID: ${sc.id}`);
            console.log(`   AUTOR: "${sc.autor_chat}"`);
            console.log(`   MENSAJE: "${sc.mensaje || 'Sin mensaje'}"`);
            console.log(`   MONTO_USD: ${sc.monto_usd}`);
            console.log(`   MONTO_ORIGINAL: ${sc.monto_original}`);
            console.log(`   MONEDA_ORIGINAL: "${sc.moneda_original}"`);
            console.log(`   CONCURSANTES_DETECTADOS: "${sc.concursantes_detectados}"`);
            console.log(`   TIPO DE DATO (concursantes_detectados): ${typeof sc.concursantes_detectados}`);
            console.log(`   ES_PARA_TODOS: ${sc.es_para_todos}`);
            console.log(`   PUNTOS_ASIGNADOS: ${sc.puntos_asignados}`);
            console.log(`   PUNTOS_POR_CONCURSANTE: ${sc.puntos_por_concursante}`);
            console.log(`   DISTRIBUCION_DESCRIPCION: "${sc.distribucion_descripcion}"`);
            console.log(`   VIDEO_ID: "${sc.video_id || 'NULL'}"`);
            console.log(`   TIMESTAMP: ${sc.timestamp}`);
            
            // Análisis detallado del campo concursantes_detectados
            console.log(`   📋 ANÁLISIS DETALLADO DE CONCURSANTES_DETECTADOS:`);
            console.log(`      Valor raw: ${JSON.stringify(sc.concursantes_detectados)}`);
            console.log(`      Tipo de dato: ${typeof sc.concursantes_detectados}`);
            console.log(`      Es array: ${Array.isArray(sc.concursantes_detectados)}`);
            
            if (sc.concursantes_detectados) {
                if (typeof sc.concursantes_detectados === 'string') {
                    console.log(`      Longitud como string: ${sc.concursantes_detectados.length}`);
                    console.log(`      Primer carácter: "${sc.concursantes_detectados.charAt(0)}"`);
                    console.log(`      Último carácter: "${sc.concursantes_detectados.charAt(sc.concursantes_detectados.length - 1)}"`);
                    console.log(`      ¿Empieza con '['?: ${sc.concursantes_detectados.startsWith('[')}`);
                    console.log(`      ¿Empieza con '{'?: ${sc.concursantes_detectados.startsWith('{')}`);
                    
                    // Intentar parsear como JSON
                    try {
                        const parsed = JSON.parse(sc.concursantes_detectados);
                        console.log(`      ✅ JSON VÁLIDO: ${JSON.stringify(parsed)}`);
                        console.log(`      Tipo después de parsear: ${typeof parsed}`);
                        console.log(`      Es array: ${Array.isArray(parsed)}`);
                    } catch (error) {
                        console.log(`      ❌ NO ES JSON VÁLIDO: ${error.message}`);
                        console.log(`      Se guardó como STRING PLANO: "${sc.concursantes_detectados}"`);
                    }
                } else if (Array.isArray(sc.concursantes_detectados)) {
                    console.log(`      ✅ YA ES UN ARRAY: ${JSON.stringify(sc.concursantes_detectados)}`);
                    console.log(`      Longitud del array: ${sc.concursantes_detectados.length}`);
                    console.log(`      Elementos: ${sc.concursantes_detectados.join(', ')}`);
                } else {
                    console.log(`      ⚠️  TIPO INESPERADO: ${typeof sc.concursantes_detectados}`);
                    console.log(`      Valor: ${sc.concursantes_detectados}`);
                }
            } else {
                console.log(`      ⚠️  Valor NULL o vacío`);
            }
            
            console.log(`   ${'─'.repeat(60)}`);
        });
        
        // Análisis de patrones problemáticos
        console.log('\n' + '='.repeat(80));
        console.log('🔍 ANÁLISIS DE PATRONES EN LA BASE DE DATOS:');
        console.log('='.repeat(80));
        
        // Agrupar por valor de concursantes_detectados
        const patrones = await db.query(`
            SELECT 
                concursantes_detectados,
                es_para_todos,
                COUNT(*) as count,
                GROUP_CONCAT(DISTINCT autor_chat) as autores_ejemplo
            FROM superchats_historial 
            GROUP BY concursantes_detectados, es_para_todos
            ORDER BY count DESC
        `);
        
        console.log('\n📊 PATRONES DE CONCURSANTES_DETECTADOS:');
        patrones.forEach(patron => {
            console.log(`\n   Valor: "${patron.concursantes_detectados}"`);
            console.log(`   Es para todos: ${patron.es_para_todos ? 'SÍ' : 'NO'}`);
            console.log(`   Frecuencia: ${patron.count} veces`);
            console.log(`   Autores ejemplo: ${patron.autores_ejemplo}`);
            
            // Verificar si es JSON válido
            try {
                if (patron.concursantes_detectados) {
                    const parsed = JSON.parse(patron.concursantes_detectados);
                    console.log(`   ✅ JSON válido: ${JSON.stringify(parsed)}`);
                } else {
                    console.log(`   ⚠️  Valor NULL o vacío`);
                }
            } catch (error) {
                console.log(`   ❌ NO ES JSON: "${patron.concursantes_detectados}"`);
            }
        });
        
        // Verificar estructura de la tabla
        console.log('\n' + '='.repeat(80));
        console.log('🔍 ESTRUCTURA DE LA TABLA:');
        console.log('='.repeat(80));
        
        const estructura = await db.query(`DESCRIBE superchats_historial`);
        estructura.forEach(campo => {
            console.log(`   ${campo.Field}: ${campo.Type} ${campo.Null === 'YES' ? '(NULL)' : '(NOT NULL)'} ${campo.Default ? `DEFAULT ${campo.Default}` : ''}`);
        });
        
        console.log('\n✅ ANÁLISIS COMPLETO TERMINADO');
        
    } catch (error) {
        console.error('❌ Error verificando SuperChats:', error.message);
        console.error('Stack trace:', error.stack);
    } finally {
        process.exit(0);
    }
}

// Ejecutar la verificación
verificarSuperChatsGuardados(); 