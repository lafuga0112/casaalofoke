# Casa Alofoke - Sistema de Monitoreo

Sistema de monitoreo para el reality show "La Casa" de Alofoke Radio Show.

## Características

- Monitoreo de Super Chats en tiempo real
- Sistema de puntuación automático basado en menciones
- Interfaz web en tiempo real con WebSockets
- Rotación automática de API keys de YouTube

## Requisitos

- Node.js 18 o superior
- MySQL o SQLite

## Instalación

1. Clonar el repositorio
2. Instalar dependencias: `npm install`
3. Configurar variables de entorno (ver sección de configuración)
4. Iniciar el servidor: `npm start`

## Configuración

### Variables de entorno

Puedes configurar el sistema mediante variables de entorno o modificando directamente el archivo `config.js`.

```
# Base de datos
DB_HOST=localhost
DB_PORT=3306
DB_USER=usuario
DB_PASSWORD=contraseña
DB_NAME=alofoke

# YouTube API
YT_API_KEYS=clave1,clave2,clave3
YT_VIDEO_ID=ID_del_video

# Servidor
PORT=8080
NODE_ENV=production

# Sistema
POLLING_INTERVAL=300000
EFFECTIVENESS_PERCENTAGE=0.7
```

### Múltiples API Keys de YouTube

El sistema soporta el uso de múltiples API keys de YouTube para evitar alcanzar los límites de cuota. Para configurar múltiples API keys:

1. **Mediante variables de entorno:**
   - Configura la variable `YT_API_KEYS` con las claves separadas por comas:
   ```
   YT_API_KEYS=clave1,clave2,clave3
   ```

2. **Mediante el archivo config.js:**
   - Edita el archivo `config.js` y modifica el array `apiKeys`:
   ```javascript
   youtube: {
     apiKeys: ['clave1', 'clave2', 'clave3'],
     videoId: 'ID_del_video'
   }
   ```

### Funcionamiento del sistema de rotación de API keys

El sistema utiliza una rotación automática de API keys:

1. Cada vez que se realiza una petición a la API de YouTube, se utiliza la siguiente API key en la lista.
2. Si una API key alcanza su límite de cuota, el sistema automáticamente intenta con la siguiente.
3. Si todas las API keys alcanzan su límite de cuota, el sistema mostrará un error.

### Soporte para emojis en la base de datos

El sistema está configurado para soportar emojis y caracteres especiales en la base de datos. Si estás utilizando una base de datos existente que no tiene soporte para UTF-8mb4, puedes ejecutar el script de migración:

```
node database/migrate-to-utf8mb4.js
```

Este script:
1. Modifica la base de datos para usar UTF-8mb4
2. Actualiza todas las tablas para usar UTF-8mb4
3. Modifica todas las columnas de texto para usar UTF-8mb4

**Nota**: Es recomendable hacer una copia de seguridad de la base de datos antes de ejecutar este script.

### Unificación de concursantes duplicados

Si necesitas unificar registros de concursantes duplicados (como Giuseppe/Trujillo), puedes ejecutar el script de unificación:

```
node database/unify-giuseppe-trujillo.js
```

Este script:
1. Actualiza los registros de TRUJILLO a GIUSEPPE
2. Suma los puntos de ambos concursantes
3. Actualiza las referencias en los superchats

**Nota**: Es recomendable hacer una copia de seguridad de la base de datos antes de ejecutar este script.

## Uso

### Iniciar el servidor web

```
npm start
```

### Ejecutar en modo batch

```
node main.js
```

### Modo de depuración

```
node debug.js
```

## Licencia

Este proyecto es privado y no está licenciado para uso público. 