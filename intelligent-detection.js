// Sistema de detección inteligente para SuperChats
// Analiza la intención real del mensaje, no solo menciones casuales

const { CONCURSANTES } = require('./keywords');

// Patrones de intención directa (mayor prioridad)
const INTENT_PATTERNS = [
    // Frases directas de asignación de puntos
    {
        pattern: /puntos?\s+para\s+(\w+)\s+y\s+(\w+)/gi,
        confidence: 100,
        description: "Puntos para X y Y"
    },
    {
        pattern: /puntos?\s+para\s+(\w+)/gi,
        confidence: 100,
        description: "Puntos para X"
    },
    {
        pattern: /mis\s+puntos?\s+van\s+para\s+(\w+)/gi,
        confidence: 100,
        description: "Mis puntos van para X"
    },
    {
        pattern: /puntos?\s+a\s+(\w+)/gi,
        confidence: 95,
        description: "Puntos a X"
    },
    {
        pattern: /para\s+(\w+)\s*$/gi,
        confidence: 95,
        description: "Para X (al final)"
    },
    {
        pattern: /voy\s+con\s+(\w+)/gi,
        confidence: 90,
        description: "Voy con X"
    },
    {
        pattern: /apoyo\s+a?\s+(\w+)\s+y\s+(\w+)/gi,
        confidence: 85,
        description: "Apoyo a X y Y"
    },
    {
        pattern: /apoyo\s+a?\s+(\w+)/gi,
        confidence: 85,
        description: "Apoyo a X"
    },
    {
        pattern: /pero\s+(\w+)\s+sí/gi,
        confidence: 85,
        description: "Pero X sí"
    },
    {
        pattern: /team\s+(\w+)\s+y\s+(\w+)/gi,
        confidence: 85,
        description: "Team X y Y"
    },
    {
        pattern: /team\s+(\w+)/gi,
        confidence: 80,
        description: "Team X"
    },
    {
        pattern: /tea\s+(\w+)\s+y\s+(\w+)/gi,
        confidence: 85,
        description: "Tea X y Y (error tipográfico)"
    },
    {
        pattern: /tea\s+(\w+)/gi,
        confidence: 80,
        description: "Tea X (error tipográfico)"
    },
    {
        pattern: /tema\s+(\w+)/gi,
        confidence: 80,
        description: "Tema X (error tipográfico)"
    },
    {
        pattern: /tean\s+(\w+)/gi,
        confidence: 80,
        description: "Tean X (error tipográfico)"
    },
    {
        pattern: /#(\w+)/gi,
        confidence: 90,
        description: "#X (hashtag general)"
    },
    {
        pattern: /#team(\w+)/gi,
        confidence: 80,
        description: "#TeamX"
    },

    {
        pattern: /vamos\s+(\w+)\s+y\s+(\w+)/gi,
        confidence: 75,
        description: "Vamos X y Y"
    },
    {
        pattern: /vamos\s+(\w+)/gi,
        confidence: 75,
        description: "Vamos X"
    },
    {
        pattern: /\b(\w+)\s+sí\b/gi,
        confidence: 70,
        description: "X sí"
    },
    {
        pattern: /\b(\w+)\s+y\s+(\w+)\b/gi,
        confidence: 65,
        description: "X y Y (apoyo implícito)"
    }
];

// Palabras que indican contexto negativo
const NEGATIVE_CONTEXT = [
    'no es', 'no tiene', 'sin embargo', 'aunque', 
    'mentira', 'fake', 'falso', 'no me gusta', 'odio',
    'terrible', 'malo', 'peor', 'nunca', 'jamás',
    'ridicula', 'ridiculo', 'me tiene halta', 'me tiene harto',
    'me molesta', 'fastidiosa', 'fastidioso', 'insoportable',
    'pesada', 'pesado', 'toxica', 'toxico', 'aburrida', 'aburrido',
    'se paró', 'se paro', 'se salió', 'se salio', 'abandonó', 'abandono',
    'trampa', 'tramposa', 'tramposo', 'hizo mal', 'revisar porque'
];

// Palabras que indican intención positiva (anulan contexto negativo)
const POSITIVE_INTENT = [
    'puntos para', 'puntos es para', 'que la amo', 'que lo amo',
    'apoyo a', 'voy con', 'team', '#', 'me gusta', 'amo',
    'es mi favorita', 'es mi favorito', 'la mejor', 'el mejor'
];

// Emojis que indican apoyo/amor
const LOVE_EMOJIS = ['💕', '💖', '💗', '💘', '💙', '💚', '💛', '💜', '🧡', '❤️', '🩷', '😍', '🥰', '😘'];

// Función principal de detección inteligente
function detectarConcursantesInteligente(mensaje) {
    console.log(`🔍 Analizando mensaje: "${mensaje}"`);
    
    // Normalizar mensaje
    const mensajeNormalizado = mensaje.toLowerCase().trim();
    
    // 1. BUSCAR INTENCIÓN DIRECTA (máxima prioridad)
    const intencionDirecta = buscarIntencionDirecta(mensajeNormalizado);
    if (intencionDirecta.length > 0) {
        // Extraer todos los concursantes únicos de mayor confianza
        const mayorConfianza = intencionDirecta[0].confidence;
        const concursantesMayorConfianza = intencionDirecta
            .filter(i => i.confidence === mayorConfianza)
            .map(i => i.concursante);
        
        // Eliminar duplicados
        const concursantesUnicos = [...new Set(concursantesMayorConfianza)];
        const resultado = filtrarConcursantesEliminados(concursantesUnicos);
        
        console.log(`✅ Intención directa encontrada: ${concursantesUnicos.join(', ')}`);
        return resultado.length > 0 ? resultado : ["SIN CLASIFICAR"];
    }
    
    // 2. ANÁLISIS CONTEXTUAL (si no hay intención directa)
    const analisisContextual = analizarContexto(mensajeNormalizado);
    if (analisisContextual.length === 1) {
        console.log(`🔍 Análisis contextual: ${analisisContextual[0]}`);
        return filtrarConcursantesEliminados(analisisContextual);
    } else if (analisisContextual.length > 1) {
        console.log(`⚠️ Múltiples menciones en análisis contextual: ${analisisContextual.join(', ')} - SIN CLASIFICAR`);
        return ["SIN CLASIFICAR"];
    }
    
    // 3. FALLBACK AL SISTEMA ORIGINAL (muy conservador)
    const deteccionBasica = detectarMencionesCasuales(mensajeNormalizado);
    if (deteccionBasica.length === 1) {
        console.log(`⚠️ Solo una mención casual encontrada: ${deteccionBasica[0]}`);
        return filtrarConcursantesEliminados(deteccionBasica);
    }
    
    // 4. Si hay múltiples menciones casuales o ninguna, SIN CLASIFICAR
    console.log(`❓ ${deteccionBasica.length > 1 ? 'Múltiples menciones casuales' : 'Ninguna mención'} - SIN CLASIFICAR`);
    return ["SIN CLASIFICAR"];
}

// Buscar patrones de intención directa
function buscarIntencionDirecta(mensaje) {
    const resultados = [];
    
    for (const patron of INTENT_PATTERNS) {
        const matches = [...mensaje.matchAll(patron.pattern)];
        
        for (const match of matches) {
            // Manejar patrones con múltiples concursantes
            const esPatronMultiple = [
                "Puntos para X y Y",
                "Apoyo a X y Y", 
                "Team X y Y",
                "Tea X y Y (error tipográfico)",
                "Vamos X y Y",
                "X y Y (apoyo implícito)"
            ].includes(patron.description);
            
            if (esPatronMultiple && match[2]) {
                // Para "X y Y (apoyo implícito)", verificar que haya emojis de amor
                if (patron.description === "X y Y (apoyo implícito)") {
                    const tieneEmojisAmor = LOVE_EMOJIS.some(emoji => mensaje.includes(emoji));
                    if (!tieneEmojisAmor) {
                        continue; // Skip este patrón si no hay emojis de amor
                    }
                }
                
                // Primer concursante
                const nombreDetectado1 = match[1];
                const concursanteEncontrado1 = encontrarConcursantePorNombre(nombreDetectado1);
                
                // Segundo concursante  
                const nombreDetectado2 = match[2];
                const concursanteEncontrado2 = encontrarConcursantePorNombre(nombreDetectado2);
                
                const posicion = match.index;
                const esContextoNegativo = verificarContextoNegativo(mensaje, posicion);
                
                if (!esContextoNegativo) {
                    if (concursanteEncontrado1) {
                        resultados.push({
                            concursante: concursanteEncontrado1,
                            confidence: patron.confidence,
                            pattern: patron.description,
                            posicion: posicion
                        });
                    }
                    if (concursanteEncontrado2) {
                        resultados.push({
                            concursante: concursanteEncontrado2,
                            confidence: patron.confidence,
                            pattern: patron.description,
                            posicion: posicion
                        });
                    }
                }
            } else {
                // Patrón normal de un solo concursante
                const nombreDetectado = match[1];
                const concursanteEncontrado = encontrarConcursantePorNombre(nombreDetectado);
                
                if (concursanteEncontrado) {
                    // Verificar que no esté en contexto negativo
                    const posicion = match.index;
                    const esContextoNegativo = verificarContextoNegativo(mensaje, posicion);
                    
                    if (!esContextoNegativo) {
                        resultados.push({
                            concursante: concursanteEncontrado,
                            confidence: patron.confidence,
                            pattern: patron.description,
                            posicion: posicion
                        });
                    }
                }
            }
        }
    }
    
    // Ordenar por confianza y posición (más al final = mayor prioridad)
    return resultados.sort((a, b) => {
        if (a.confidence !== b.confidence) {
            return b.confidence - a.confidence;
        }
        return b.posicion - a.posicion;
    });
}

// Analizar contexto cuando no hay intención directa
function analizarContexto(mensaje) {
    const concursantesDetectados = [];
    
    // Verificar si todo el mensaje tiene contexto negativo
    const tieneContextoNegativo = verificarContextoNegativo(mensaje, 0);
    if (tieneContextoNegativo) {
        console.log(`   ❌ Mensaje completo tiene contexto negativo - no asignar puntos`);
        return []; // No detectar ningún concursante si el mensaje es negativo
    }
    
    // Buscar menciones de concursantes
    for (const [key, concursante] of Object.entries(CONCURSANTES)) {
        if (concursante.eliminado) continue;
        
        for (const keyword of concursante.keywords) {
            const keywordLower = keyword.toLowerCase();
            if (mensaje.includes(keywordLower)) {
                // Solo agregar si no está ya agregado
                if (!concursantesDetectados.includes(concursante.nombre)) {
                    concursantesDetectados.push(concursante.nombre);
                }
            }
        }
    }
    
    return concursantesDetectados;
}

// Detección básica de menciones (sistema original)
function detectarMencionesCasuales(mensaje) {
    const concursantesDetectados = [];
    
    for (const [key, concursante] of Object.entries(CONCURSANTES)) {
        if (concursante.eliminado) continue;
        
        for (const keyword of concursante.keywords) {
            const keywordLower = keyword.toLowerCase();
            if (mensaje.includes(keywordLower)) {
                if (!concursantesDetectados.includes(concursante.nombre)) {
                    concursantesDetectados.push(concursante.nombre);
                }
                break;
            }
        }
    }
    
    return concursantesDetectados;
}

// Verificar si una mención está en contexto negativo
function verificarContextoNegativo(mensaje, posicion) {
    // Analizar todo el mensaje para detectar contexto negativo y positivo
    const mensajeLower = mensaje.toLowerCase();
    
    // Buscar palabras positivas que anulen el contexto negativo
    const tieneIntencionPositiva = POSITIVE_INTENT.some(positivo => 
        mensajeLower.includes(positivo.toLowerCase())
    );
    
    if (tieneIntencionPositiva) {
        console.log(`   ✅ Intención positiva detectada - anulando contexto negativo`);
        return false; // La intención positiva anula cualquier contexto negativo
    }
    
    // Solo si no hay intención positiva, buscar contexto negativo
    const tieneContextoNegativo = NEGATIVE_CONTEXT.some(negativo => 
        mensajeLower.includes(negativo.toLowerCase())
    );
    
    if (tieneContextoNegativo) {
        console.log(`   ⚠️ Contexto negativo detectado en el mensaje`);
        return true;
    }
    
    return false;
}

// Encontrar concursante por nombre aproximado
function encontrarConcursantePorNombre(nombreBuscado) {
    const nombreLower = nombreBuscado.toLowerCase();
    
    console.log(`   🔍 Buscando concursante para: "${nombreBuscado}"`);
    
    // Buscar coincidencia exacta primero
    for (const [key, concursante] of Object.entries(CONCURSANTES)) {
        if (concursante.eliminado) {
            console.log(`   ❌ ${concursante.nombre} está eliminado, saltando`);
            continue;
        }
        
        if (concursante.nombre.toLowerCase() === nombreLower) {
            console.log(`   ✅ Coincidencia exacta: ${concursante.nombre}`);
            return concursante.nombre;
        }
        
        // Buscar en keywords
        for (const keyword of concursante.keywords) {
            if (keyword.toLowerCase() === nombreLower) {
                console.log(`   ✅ Coincidencia por keyword: ${concursante.nombre} (${keyword})`);
                return concursante.nombre;
            }
        }
    }
    
    // Buscar coincidencia parcial (solo si el nombre buscado tiene al menos 3 caracteres)
    if (nombreLower.length >= 3) {
        for (const [key, concursante] of Object.entries(CONCURSANTES)) {
            if (concursante.eliminado) continue;
            
            if (concursante.nombre.toLowerCase().includes(nombreLower) || 
                nombreLower.includes(concursante.nombre.toLowerCase())) {
                console.log(`   ✅ Coincidencia parcial: ${concursante.nombre}`);
                return concursante.nombre;
            }
        }
    }
    
    console.log(`   ❌ No se encontró concursante para: "${nombreBuscado}"`);
    return null;
}

// Filtrar concursantes eliminados
function filtrarConcursantesEliminados(concursantes) {
    return concursantes.filter(nombre => {
        const concursante = Object.values(CONCURSANTES).find(c => c.nombre === nombre);
        return concursante && !concursante.eliminado;
    });
}

module.exports = {
    detectarConcursantesInteligente,
    INTENT_PATTERNS,
    NEGATIVE_CONTEXT
};
