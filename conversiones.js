const axios = require('axios');

// Tasas de conversión RESPALDO (monedas principales)
const TASAS_CONVERSION_RESPALDO = {
  USD: 1.0,        // 1 USD = 1 punto
  EUR: 1.08,       // 1 EUR = 1.08 USD
  DOP: 0.018,      // 1 DOP = 0.018 USD (peso dominicano)
  MXN: 0.059,      // 1 MXN = 0.059 USD (peso mexicano)
  COP: 0.00026,    // 1 COP = 0.00026 USD (peso colombiano)
  PEN: 0.27,       // 1 PEN = 0.27 USD (sol peruano)
  CLP: 0.0011,     // 1 CLP = 0.0011 USD (peso chileno)
  ARS: 0.0012,     // 1 ARS = 0.0012 USD (peso argentino)
  BRL: 0.21,       // 1 BRL = 0.21 USD (real brasileño)
  CAD: 0.74,       // 1 CAD = 0.74 USD (dólar canadiense)
  GBP: 1.27,       // 1 GBP = 1.27 USD (libra esterlina)
  JPY: 0.0067,     // 1 JPY = 0.0067 USD (yen japonés)
  NGN: 0.00063,    // 1 NGN = 0.00063 USD (naira nigeriana)
  INR: 0.012,      // 1 INR = 0.012 USD (rupia india)
  CNY: 0.14,       // 1 CNY = 0.14 USD (yuan chino)
  KRW: 0.00076,    // 1 KRW = 0.00076 USD (won surcoreano)
  TRY: 0.031,      // 1 TRY = 0.031 USD (lira turca)
  AUD: 0.66,       // 1 AUD = 0.66 USD (dólar australiano)
  CHF: 1.13,       // 1 CHF = 1.13 USD (franco suizo)
  RUB: 0.011       // 1 RUB = 0.011 USD (rublo ruso)
};

// Tasas de conversión globales (se cargan al inicio)
let TASAS_CONVERSION_GLOBAL = {};
let tasasCargadas = false;
let fechaCargaTasas = null;

// Función para cargar TODAS las tasas de conversión al inicio
async function cargarTasasConversionAlInicio() {
    if (tasasCargadas) {
        console.log('💰 Tasas de conversión ya están cargadas');
        return TASAS_CONVERSION_GLOBAL;
    }
    
    try {
        console.log('🌐 Cargando TODAS las tasas de conversión al inicio del servidor...');
        
        // Intentar múltiples APIs gratuitas
        const apis = [
            'https://api.exchangerate-api.com/v4/latest/USD',
            'https://api.fixer.io/latest?access_key=FREE&base=USD', // Fixer (modo gratuito)
            'https://open.er-api.com/v6/latest/USD' // Open Exchange Rates (gratuito)
        ];
        
        let tasasOnline = null;
        
        for (const apiUrl of apis) {
            try {
                console.log(`🔄 Intentando API: ${apiUrl.split('/')[2]}`);
                
                const response = await axios.get(apiUrl, {
                    timeout: 15000 // 15 segundos timeout
                });
                
                if (response.data && response.data.rates) {
                    tasasOnline = response.data.rates;
                    console.log(`✅ API exitosa: ${apiUrl.split('/')[2]} (${Object.keys(tasasOnline).length} monedas)`);
                    break;
                }
            } catch (apiError) {
                console.log(`⚠️ API falló: ${apiUrl.split('/')[2]} - ${apiError.message}`);
                continue;
            }
        }
        
        if (tasasOnline) {
            // Convertir las tasas (API devuelve USD -> otras monedas, necesitamos otras monedas -> USD)
            TASAS_CONVERSION_GLOBAL = {};
            TASAS_CONVERSION_GLOBAL.USD = 1.0; // USD siempre es 1
            
            for (const [moneda, tasa] of Object.entries(tasasOnline)) {
                if (tasa && tasa > 0) {
                    TASAS_CONVERSION_GLOBAL[moneda] = 1 / tasa; // Invertir para obtener valor en USD
                }
            }
            
            tasasCargadas = true;
            fechaCargaTasas = new Date();
            
            console.log(`✅ TASAS DE CONVERSIÓN CARGADAS EXITOSAMENTE:`);
            console.log(`📊 Total de monedas soportadas: ${Object.keys(TASAS_CONVERSION_GLOBAL).length}`);
            console.log(`📅 Fecha de carga: ${fechaCargaTasas.toLocaleString()}`);
            
            // Mostrar algunas monedas importantes
            const monedasImportantes = ['EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'BRL', 'MXN', 'NGN', 'DOP'];
            console.log(`💱 Algunas tasas importantes:`);
            monedasImportantes.forEach(moneda => {
                if (TASAS_CONVERSION_GLOBAL[moneda]) {
                    console.log(`   ${moneda}: ${TASAS_CONVERSION_GLOBAL[moneda].toFixed(6)} USD`);
                }
            });
            
            return TASAS_CONVERSION_GLOBAL;
            
        } else {
            throw new Error('Todas las APIs fallaron');
        }
        
    } catch (error) {
        console.error('❌ Error cargando tasas online:', error.message);
        console.log('🔄 Usando tasas de respaldo...');
        
        // En caso de error, usar tasas de respaldo
        TASAS_CONVERSION_GLOBAL = { ...TASAS_CONVERSION_RESPALDO };
        tasasCargadas = true;
        fechaCargaTasas = new Date();
        
        console.log(`⚠️ USANDO TASAS DE RESPALDO:`);
        console.log(`📊 Total de monedas disponibles: ${Object.keys(TASAS_CONVERSION_GLOBAL).length}`);
        
        return TASAS_CONVERSION_GLOBAL;
    }
}

// Función para convertir moneda a USD (optimizada)
function convertirAUSD(monto, moneda) {
    // Normalizar código de moneda
    const monedaNormalizada = moneda.toUpperCase();
    
    // Usar las tasas globales cargadas al inicio
    if (TASAS_CONVERSION_GLOBAL[monedaNormalizada]) {
        const montoUSD = monto * TASAS_CONVERSION_GLOBAL[monedaNormalizada];
        console.log(`💱 Conversión: ${monto} ${monedaNormalizada} = $${montoUSD.toFixed(2)} USD (tasa: ${TASAS_CONVERSION_GLOBAL[monedaNormalizada].toFixed(6)})`);
        return montoUSD;
    } else {
        console.warn(`⚠️ Moneda no soportada: ${monedaNormalizada}. Usando valor original como USD.`);
        return monto; // Si no se encuentra la moneda, asumir que ya es USD
    }
}

// Función para obtener información de tasas (para debugging)
function obtenerInfoTasas() {
    return {
        tasasCargadas: tasasCargadas,
        fechaCarga: fechaCargaTasas ? fechaCargaTasas.toLocaleString() : 'No cargadas',
        monedasDisponibles: Object.keys(TASAS_CONVERSION_GLOBAL).length,
        algunasMonedas: Object.keys(TASAS_CONVERSION_GLOBAL).slice(0, 10).join(', '),
        tieneNGN: TASAS_CONVERSION_GLOBAL.NGN ? `NGN: ${TASAS_CONVERSION_GLOBAL.NGN.toFixed(6)}` : 'NGN no disponible',
        tieneDOP: TASAS_CONVERSION_GLOBAL.DOP ? `DOP: ${TASAS_CONVERSION_GLOBAL.DOP.toFixed(6)}` : 'DOP no disponible'
    };
}

// Función para verificar si una moneda está soportada
function estaMonedaSoportada(moneda) {
    const monedaNormalizada = moneda.toUpperCase();
    return TASAS_CONVERSION_GLOBAL.hasOwnProperty(monedaNormalizada);
}

// Función para listar todas las monedas soportadas
function listarMonedasSoportadas() {
    return Object.keys(TASAS_CONVERSION_GLOBAL).sort();
}

module.exports = { 
    TASAS_CONVERSION: TASAS_CONVERSION_RESPALDO, // Para compatibilidad hacia atrás
    cargarTasasConversionAlInicio,
    convertirAUSD,
    obtenerInfoTasas,
    estaMonedaSoportada,
    listarMonedasSoportadas
}; 