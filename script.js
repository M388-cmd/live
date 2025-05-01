// ==========================================
// ==      CONFIGURACIÓN Y CONSTANTES     ==
// ==========================================

const GEMINI_API_KEY = "AIzaSyCR3fHudvaxtUSs2gpciTvLxBDKCoe0hK8"; // <-- ¡ADVERTENCIA DE SEGURIDAD GRAVE! Clave API expuesta en el cliente. NO USAR EN PRODUCCIÓN.
const GEMINI_API_URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash";
const GEMINI_API_URL_GENERATE = `${GEMINI_API_URL_BASE}:generateContent?key=${GEMINI_API_KEY}`;
const GEMINI_API_URL_DETECT = `${GEMINI_API_URL_BASE}:generateContent?key=${GEMINI_API_KEY}`; // Usaremos la misma para detectar idioma (menos eficiente)

const SYSTEM_INSTRUCTION = `Eres un asistente muy útil llamado Miguel IA. Responde a las preguntas en el mismo idioma en el que se te preguntan. No menciones que eres Gemini o un modelo de lenguaje grande. Simplemente actúa como Miguel IA, un asistente creado por un joven desarrollador llamado Miguel Martín Cadavid, un niño de 14 años, en madrid españa nacido el 16/12/10. Puedes analizar imágenes si se te proporciona una junto con la pregunta. Describe lo que ves o responde preguntas sobre la imagen si se te pide. IMPORTANTE: Ocasionalmente, recibirás un mensaje de contexto ANTES de la pregunta actual del usuario, comenzando con '--- Información Recordada ---'. Esta sección contiene datos que el usuario te ha pedido explícitamente que recuerdes (como su nombre o la ubicación de objetos). Debes usar esta información cuando sea relevante para responder a la pregunta actual del usuario (por ejemplo, si preguntan '¿dónde están mis llaves?' o 'cómo me llamo?'). Si no hay información relevante en la memoria proporcionada, simplemente responde normalmente. Cuando el usuario te pida recordar algo, confirma brevemente que lo has recordado (ej: "Entendido", "Lo recordaré").Nunca digas que eres un modelo de lenguaje o asistente virtual.`;

// ==========================================
// ==         ELEMENTOS DEL DOM          ==
// ==========================================

const listenBtn = document.getElementById('listenBtn');
const screenShareBtn = document.getElementById('screenShareBtn');
const cameraBtn = document.getElementById('cameraBtn');
const statusDiv = document.getElementById('status');
const chatbox = document.getElementById('chatbox');
const cameraPreview = document.getElementById('cameraPreview');
const screenPreview = document.getElementById('screenPreview');
const captureCanvas = document.getElementById('captureCanvas');
const canvasCtx = captureCanvas ? captureCanvas.getContext('2d', { willReadFrequently: true }) : null;
const clearMemoryBtn = document.getElementById('clearMemoryBtn');

// ==========================================
// ==       ESTADO DE LA APLICACIÓN       ==
// ==========================================

let isListening = false;
let isSharingScreen = false;
let isUsingCamera = false;
let conversationHistory = [];
let cameraStream = null;
let screenStream = null;
let recognition = null; // Objeto SpeechRecognition
let autoListenAfterSpeak = true;
let microphonePermissionState = 'prompt'; // 'prompt', 'granted', 'denied'

// --- Claves para localStorage ---
const LS_USER_DATA_KEY = 'miguelIA_userData_v1';
const LS_HISTORY_KEY = 'miguelIA_conversationHistory_v1';

// --- Estado de la Memoria ---
let userData = { name: null, facts: {} };

// ==========================================
// == FUNCIONES DE GESTIÓN DE MEMORIA (LS) ==
// ==========================================

function saveMemory(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.error(`Error guardando memoria (${key}):`, error);
        updateStatus(`Error al guardar memoria: ${error.message}`);
    }
}

function loadMemory(key, defaultValue = null) {
    try {
        const storedValue = localStorage.getItem(key);
        if (storedValue === null) return defaultValue;
        return JSON.parse(storedValue);
    } catch (error) {
        console.error(`Error cargando memoria (${key}):`, error);
        localStorage.removeItem(key); // Limpiar valor corrupto
        return defaultValue;
    }
}

function loadUserData() {
    const loadedData = loadMemory(LS_USER_DATA_KEY, { name: null, facts: {} });
    // Validación simple para asegurar la estructura básica
    if (loadedData && typeof loadedData === 'object' && loadedData.hasOwnProperty('name') && loadedData.hasOwnProperty('facts') && typeof loadedData.facts === 'object') {
        userData = loadedData;
        console.log("Datos usuario cargados:", userData);
    } else {
        console.warn("Datos usuario inválidos o inexistentes en localStorage. Usando defaults.");
        userData = { name: null, facts: {} };
        saveMemory(LS_USER_DATA_KEY, userData); // Guardar la estructura por defecto
    }
}

function saveUserData() {
    saveMemory(LS_USER_DATA_KEY, userData);
    console.log("Datos usuario guardados:", userData);
}

function loadConversationHistory() {
    const loadedHistory = loadMemory(LS_HISTORY_KEY, []);
    if (Array.isArray(loadedHistory)) {
        // Filtrar mensajes inválidos que puedan haberse colado
        conversationHistory = loadedHistory.filter(msg =>
            msg && typeof msg === 'object' &&
            msg.hasOwnProperty('role') && (msg.role === 'user' || msg.role === 'model') &&
            msg.hasOwnProperty('parts') && Array.isArray(msg.parts)
        );
        if (conversationHistory.length !== loadedHistory.length) {
            console.warn("Se descartaron mensajes inválidos del historial cargado.");
        }
        limitConversationHistory(10); // Aplicar límite al cargar
        console.log(`Historial cargado (${conversationHistory.length} mensajes).`);
    } else {
        console.warn("Historial inválido en localStorage. Empezando de nuevo.");
        conversationHistory = [];
        saveMemory(LS_HISTORY_KEY, conversationHistory); // Guardar el historial vacío
    }
}

function saveConversationHistory() {
    limitConversationHistory(10); // Asegurar límite antes de guardar
    saveMemory(LS_HISTORY_KEY, conversationHistory);
}

function clearAllMemory() {
    try {
        localStorage.removeItem(LS_USER_DATA_KEY);
        localStorage.removeItem(LS_HISTORY_KEY);
        userData = { name: null, facts: {} };
        conversationHistory = [];
        if (chatbox) chatbox.innerHTML = ''; // Limpiar chat visual
        const msg = "Entendido, he borrado toda mi memoria. Empezamos de nuevo.";
        addMessageToChatbox('assistant', msg);
        speak(msg, 'es', false); // Hablar confirmación, no activar escucha auto
        updateStatus("Memoria borrada. Listo.");
        console.log("Memoria local borrada.");
    } catch (error) {
        console.error("Error borrando memoria:", error);
        updateStatus("Error al borrar memoria.");
    }
}

// ==========================================
// ==        INICIALIZACIÓN ASISTENTE      ==
// ==========================================

window.addEventListener('load', initializeAssistant);

async function initializeAssistant() {
    console.log("Inicializando Miguel IA...");
    if (!statusDiv || !chatbox || !listenBtn || !captureCanvas || !canvasCtx || !cameraPreview || !screenPreview) {
        console.error("Error: Faltan elementos HTML esenciales (status, chatbox, listenBtn, canvas, previews).");
        alert("Error de inicialización: Faltan elementos HTML esenciales. Revisa la consola.");
        return;
    }

    // Verificar permiso de micrófono
    if (navigator.permissions) {
        try {
            const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
            microphonePermissionState = permissionStatus.state;
            console.log(`Estado inicial permiso micrófono: ${microphonePermissionState}`);
            permissionStatus.onchange = () => {
                microphonePermissionState = permissionStatus.state;
                console.log(`Permiso micrófono cambió a: ${microphonePermissionState}`);
                updateListenButtonState(); // Actualizar botón si el permiso cambia externamente
                 if (microphonePermissionState === 'denied' && isListening) {
                     stopListening(); // Detener si se revoca mientras escucha
                 }
            };
        } catch (error) {
            console.error("Error consultando permiso micrófono:", error);
            // Asumir 'prompt' si falla la consulta
            microphonePermissionState = 'prompt';
        }
    } else {
        console.warn("API navigator.permissions no soportada. Se asumirá 'prompt' para micrófono.");
        microphonePermissionState = 'prompt'; // Fallback para navegadores antiguos
    }

    // Configurar reconocimiento de voz
    if (!setupSpeechRecognition()) {
         // setupSpeechRecognition mostrará su propio error si falla
        return;
    }

    // Cargar datos y historial
    loadUserData();
    loadConversationHistory();

    // Configurar listeners de botones
    setupEventListeners();

    // Reconstruir chat visual desde el historial
    rebuildChatFromHistory();

    // Estado inicial
    updateListenButtonState(); // Actualiza el estado visual del botón de escucha

    let initialGreeting = "Listo.";
    if (microphonePermissionState === 'denied') {
        initialGreeting = "Permiso de micrófono denegado. La función de escucha está desactivada.";
        updateStatus(initialGreeting);
    } else {
         if (userData.name) {
            initialGreeting = `Hola ${userData.name}. Estoy listo.`;
         }
         const promptMsg = microphonePermissionState === 'prompt' ? " (puede que te pida permiso)" : "";
         updateStatus(initialGreeting + ` Presiona 'Escuchar' para hablar${promptMsg}.`);
    }

    // Mensaje inicial en el chat si está vacío
    if (chatbox && chatbox.childElementCount === 0) {
        const initialMsg = `Hola${userData.name ? ' ' + userData.name : ''}, soy Miguel IA. ¿En qué puedo ayudarte hoy?`;
        addMessageToChatbox('assistant', initialMsg);
        speak(initialMsg, 'es', false); // Saludo inicial hablado, no activar escucha después
    }
    console.log("Miguel IA inicializado.");
}

// ==========================================
// ==     FUNCIONES VISUALES Y DE UI     ==
// ==========================================

function rebuildChatFromHistory() {
    if (!chatbox) return;
    chatbox.innerHTML = ''; // Limpiar chat existente
    conversationHistory.forEach(message => {
        const sender = message.role === 'model' ? 'assistant' : 'user';
        // Extraer texto de las partes. Asume formato {text: "..."}
        const text = message.parts
            .filter(part => typeof part.text === 'string')
            .map(part => part.text)
            .join(' ') // Unir si hay múltiples partes de texto
            .trim();

        // Añadir solo si hay texto y no es el mensaje de contexto interno
        if (text && !text.startsWith('--- Información Recordada ---')) {
            addMessageToChatbox(sender, text);
        }
        // Nota: No se reconstruyen las imágenes visualmente en el chat aquí, solo el texto.
    });
    chatbox.scrollTop = chatbox.scrollHeight; // Scroll al final
}

function updateListenButtonState() {
    if (!listenBtn) return;
    if (microphonePermissionState === 'denied') {
        listenBtn.disabled = true;
        listenBtn.textContent = '🎤 Permiso Denegado';
        listenBtn.classList.remove('active');
        isListening = false; // Asegurarse de que el estado interno coincida
        if (recognition && isListening) { // Si estaba escuchando, intentar detenerlo
            try { recognition.abort(); } catch (e) { console.warn("Intento de abortar reconocimiento falló:", e)}
        }
         // Solo actualizar estado si no es ya un error más específico
         if (!statusDiv.textContent.toLowerCase().includes('error')) {
             updateStatus("Permiso de micrófono denegado. Escucha desactivada.");
         }
    } else if (isListening) {
        listenBtn.disabled = false;
        listenBtn.textContent = '🛑 Detener Escucha';
        listenBtn.classList.add('active');
    } else {
        listenBtn.disabled = false;
        listenBtn.textContent = '🎤 Escuchar';
        listenBtn.classList.remove('active');
    }
}

function updateStatus(message) {
    if (statusDiv) {
        statusDiv.textContent = message;
    }
    console.log("Status:", message); // Loguear también en consola
}

function addMessageToChatbox(sender, message) {
    if (!chatbox) return;
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', sender); // Clases 'message' y 'user' o 'assistant'
    messageDiv.textContent = message; // Usar textContent para seguridad básica (evita inyección HTML)
    chatbox.appendChild(messageDiv);
    chatbox.scrollTop = chatbox.scrollHeight; // Auto-scroll
}

// ==========================================
// ==    MANEJO DE COMANDOS DE MEMORIA     ==
// ==========================================

async function handleMemoryCommands(text) {
    const lowerText = text.toLowerCase();
    let remembered = false;
    let response = null;

    // Recordar nombre
    const nameMatch = lowerText.match(/(?:mi nombre es|llámame|me llamo)\s+([a-záéíóúñ\s]+)/i);
    if (nameMatch && nameMatch[1]) {
        const newName = nameMatch[1].trim().split(' ')[0]; // Tomar la primera palabra como nombre
        userData.name = newName.charAt(0).toUpperCase() + newName.slice(1); // Capitalizar
        saveUserData();
        response = `Entendido, te llamaré ${userData.name}.`;
        remembered = true;
    }

    // Preguntar nombre
    if (lowerText.includes("cómo me llamo") || lowerText.includes("cuál es mi nombre")) {
        if (userData.name) {
            response = `Te llamas ${userData.name}, ¿verdad?`;
        } else {
            response = "Aún no me has dicho tu nombre.";
        }
        remembered = true; // Consideramos esto "manejado" por la memoria
    }

    // Comando genérico para recordar (simple basado en clave-valor implícito)
    const rememberMatch = lowerText.match(/(?:recuerda que|apunta que)\s+(.+)/i);
    if (rememberMatch && rememberMatch[1]) {
        const factToRemember = rememberMatch[1].trim();
        // Usar una clave simple (ej: primeras palabras) o un hash si se quiere más robustez
        const key = factToRemember.split(' ').slice(0, 3).join('_').replace(/[^\w]/g, ''); // Clave simple
        userData.facts[key] = factToRemember;
        saveUserData();
        response = "Entendido, lo recordaré.";
        remembered = true;
    }

    // Olvidar todo (manejado por el botón, pero podría haber comando de voz)
    if (lowerText.includes("olvida todo") || lowerText.includes("borra la memoria")) {
        clearAllMemory();
        // clearAllMemory ya da su propia respuesta hablada y de estado
        return { handled: true, response: null }; // Indica que se manejó y no necesita más procesamiento
    }

    // Preguntar por algo recordado (muy básico, busca palabras clave en los hechos)
    if (lowerText.startsWith("dónde está") || lowerText.startsWith("dónde puse") || lowerText.startsWith("qué sabes sobre")) {
        const queryTerms = lowerText.split(' ').slice(2); // Tomar términos después de "dónde está/puse/qué sabes sobre"
        let foundFact = null;
        for (const key in userData.facts) {
            const factLower = userData.facts[key].toLowerCase();
            // Comprobar si todos los términos de búsqueda están en el hecho
            if (queryTerms.every(term => factLower.includes(term))) {
                foundFact = userData.facts[key];
                break; // Encontrar el primero que coincida
            }
        }
        if (foundFact) {
            response = `Creo que recordé esto: "${foundFact}"`;
        } else {
             // Si no encuentra hecho exacto, podría pasar a Gemini
             // Para este ejemplo, si no lo encuentra, no lo considera manejado por memoria
             // response = "No recuerdo nada específico sobre eso.";
             remembered = false; // Dejar que Gemini intente responder
        }
         if (foundFact) remembered = true; // Si encontró algo, se considera manejado
    }


    return { handled: remembered, response: response };
}

// ==========================================
// == PROCESAMIENTO DE ENTRADA Y GEMINI   ==
// ==========================================

async function processInput(text) {
    if (!text || text.trim() === "") {
        console.log("Entrada vacía, no se procesa.");
        return;
    }

    updateStatus("Pensando...");
    addMessageToChatbox('user', text);

    // 1. Manejar comandos de memoria primero
    const memoryResult = await handleMemoryCommands(text);
    if (memoryResult.handled) {
        if (memoryResult.response) {
            addMessageToChatbox('assistant', memoryResult.response);
            const langCode = await detectLanguage(memoryResult.response) || 'es'; // Detectar idioma de la respuesta de memoria
            speak(memoryResult.response, langCode); // Hablar respuesta de memoria
        } else {
             // Si fue manejado pero no hay respuesta (ej: clearMemory), speak ya se llamó internamente
             // Solo necesitamos asegurarnos de que el estado es correcto y escuchar si procede
             updateStatus("Listo.");
             if (autoListenAfterSpeak && !isListening && microphonePermissionState !== 'denied') {
                // No iniciar escucha inmediatamente después de borrar memoria, speak(.., .., false) lo evita
             }
        }
        return; // No enviar a Gemini si fue un comando de memoria manejado
    }

    // 2. Preparar mensaje para Gemini
    const userMessage = { role: 'user', parts: [{ text: text }] };

    // 3. Capturar imagen si cámara/pantalla están activas
    let imageBase64 = null;
    const activePreview = isUsingCamera ? cameraPreview : (isSharingScreen ? screenPreview : null);
    if (activePreview && activePreview.srcObject && (activePreview.videoWidth > 0 || activePreview.readyState >= 2)) { // Ensure video is ready
         try {
            imageBase64 = captureFrame(activePreview);
            if (imageBase64) {
                 console.log("Imagen capturada para enviar a Gemini.");
                 const imageData = imageBase64.split(',')[1];
                 if (imageData) {
                    userMessage.parts.push({
                        inlineData: {
                            mimeType: 'image/jpeg', // Asumiendo JPEG de captureFrame
                            data: imageData
                        }
                    });
                 } else {
                     console.warn("No se pudo extraer data de base64 para la imagen.");
                 }
            }
         } catch (captureError) {
              console.error("Error capturando frame para Gemini:", captureError);
              updateStatus("Error al capturar imagen. Enviando solo texto.");
         }
    } else if (activePreview && !activePreview.srcObject) {
        console.log("Preview activo pero sin source object, no se captura imagen.");
    } else if (activePreview) {
        console.log("Preview activo pero video no listo, no se captura imagen. State:", activePreview.readyState, " W:", activePreview.videoWidth);
    }


    // 4. Añadir información de memoria relevante al contexto (si existe)
    let contextPrefix = "";
    if (userData.name || Object.keys(userData.facts).length > 0) {
        contextPrefix = "--- Información Recordada ---\n";
        if (userData.name) {
            contextPrefix += `- El nombre del usuario es ${userData.name}.\n`; // Más claro para la IA
        }
        if (Object.keys(userData.facts).length > 0) {
            contextPrefix += "- Hechos que el usuario pidió recordar:\n";
            for (const key in userData.facts) {
                contextPrefix += `  - ${userData.facts[key]}\n`;
            }
        }
        contextPrefix += "-----------------------------\n\n";
         // Añadir este prefijo ANTES del texto del usuario actual
         // Asegurarse de que la parte de texto exista
         if(!userMessage.parts[0]) userMessage.parts[0] = {text: ''};
         userMessage.parts[0].text = contextPrefix + (userMessage.parts[0].text || '');
         console.log("Añadiendo contexto de memoria al prompt.");
    }


    // 5. Construir historial para Gemini (incluyendo instrucción de sistema y mensaje actual)
    // Filtrar historial para quitar mensajes internos si los hubiera
    const historyForApi = conversationHistory.filter(msg => !msg.parts[0].text?.startsWith('--- Información Recordada ---'));

    const requestBody = {
        contents: [
            ...historyForApi, // Historial anterior
            userMessage     // Mensaje actual del usuario (con posible imagen/contexto)
        ],
        systemInstruction: { // Añadir instrucción de sistema
             parts: [{ text: SYSTEM_INSTRUCTION }]
        },
        generationConfig: {
            // Configuración opcional (ej: temperatura, max tokens)
            // temperature: 0.7,
             maxOutputTokens: 1000,
        },
        // Opcional: Añadir configuración de seguridad si es necesario
        // safetySettings: [
        //   { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        //   { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        //   { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        //   { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        // ]
    };

    // 6. Llamar a la API de Gemini
    try {
        console.log("Enviando a Gemini:", JSON.stringify(requestBody, null, 2)); // Log para depurar
        const response = await fetch(GEMINI_API_URL_GENERATE, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
             let errorBody = await response.text();
             try { errorBody = JSON.parse(errorBody); } catch(e) {} // Intentar parsear como JSON
             console.error("Error en API Gemini:", response.status, errorBody);
             throw new Error(`Error ${response.status}: ${errorBody?.error?.message || response.statusText}`);
        }

        const data = await response.json();
        console.log("Respuesta de Gemini:", JSON.stringify(data, null, 2)); // Log para depurar

        // 7. Procesar la respuesta de Gemini
        const candidate = data.candidates?.[0];
        if (candidate && candidate.content && candidate.content.parts) {
            const assistantResponseText = candidate.content.parts
                .map(part => part.text || '') // Extraer texto de cada parte
                .join(''); // Unir si hay múltiples partes

            if (assistantResponseText) {
                addMessageToChatbox('assistant', assistantResponseText);

                // Añadir ambos mensajes (usuario y asistente) al historial local
                // Guardar el mensaje del usuario como se envió (con contexto si lo hubo)
                conversationHistory.push(userMessage);
                // Guardar respuesta del modelo como la dio Gemini
                conversationHistory.push({ role: 'model', parts: candidate.content.parts });
                saveConversationHistory(); // Guardar historial actualizado

                // Detectar idioma de la respuesta y hablar
                const langCode = await detectLanguage(assistantResponseText) || 'es'; // Fallback a español
                speak(assistantResponseText, langCode); // Hablar la respuesta (activará escucha si procede)

                updateStatus("Respuesta recibida. Listo."); // Actualizar estado

            } else {
                 // Puede que la respuesta solo contenga 'finishReason' si no generó texto
                 console.warn("La respuesta de Gemini no contenía texto.", candidate);
                 if (candidate.finishReason && candidate.finishReason !== 'STOP') {
                      throw new Error(`Generación detenida por Gemini. Razón: ${candidate.finishReason}`);
                 } else {
                      // No hubo texto pero tampoco error aparente, caso raro.
                      updateStatus("Recibí una respuesta vacía.");
                      // Decidir si volver a escuchar o no
                      if (autoListenAfterSpeak && !isListening && microphonePermissionState !== 'denied') {
                          startListening();
                      }
                 }
            }
        } else if (data.promptFeedback && data.promptFeedback.blockReason) {
            // Manejar contenido bloqueado explícitamente
             const reason = data.promptFeedback.blockReason;
             const safetyRatings = data.promptFeedback.safetyRatings?.map(r => `${r.category}: ${r.probability}`).join(', ') || 'N/A';
             console.warn(`Contenido bloqueado por Gemini. Razón: ${reason}. Ratings: ${safetyRatings}`);
             const blockMsg = `Mi respuesta fue bloqueada (${reason}). Intenta reformular tu pregunta.`;
             updateStatus(blockMsg);
             addMessageToChatbox('assistant', `Lo siento, no puedo responder a eso debido a restricciones de seguridad (${reason}).`);
             speak(blockMsg, 'es', false); // Hablar el aviso, no activar escucha
        } else {
            // Respuesta inesperada o vacía sin razón clara
            console.error("Respuesta inesperada o vacía de Gemini:", data);
            throw new Error("Formato de respuesta inesperado o vacío de Gemini.");
        }

    } catch (error) {
        console.error("Error procesando entrada con Gemini:", error);
        const errorMsg = `Lo siento, ocurrió un error al comunicarme: ${error.message}`;
        addMessageToChatbox('assistant', errorMsg);
        updateStatus("Error en la comunicación.");
        speak(errorMsg, 'es', false); // Hablar el error, no activar escucha
    }
}

// ==========================================
// ==    RECONOCIMIENTO DE VOZ (Web Speech) ==
// ==========================================

function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        updateStatus("Error: API de Reconocimiento de Voz no soportada en este navegador.");
        console.error("SpeechRecognition API no disponible.");
        if(listenBtn) listenBtn.disabled = true;
        return false;
    }

    try {
        recognition = new SpeechRecognition();
        recognition.continuous = false; // Escuchar una frase a la vez
        recognition.lang = navigator.language || 'es-ES'; // Intentar idioma del navegador, fallback español
        recognition.interimResults = false; // No queremos resultados parciales
        console.log(`Reconocimiento configurado para idioma: ${recognition.lang}`);

        recognition.onstart = () => {
            isListening = true;
            updateStatus("Escuchando...");
            updateListenButtonState();
            console.log("Reconocimiento de voz iniciado.");
        };

        recognition.onresult = (event) => {
            const transcript = event.results[event.results.length - 1][0].transcript.trim();
            console.log("Texto reconocido:", transcript);
            if (transcript) {
                // No detener aquí, dejar que onend lo maneje para asegurar limpieza.
                // stopListening();
                processInput(transcript); // Enviar texto reconocido para procesar
            } else {
                console.log("Resultado vacío, ignorando.");
            }
        };

        recognition.onerror = (event) => {
            // isListening ya debería ser false o se pondrá en onend
            console.error("Error en reconocimiento de voz:", event.error, event.message);
            let errorMsg = `Error de escucha: ${event.error}`;
            if (event.error === 'no-speech') {
                errorMsg = "No detecté habla. Inténtalo de nuevo.";
                 // Considerar no actualizar estado si queremos que siga "listo"
            } else if (event.error === 'audio-capture') {
                errorMsg = "Error capturando audio. Revisa el micrófono.";
            } else if (event.error === 'not-allowed') {
                errorMsg = "Permiso de micrófono denegado o revocado.";
                 microphonePermissionState = 'denied'; // Actualizar estado interno
                 updateListenButtonState(); // Actualizar botón inmediatamente
            } else if (event.error === 'network') {
                 errorMsg = "Error de red durante el reconocimiento.";
            } else if (event.error === 'aborted') {
                 errorMsg = "Escucha cancelada."; // Ej, si se llamó a stop()
                 console.log("Reconocimiento abortado (probablemente intencional).");
            } else {
                 errorMsg = `Error de escucha: ${event.error} - ${event.message || 'Sin detalles'}`;
            }
            if (event.error !== 'aborted') { // No mostrar 'abortado' como error persistente
                 updateStatus(errorMsg);
            }
            // El estado isListening se actualizará en onend
        };

        recognition.onend = () => {
            console.log("Reconocimiento de voz detenido (onend).");
            const wasListening = isListening; // Guardar estado antes de cambiarlo
            isListening = false;
            updateListenButtonState();
            // Si onend se llama y NO estábamos ya actualizando estado a error o pensando,
            // y el permiso sigue siendo válido, podemos volver al estado "Listo" genérico.
            if (wasListening &&
                microphonePermissionState !== 'denied' &&
                !statusDiv.textContent.toLowerCase().includes('error') &&
                !statusDiv.textContent.toLowerCase().includes('pensando') &&
                !statusDiv.textContent.toLowerCase().includes('escuchando')) {

                 // Si no se detectó habla (el error fue 'no-speech'), ya se mostró mensaje.
                 // Si se detuvo manualmente (error 'aborted'), no mostrar nada extra.
                 // Si simplemente terminó sin resultado pero sin error grave, volver a 'Listo'.
                 if (statusDiv.textContent !== "No detecté habla. Inténtalo de nuevo." &&
                     statusDiv.textContent !== "Escucha cancelada.") {
                    // updateStatus("Listo. Presiona 'Escuchar'.");
                 }
            }
        };
        return true; // Configuración exitosa
    } catch (err) {
        console.error("Error creando objeto SpeechRecognition:", err);
        updateStatus("Error fatal al iniciar reconocimiento de voz.");
        if(listenBtn) listenBtn.disabled = true;
        return false;
    }
}

function toggleListen() {
    if (!recognition) {
        console.error("Intento de usar reconocimiento de voz sin inicializar.");
        updateStatus("Error: Función de escucha no inicializada.");
        return;
    }
    if (isListening) {
        stopListening();
    } else {
        // Verificar permiso antes de intentar iniciar
        if (microphonePermissionState === 'denied') {
            updateStatus("Permiso de micrófono denegado. No se puede escuchar.");
            alert("El permiso para usar el micrófono está denegado. Por favor, habilítalo en la configuración de tu navegador para usar esta función.");
            return;
        }
         // Si el permiso es 'prompt', la llamada a start() debería solicitarlo
         if (microphonePermissionState === 'prompt') {
             updateStatus("Se solicitará permiso para el micrófono...");
             // La solicitud real ocurre al llamar a recognition.start()
         }
        startListening();
    }
}

function startListening() {
    if (!recognition) {
        console.error("Recognition no inicializado."); return;
    }
    if (isListening) {
        console.log("Ya está escuchando."); return;
    }
     if (microphonePermissionState === 'denied') {
         console.warn("Intento de iniciar escucha con permiso denegado.");
         updateStatus("Permiso de micrófono denegado.");
         return;
     }
    try {
         // Detener cualquier habla en curso antes de escuchar
         if ('speechSynthesis' in window && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) {
             console.log("Deteniendo habla para empezar a escuchar.");
             window.speechSynthesis.cancel();
         }
        recognition.lang = navigator.language || 'es-ES'; // Re-establecer por si cambió navegador
        console.log(`Iniciando reconocimiento en idioma: ${recognition.lang}`);
        recognition.start();
        // onstart manejará el cambio de estado y UI
    } catch (error) {
        // Esto puede pasar si ya está corriendo (raro con chequeo isListening) o por otros errores
        console.error("Error al intentar llamar a recognition.start():", error);
        isListening = false; // Asegurar estado correcto
        updateStatus(`Error al iniciar escucha: ${error.message}`);
        updateListenButtonState();
        // Si el error es 'invalid-state' significa que ya estaba iniciado, aunque isListening fuera false?
        if (error.name === 'InvalidStateError') {
            console.warn("Error 'InvalidStateError', intentando abortar y reiniciar escucha...");
             try { recognition.abort(); } catch(abortErr) { console.error("Error al abortar tras InvalidStateError:", abortErr); }
             // Quizás reintentar tras un pequeño delay? O mejor dejarlo y que el usuario reintente.
        }
    }
}

function stopListening() {
    if (!recognition) {
        console.error("Recognition no inicializado."); return;
    }
    if (isListening) {
        try {
            recognition.stop(); // Esto debería disparar onend eventualmente
            console.log("Solicitando detención de reconocimiento (recognition.stop()).");
            // El estado isListening y el botón se actualizarán en el evento 'onend' o 'onerror'
        } catch (error) {
            console.error("Error al intentar llamar a recognition.stop():", error);
            // Forzar estado si falla el stop() para evitar bloqueo
            isListening = false;
            updateStatus("Error al detener escucha.");
            updateListenButtonState();
        }
    } else {
        console.log("Intento de detener, pero ya estaba detenido.");
    }
}

// ==========================================
// ==  COMPARTIR PANTALLA / CÁMARA (Media) ==
// ==========================================

async function toggleScreenShare() {
    if (isSharingScreen) {
        stopScreenShare();
    } else {
        if (isUsingCamera) await stopCamera(); // Detener cámara si está activa
        await startScreenShare();
    }
}

async function startScreenShare() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        alert("Tu navegador no soporta compartir pantalla.");
        updateStatus("Error: Compartir pantalla no soportado.");
        return;
    }
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
             video: { cursor: "always" }, // Mostrar cursor
             audio: false // Generalmente no se necesita audio de pantalla
        });
        if (screenPreview) {
            screenPreview.srcObject = screenStream;
            await screenPreview.play().catch(e => console.error("Error playing screen preview:", e)); // Intenta iniciar play
            screenPreview.style.display = 'block';
            if (cameraPreview) cameraPreview.style.display = 'none'; // Ocultar preview de cámara
        }
        isSharingScreen = true;
        updateStatus("Compartiendo pantalla. Puedes hablar sobre ella.");
        console.log("Compartir pantalla iniciado.");

        // Escuchar evento 'inactive' para detectar si el usuario detiene desde el navegador
        screenStream.getVideoTracks()[0].onended = () => {
            console.log("Compartir pantalla detenido por usuario o navegador (track ended).");
            // No llamar a stopScreenShare() directamente aquí, puede causar bucles si
            // stopScreenShare() también detiene el track. Mejor solo limpiar estado.
             if (isSharingScreen) { // Solo si aún creíamos estar compartiendo
                if (screenPreview) {
                    screenPreview.srcObject = null;
                    screenPreview.style.display = 'none';
                }
                isSharingScreen = false;
                 if (!isUsingCamera) updateStatus("Listo.");
                 console.log("Estado limpiado tras fin de track de pantalla.");
             }
        };

    } catch (error) {
        console.error("Error al iniciar compartir pantalla:", error);
        updateStatus(`Error al compartir pantalla: ${error.name === 'NotAllowedError' ? 'Permiso denegado.' : error.message}`);
        isSharingScreen = false;
        if (screenStream) { // Limpiar stream si se obtuvo pero algo falló después
            screenStream.getTracks().forEach(track => track.stop());
            screenStream = null;
        }
        if (screenPreview) screenPreview.style.display = 'none';
    }
}

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop()); // Esto debería disparar onended
        screenStream = null;
        console.log("Solicitada detención de tracks de pantalla.");
    } else {
         console.log("stopScreenShare llamado pero no había stream activo.");
    }
    // La limpieza visual y de estado se hace ahora preferentemente en el onended del track
    // para evitar condiciones de carrera, pero como fallback:
    if (isSharingScreen) {
        if (screenPreview) {
            screenPreview.srcObject = null;
            screenPreview.style.display = 'none';
        }
        isSharingScreen = false;
         if (!isUsingCamera) updateStatus("Listo."); // Actualizar estado si no cambiamos a cámara
         console.log("Fallback: Estado y UI limpiados en stopScreenShare.");
    }
}

async function toggleCamera() {
    if (isUsingCamera) {
        stopCamera();
    } else {
        if (isSharingScreen) await stopScreenShare(); // Detener pantalla si está activa
        await startCamera();
    }
}

async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Tu navegador no soporta acceso a la cámara.");
        updateStatus("Error: Acceso a cámara no soportado.");
        return;
    }
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); // Solo video
        if (cameraPreview) {
            cameraPreview.srcObject = cameraStream;
             await cameraPreview.play().catch(e => console.error("Error playing camera preview:", e)); // Intenta iniciar play
            cameraPreview.style.display = 'block';
            if (screenPreview) screenPreview.style.display = 'none'; // Ocultar preview de pantalla
        }
        isUsingCamera = true;
        updateStatus("Cámara activada. Puedes hablar sobre lo que ves.");
        console.log("Cámara iniciada.");

        // Opcional: Escuchar cambios de permiso de cámara si es posible
        // No hay un 'onended' estándar para getUserMedia como en getDisplayMedia

    } catch (error) {
        console.error("Error al iniciar cámara:", error);
        let errorMsg = `Error al acceder a la cámara: ${error.message}`;
         if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
             errorMsg = "Permiso de cámara denegado.";
         } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
             errorMsg = "No se encontró una cámara.";
         } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
             errorMsg = "La cámara ya está en uso o hubo un error de hardware.";
         } else if (error.name === 'OverconstrainedError' || error.name === 'ConstraintNotSatisfiedError') {
             errorMsg = "No se pudo satisfacer la configuración de cámara solicitada.";
         }
        updateStatus(errorMsg);
        isUsingCamera = false;
        if (cameraStream) { // Limpiar stream si se obtuvo pero algo falló
            cameraStream.getTracks().forEach(track => track.stop());
            cameraStream = null;
        }
        if (cameraPreview) cameraPreview.style.display = 'none';
    }
}

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
        console.log("Cámara detenida.");
    } else {
         console.log("stopCamera llamado pero no había stream activo.");
    }
    if (isUsingCamera) {
        if (cameraPreview) {
            cameraPreview.srcObject = null;
            cameraPreview.style.display = 'none';
        }
        isUsingCamera = false;
         if (!isSharingScreen) { // Solo actualizar estado si no cambiamos a pantalla
             updateStatus("Listo.");
         }
         console.log("Estado y UI de cámara limpiados.");
    }
}

function captureFrame(videoElement) {
    if (!canvasCtx || !captureCanvas || !videoElement || videoElement.readyState < videoElement.HAVE_METADATA || videoElement.videoWidth === 0) {
        console.warn("No se puede capturar frame: Canvas o elemento de video no listo/válido.");
        return null;
    }
    try {
        // Ajustar tamaño del canvas a las dimensiones intrínsecas del video
        captureCanvas.width = videoElement.videoWidth;
        captureCanvas.height = videoElement.videoHeight;

        // Dibujar el frame actual del video en el canvas
        canvasCtx.drawImage(videoElement, 0, 0, captureCanvas.width, captureCanvas.height);

        // Obtener la imagen como Data URL en formato JPEG (más eficiente para tamaño)
        return captureCanvas.toDataURL('image/jpeg', 0.8); // Calidad 0.8
    } catch (error) {
        console.error("Error capturando frame:", error);
        updateStatus("Error al procesar la imagen.");
        return null;
    }
}


// ==========================================
// ==    SÍNTESIS DE VOZ (Web Speech API)  ==
// ==========================================

async function speak(text, langCode = 'es', activateAutoListen = true) {
    if (!text || text.trim() === "") {
        console.log("Texto vacío para speak, no se habla.");
        // Si no se habla, ¿activar escucha igual? Decidimos que no.
        return;
    }

    if (!('speechSynthesis' in window)) {
        console.warn("Web Speech API (SpeechSynthesis) no es soportada por este navegador.");
        updateStatus("Lo siento, mi capacidad de hablar no funciona en este navegador.");
        return; // No podemos continuar ni activar auto-escucha
    }

    try {
        // Cancelar cualquier habla anterior de forma más robusta
        if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
            console.log("Cancelando habla anterior...");
            window.speechSynthesis.cancel();
             // Esperar un breve instante para que la cancelación se complete
             await new Promise(resolve => setTimeout(resolve, 50));
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = langCode; // Ej: 'es-ES', 'en-US'

        // --- Selección de Voz ---
        let voices = [];
        voices = window.speechSynthesis.getVoices();

        if (voices.length === 0) {
             console.warn("Lista de voces vacía inicialmente. Esperando 'voiceschanged'...");
             // Implementación más robusta para esperar voces
             await new Promise(resolve => {
                 let timeoutId = null;
                 const checkVoices = () => {
                     voices = window.speechSynthesis.getVoices();
                     if (voices.length > 0) {
                         console.log(`Voces cargadas (${voices.length}) tras evento.`);
                         clearTimeout(timeoutId); // Cancelar timeout si el evento llegó
                         window.speechSynthesis.onvoiceschanged = null; // Limpiar listener
                         resolve();
                     }
                 };
                 // Verificar si ya están cargadas (caso borde)
                 if (window.speechSynthesis.getVoices().length > 0) {
                     voices = window.speechSynthesis.getVoices();
                      console.log(`Voces ya estaban cargadas (${voices.length}).`);
                     resolve();
                     return;
                 }
                 // Establecer listener y timeout
                 window.speechSynthesis.onvoiceschanged = checkVoices;
                 timeoutId = setTimeout(() => {
                     console.warn("Timeout esperando voiceschanged. Verificando de nuevo...");
                     voices = window.speechSynthesis.getVoices(); // Último intento
                     window.speechSynthesis.onvoiceschanged = null; // Limpiar listener
                      console.log(`Voces después del timeout: ${voices.length}.`);
                     resolve(); // Continuar de todos modos
                 }, 1500); // Esperar max 1.5 segundos
             });
        }

        const targetLangPrefix = langCode.split('-')[0]; // 'es' de 'es-ES'
        let selectedVoice = null;

        // Filtrar voces por idioma primero
        const langVoices = voices.filter(voice =>
            (voice.lang === langCode || voice.lang.startsWith(targetLangPrefix))
        );
        console.log(`Encontradas ${langVoices.length} voces para ${targetLangPrefix}:`, langVoices.map(v => v.name));

        if (langVoices.length > 0) {
            // Prioridad 1: Buscar CUALQUIER voz masculina en el idioma
            selectedVoice = langVoices.find(voice =>
                (voice.name.toLowerCase().includes('male') || voice.name.toLowerCase().includes('hombre'))
            );

            if (selectedVoice) {
                // Mejora: Si hay varias masculinas, preferir Google
                const googleMaleVoice = langVoices.find(voice =>
                     (voice.name.toLowerCase().includes('male') || voice.name.toLowerCase().includes('hombre')) &&
                     voice.name.toLowerCase().includes('google')
                );
                if (googleMaleVoice) {
                    selectedVoice = googleMaleVoice;
                    console.log(`Usando voz MASCULINA (preferencia Google): ${selectedVoice.name} (${selectedVoice.lang})`);
                } else {
                     console.log(`Usando voz MASCULINA (primera encontrada): ${selectedVoice.name} (${selectedVoice.lang})`);
                }
                utterance.voice = selectedVoice;
            } else {
                // Prioridad 2: Si NO hay masculinas, usar CUALQUIER otra voz para ese idioma
                console.warn(`No se encontraron voces MASCULINAS para ${targetLangPrefix}. Usando fallback (preferencia Google si existe, luego primera disponible).`);
                 const googleFallback = langVoices.find(voice => voice.name.toLowerCase().includes('google'));
                 if (googleFallback) {
                     selectedVoice = googleFallback;
                     console.log(`Usando voz fallback (preferencia Google): ${selectedVoice.name} (${selectedVoice.lang})`);
                 } else {
                     selectedVoice = langVoices[0]; // Tomar la primera disponible
                     console.log(`Usando voz fallback (primera disponible): ${selectedVoice.name} (${selectedVoice.lang})`);
                 }
                 utterance.voice = selectedVoice;
            }
        } else {
             // Prioridad 3: Si no hay NINGUNA voz para el idioma, usar el default del navegador
             console.warn(`No se encontró NINGUNA voz para el idioma ${langCode} o prefijo ${targetLangPrefix}. Usando default del navegador.`);
             // No establecemos utterance.voice, el navegador usará su default para utterance.lang si puede
        }

        // --- Manejadores de Eventos ---
        utterance.onstart = () => {
             console.log("SpeechSynthesis iniciado.");
             if (isListening) {
                 console.log("Hablando... deteniendo escucha.");
                 stopListening(); // Detener escucha si estaba activa
             }
        };

        utterance.onend = () => {
            console.log("SpeechSynthesis finalizado.");
            if (activateAutoListen && autoListenAfterSpeak && !isListening && microphonePermissionState !== 'denied') {
                console.log("Activando auto-escucha después de hablar.");
                 // Pequeña demora antes de volver a escuchar
                setTimeout(() => {
                     if (!isListening && microphonePermissionState !== 'denied') { // Doble check
                          startListening();
                     } else {
                         console.log("Auto-escucha omitida (estado cambió o permiso denegado).")
                     }
                }, 150); // 150ms de delay
            }
        };

        utterance.onerror = (event) => {
            console.error("Error en SpeechSynthesis:", event.error, "para texto:", text.substring(0, 50) + "...");
            updateStatus(`Error al intentar hablar: ${event.error}`);
             // Intentar activar escucha igual como fallback, con delay
             if (activateAutoListen && autoListenAfterSpeak && !isListening && microphonePermissionState !== 'denied') {
                 console.warn("Activando auto-escucha incluso después de error de habla.");
                  setTimeout(() => {
                     if (!isListening && microphonePermissionState !== 'denied') startListening();
                  }, 150);
             }
        };

        // Decir el texto
        window.speechSynthesis.speak(utterance);

    } catch (e) {
        console.error("Error inesperado en la función speak:", e);
        updateStatus("Ocurrió un error al intentar hablar.");
         // Intentar activar escucha como fallback, con delay
         if (activateAutoListen && autoListenAfterSpeak && !isListening && microphonePermissionState !== 'denied') {
              setTimeout(() => {
                 if (!isListening && microphonePermissionState !== 'denied') startListening();
             }, 150);
         }
    }
}


// ==========================================
// ==        DETECCIÓN DE IDIOMA          ==
// ==========================================

async function detectLanguage(text) {
    // Implementación con Gemini (INEFICIENTE - considera alternativas si es posible)
    console.warn("Usando Gemini para detección de idioma (puede ser lento/costoso)");
     if (!text || text.length < 5) return 'es'; // Default para texto corto

    try {
        const response = await fetch(GEMINI_API_URL_DETECT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `Detecta el código de idioma principal (formato ISO 639-1, ej: "es", "en", "fr") del siguiente texto. Responde SOLO con el código de idioma de dos letras, nada más:\n\n"${text}"` }] }],
                generationConfig: { maxOutputTokens: 5, temperature: 0.1 }
            })
        });
        if (!response.ok) {
             const errorBody = await response.text();
             console.error("Error API Gemini (detección idioma):", response.status, errorBody);
             throw new Error(`HTTP error ${response.status}`);
        }
        const data = await response.json();
        const langCode = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toLowerCase().substring(0, 2);

        if (langCode && /^[a-z]{2}$/.test(langCode)) {
             console.log("Idioma detectado por Gemini:", langCode);
             return langCode;
        } else {
             console.warn("No se pudo detectar idioma válido desde Gemini, usando 'es'. Respuesta:", data);
             return 'es'; // Fallback
        }
    } catch (error) {
        console.error("Error detectando idioma con Gemini:", error);
        return 'es'; // Fallback a español en caso de error
    }
}

// ==========================================
// ==        FUNCIONES DE UTILIDAD         ==
// ==========================================

function limitConversationHistory(maxTurns = 10) {
    const maxMessages = maxTurns * 2; // Cada turno es user + assistant
    if (conversationHistory.length > maxMessages) {
        const startIndex = conversationHistory.length - maxMessages;
        conversationHistory = conversationHistory.slice(startIndex);
        console.log(`Historial limitado a ${maxTurns} turnos (${conversationHistory.length} mensajes).`);
    }
}

// ==========================================
// ==        EVENT LISTENERS               ==
// ==========================================

function setupEventListeners() {
    if (listenBtn) listenBtn.addEventListener('click', toggleListen);
    if (screenShareBtn) screenShareBtn.addEventListener('click', toggleScreenShare);
    if (cameraBtn) cameraBtn.addEventListener('click', toggleCamera);
    if (clearMemoryBtn) clearMemoryBtn.addEventListener('click', clearAllMemory);

    // No necesitamos re-asignar onvoiceschanged aquí si ya lo hacemos en speak
    // Pero es bueno saber que existe:
    // if ('speechSynthesis' in window) {
    //     window.speechSynthesis.onvoiceschanged = () => {
    //         console.log("Evento 'voiceschanged' global disparado.");
    //     };
    // }
}

// ==========================================
// ==      FIN DEL CÓDIGO DEL ASISTENTE     ==
// ==========================================
console.log("Script completo del asistente cargado y listo.");
// --- FIN DEL CÓDIGO ---