const API_URL = 'https://api.openai.com/v1/chat/completions';
const TRANSCRIPTION_API_URL = 'https://api.openai.com/v1/audio/transcriptions';
const API_KEY = 'INSERT_API_KEY';
const API_CONFIG = {
    maxRetries: 3,
    retryDelay: 1000,
    maxRetryDelay: 10000,
    rateLimitPerMinute: 20,
    rateLimitResetTime: 60000,
    fallbackModels: [
        'gpt-4o-mini',
        'gpt-4o',
        'gpt-3.5-turbo'
    ],
    fallbackModel: 'gpt-4o-mini'
};

const apiUsageMonitor = {
    usageLog: [],
    maxLogSize: 100,
    
    logApiCall(endpoint, model, success, errorCode = null) {
        const timestamp = new Date().toISOString();
        const entry = {
            timestamp,
            endpoint,
            model,
            success,
            errorCode
        };
        
        this.usageLog.unshift(entry);
        if (this.usageLog.length > this.maxLogSize) {
            this.usageLog.pop();
        }
        
        this.checkForSuspiciousActivity();
        
        console.log(`API Call: ${endpoint} | Model: ${model} | Success: ${success} | ${timestamp}`);
    },
    
    checkForSuspiciousActivity() {
        const recentCalls = this.usageLog.slice(0, 20);
        
        const failedCalls = recentCalls.filter(call => !call.success);
        if (recentCalls.length >= 5 && failedCalls.length / recentCalls.length > 0.7) {
            console.warn('Security Alert: High API failure rate detected. Possible API abuse or invalid credentials.');
        }
        
        if (recentCalls.length >= 5) {
            const timestamps = recentCalls.map(call => new Date(call.timestamp).getTime());
            const timeDiffs = [];
            for (let i = 1; i < timestamps.length; i++) {
                timeDiffs.push(timestamps[i-1] - timestamps[i]);
            }
            
            const avgTimeBetweenCalls = timeDiffs.reduce((sum, diff) => sum + diff, 0) / timeDiffs.length;
            if (avgTimeBetweenCalls < 500) {
                console.warn('Security Alert: Unusually rapid API calls detected. Possible automated abuse.');
            }
        }
    },
    
    getUsageStats() {
        if (this.usageLog.length === 0) return { total: 0, success: 0, failure: 0 };
        
        const total = this.usageLog.length;
        const success = this.usageLog.filter(call => call.success).length;
        const failure = total - success;
        
        return {
            total,
            success,
            failure,
            successRate: (success / total * 100).toFixed(1) + '%'
        };
    }
};

const apiRequestQueue = {
    requests: [],
    
    addRequest() {
        const now = Date.now();
        this.requests.push(now);
        this.cleanup(now);
    },
    
    cleanup(currentTime) {
        const windowStart = currentTime - API_CONFIG.rateLimitResetTime;
        this.requests = this.requests.filter(timestamp => timestamp >= windowStart);
    },
    
    
    canMakeRequest() {
        const now = Date.now();
        this.cleanup(now);
        return this.requests.length < API_CONFIG.rateLimitPerMinute;
    },
    
    
    getWaitTime() {
        if (this.canMakeRequest()) return 0;
        
        const now = Date.now();
        this.cleanup(now);
        
        if (this.requests.length === 0) return 0;
        
        
        const oldestRequest = this.requests[0];
        const timeToWait = (oldestRequest + API_CONFIG.rateLimitResetTime) - now;
        return Math.max(0, timeToWait);
    }
};


function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


function getRetryDelay(retryCount) {
    const delay = Math.min(
        API_CONFIG.maxRetryDelay,
        API_CONFIG.retryDelay * Math.pow(2, retryCount)
    );
    
    return delay + (Math.random() * 1000);
}


async function makeApiRequestWithMultiFallback(apiCall, createFallbackCall, targetElement = null) {
    let retryCount = 0;
    let fallbackLevel = -1; 
    let endpoint = 'unknown';
    let model = 'unknown';
    let currentApiCall = apiCall;
    
    
    try {
        const apiCallString = apiCall.toString();
        if (apiCallString.includes('TRANSCRIPTION_API_URL')) {
            endpoint = 'transcription';
            model = MODELS.TRANSCRIPTION;
        } else if (apiCallString.includes('API_URL')) {
            endpoint = 'chat';
            
            const modelMatch = apiCallString.match(/model:\s*['"]([^'"]+)['"]/);
            if (modelMatch && modelMatch[1]) {
                model = modelMatch[1];
            }
        }
    } catch (e) {
        console.warn('Could not extract API call details:', e);
    }
    
    
    const showFallbackNotification = (fallbackLevel, errorMessage = '') => {
        if (!targetElement) return;
        
        let notificationHtml = '';
        
        if (fallbackLevel === 0) {
            notificationHtml = `
                <div class="alert alert-warning mb-3">
                    <i class="fas fa-exclamation-triangle mr-2"></i>
                    <strong>Notice:</strong> The primary model encountered an issue${errorMessage ? ': ' + errorMessage : ''}. 
                    Switching to GPT-4 Mini as a fallback.
                </div>
            `;
        } else if (fallbackLevel === 1) {
            notificationHtml = `
                <div class="alert alert-danger mb-3">
                    <i class="fas fa-exclamation-circle mr-2"></i>
                    <strong>Warning:</strong> Both primary model and GPT-4 Mini failed${errorMessage ? ': ' + errorMessage : ''}. 
                    Using GPT-3.5 Turbo as a last resort. Response accuracy may be affected.
                </div>
            `;
        }
        
        if (notificationHtml) {
            
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = notificationHtml;
            
            
            if (targetElement.firstChild) {
                targetElement.insertBefore(tempDiv.firstChild, targetElement.firstChild);
            } else {
                targetElement.appendChild(tempDiv.firstChild);
            }
        }
    };
    
    while (true) {
        try {
            
            if (!apiRequestQueue.canMakeRequest()) {
                const waitTime = apiRequestQueue.getWaitTime();
                console.log(`Rate limit reached. Waiting ${waitTime}ms before next request.`);
                await wait(waitTime);
            }
            
            
            apiRequestQueue.addRequest();
            
            
            const result = await currentApiCall();
            
            
            const currentModel = fallbackLevel === -1 ? model : 
                                (fallbackLevel < API_CONFIG.fallbackModels.length ? 
                                 API_CONFIG.fallbackModels[fallbackLevel] : 'unknown-fallback');
            apiUsageMonitor.logApiCall(endpoint, currentModel, true);
            
            return result;
            
        } catch (error) {
            console.error(`API request failed (${fallbackLevel === -1 ? 'primary' : 'fallback-' + fallbackLevel}) (attempt ${retryCount + 1}/${API_CONFIG.maxRetries}):`, error);
            
            
            let errorCode = null;
            let errorMessage = '';
            if (error.message) {
                const statusMatch = error.message.match(/API request failed: (\d+)/);
                if (statusMatch && statusMatch[1]) {
                    errorCode = parseInt(statusMatch[1]);
                }
                errorMessage = error.message.replace(/^(API request failed:|Fallback API request failed:)\s*\d+\s*/, '');
            }
            
            
            const currentModel = fallbackLevel === -1 ? model : 
                               (fallbackLevel < API_CONFIG.fallbackModels.length ? 
                                API_CONFIG.fallbackModels[fallbackLevel] : 'unknown-fallback');
            apiUsageMonitor.logApiCall(endpoint, currentModel, false, errorCode);
            
            
            if (error.message && error.message.includes('429')) {
                console.log('Rate limit exceeded. Adding delay before retry.');
                
                await wait(5000 + getRetryDelay(retryCount));
                retryCount++;
            } 
            
            else {
                if (retryCount < API_CONFIG.maxRetries) {
                    
                    const delay = getRetryDelay(retryCount);
                    console.log(`Error occurred. Retrying in ${delay}ms...`);
                    await wait(delay);
                    retryCount++;
                } 
                
                else if (fallbackLevel < API_CONFIG.fallbackModels.length - 1) {
                    
                    retryCount = 0;
                    fallbackLevel++;
                    
                    
                    currentApiCall = createFallbackCall(API_CONFIG.fallbackModels[fallbackLevel], fallbackLevel);
                    
                    
                    showFallbackNotification(fallbackLevel, errorMessage);
                    
                    console.log(`Switching to fallback model: ${API_CONFIG.fallbackModels[fallbackLevel]}`);
                } 
                
                else {
                    throw new Error(`All fallback options exhausted. Last error: ${error.message}`);
                }
            }
            
            
            if (retryCount >= API_CONFIG.maxRetries && fallbackLevel >= API_CONFIG.fallbackModels.length - 1) {
                throw new Error(`Failed after ${API_CONFIG.maxRetries} retry attempts on all models: ${error.message}`);
            }
        }
    }
}


async function makeApiRequestWithRetry(apiCall, fallbackApiCall = null) {
    
    if (fallbackApiCall) {
        return makeApiRequestWithMultiFallback(
            apiCall, 
            (model) => fallbackApiCall,
            null
        );
    }
    
    
    let retryCount = 0;
    let endpoint = 'unknown';
    let model = 'unknown';
    
    
    try {
        const apiCallString = apiCall.toString();
        if (apiCallString.includes('TRANSCRIPTION_API_URL')) {
            endpoint = 'transcription';
            model = MODELS.TRANSCRIPTION;
        } else if (apiCallString.includes('API_URL')) {
            endpoint = 'chat';
            
            const modelMatch = apiCallString.match(/model:\s*['"]([^'"]+)['"]/);
            if (modelMatch && modelMatch[1]) {
                model = modelMatch[1];
            }
        }
    } catch (e) {
        console.warn('Could not extract API call details:', e);
    }
    
    while (true) {
        try {
            
            if (!apiRequestQueue.canMakeRequest()) {
                const waitTime = apiRequestQueue.getWaitTime();
                console.log(`Rate limit reached. Waiting ${waitTime}ms before next request.`);
                await wait(waitTime);
            }
            
            
            apiRequestQueue.addRequest();
            
            
            const result = await apiCall();
            
            
            apiUsageMonitor.logApiCall(endpoint, model, true);
            
            return result;
            
        } catch (error) {
            console.error(`API request failed (attempt ${retryCount + 1}/${API_CONFIG.maxRetries}):`, error);
            
            
            let errorCode = null;
            if (error.message) {
                const statusMatch = error.message.match(/API request failed: (\d+)/);
                if (statusMatch && statusMatch[1]) {
                    errorCode = parseInt(statusMatch[1]);
                }
            }
            
            
            apiUsageMonitor.logApiCall(endpoint, model, false, errorCode);
            
            
            if (error.message && error.message.includes('429')) {
                console.log('Rate limit exceeded. Adding delay before retry.');
                
                await wait(5000 + getRetryDelay(retryCount));
                retryCount++;
            } 
            
            else {
                if (retryCount < API_CONFIG.maxRetries) {
                    const delay = getRetryDelay(retryCount);
                    console.log(`Error occurred. Retrying in ${delay}ms...`);
                    await wait(delay);
                    retryCount++;
                } else {
                    throw error;
                }
            }
            
            
            if (retryCount >= API_CONFIG.maxRetries) {
                throw new Error(`Failed after ${API_CONFIG.maxRetries} retry attempts: ${error.message}`);
            }
        }
    }
}


function initializeRecording() {
    const startRecordingBtn = document.getElementById('startRecording');
    const stopRecordingBtn = document.getElementById('stopRecording');
    
    if (startRecordingBtn && stopRecordingBtn) {
        
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            startRecordingBtn.disabled = true;
            startRecordingBtn.classList.add('opacity-50', 'cursor-not-allowed');
            startRecordingBtn.innerHTML = '<i class="fas fa-microphone-slash mr-2"></i> Recording not supported';
            return;
        }
        
        
        checkAndRequestMicrophoneAccess();
    }
}


async function checkAndRequestMicrophoneAccess() {
    const startRecordingBtn = document.getElementById('startRecording');
    const recordingStatus = document.getElementById('recordingStatus');
    const micStatusIcon = document.getElementById('micStatusIcon');
    const micStatusText = document.getElementById('micStatusText');
    const requestMicBtn = document.getElementById('requestMicAccess');
    
    try {
        
        if (micStatusIcon && micStatusText) {
            micStatusIcon.className = 'fas fa-spinner fa-spin text-blue-500 mr-2';
            micStatusText.textContent = 'Checking microphone access...';
        }
        
        
        try {
            const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
            console.log('Microphone permission status:', permissionStatus.state);
            
            if (permissionStatus.state === 'denied') {
                if (micStatusIcon && micStatusText) {
                    micStatusIcon.className = 'fas fa-microphone-slash text-red-500 mr-2';
                    micStatusText.textContent = 'Microphone access denied';
                }
                if (requestMicBtn) {
                    requestMicBtn.classList.remove('d-none');
                    requestMicBtn.innerHTML = '<i class="fas fa-exclamation-triangle mr-1"></i> Fix Permissions';
                }
                if (startRecordingBtn) {
                    startRecordingBtn.disabled = true;
                    startRecordingBtn.classList.add('opacity-50');
                }
                return false;
            }
        } catch (e) {
            console.log('Permissions API not supported, proceeding with getUserMedia test');
        }
        
        
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 44100
            }
        });
        
        console.log('Microphone access granted successfully');
        
        
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        source.connect(analyser);
        
        
        stream.getTracks().forEach(track => track.stop());
        await audioContext.close();
        
        
        if (micStatusIcon && micStatusText) {
            micStatusIcon.className = 'fas fa-microphone text-green-500 mr-2';
            micStatusText.textContent = 'Microphone ready';
        }
        if (requestMicBtn) {
            requestMicBtn.classList.add('d-none');
        }
        if (startRecordingBtn) {
            startRecordingBtn.disabled = false;
            startRecordingBtn.classList.remove('opacity-50');
        }
        
        return true;
        
    } catch (error) {
        console.error('Microphone access error:', error);
        
        
        if (micStatusIcon && micStatusText) {
            micStatusIcon.className = 'fas fa-microphone-slash text-red-500 mr-2';
            
            if (error.name === 'NotAllowedError') {
                micStatusText.textContent = 'Microphone access blocked';
            } else if (error.name === 'NotFoundError') {
                micStatusText.textContent = 'No microphone found';
            } else if (error.name === 'NotSupportedError') {
                micStatusText.textContent = 'Microphone not supported';
            } else {
                micStatusText.textContent = 'Microphone error';
            }
        }
        
        if (requestMicBtn) {
            requestMicBtn.classList.remove('d-none');
            if (error.name === 'NotAllowedError') {
                requestMicBtn.innerHTML = '<i class="fas fa-microphone mr-1"></i> Enable Microphone';
            } else {
                requestMicBtn.innerHTML = '<i class="fas fa-refresh mr-1"></i> Try Again';
            }
        }
        
        if (startRecordingBtn) {
            startRecordingBtn.disabled = true;
            startRecordingBtn.classList.add('opacity-50');
        }
        
        if (recordingStatus) {
            let errorMessage = '';
            
            if (error.name === 'NotAllowedError') {
                errorMessage = 'Please click the microphone icon in your browser\'s address bar and allow access.';
            } else if (error.name === 'NotFoundError') {
                errorMessage = 'Please connect a microphone and refresh the page.';
            } else if (error.name === 'NotSupportedError') {
                errorMessage = 'Please use Chrome, Firefox, or Safari for recording.';
            } else {
                errorMessage = `Error: ${error.message}`;
            }
            
            recordingStatus.innerHTML = `<i class="fas fa-info-circle mr-2"></i> ${errorMessage}`;
            recordingStatus.className = 'text-amber-600 text-sm mt-2';
        }
        
        return false;
    }
}


document.addEventListener('DOMContentLoaded', function() {
    
    validateApiConfiguration();
    
    
    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get('tab');
    
    if (tabParam) {
        
        const tabToActivate = document.querySelector(`#${tabParam}-tab`);
        if (tabToActivate) {
            const tab = new bootstrap.Tab(tabToActivate);
            tab.show();
        }
    } else {
        
        const activeTab = localStorage.getItem('activeTab');
        if (activeTab) {
            
            const tabToActivate = document.querySelector(`#${activeTab}-tab`);
            if (tabToActivate) {
                const tab = new bootstrap.Tab(tabToActivate);
                tab.show();
            }
            
            localStorage.removeItem('activeTab');
        }
    }
    
    
    animateElementsOnLoad();
    
    
    const viewSummaryBtn = document.getElementById('viewSummaryBtn');
    if (viewSummaryBtn) {
        viewSummaryBtn.addEventListener('click', function() {
            const summaryContainer = document.getElementById('diagnosisSummaryContainer');
            const summaryContent = document.getElementById('diagnosisSummaryContent');
            
            if (summaryContainer && summaryContent) {
                
                if (summaryContainer.classList.contains('d-none')) {
                    
                    summaryContainer.classList.remove('d-none');
                    
                    
                    if (initialDiagnosisSummary) {
                        summaryContent.innerHTML = convertMarkdownToHTML(initialDiagnosisSummary, true);
                    } else {
                        summaryContent.textContent = 'No diagnosis summary available yet.';
                    }
                    
                    
                    this.innerHTML = '<i class="fas fa-eye-slash"></i> Hide Summary';
                } else {
                    
                    summaryContainer.classList.add('d-none');
                    
                    
                    this.innerHTML = '<i class="fas fa-eye"></i> View Summary';
                }
            }
        });
    }
    
    
    setupRecordingIndicator();
});


function validateApiConfiguration() {
    if (!API_KEY || API_KEY === 'your-api-key-here' || API_KEY.length < 40) {
        console.error('Invalid API key configuration');
        
        
        const warningDiv = document.createElement('div');
        warningDiv.className = 'alert alert-warning fixed-top m-3';
        warningDiv.style.zIndex = '9999';
        warningDiv.innerHTML = `
            <i class="fas fa-exclamation-triangle mr-2"></i>
            <strong>Configuration Warning:</strong> API key appears to be invalid or missing. 
            Please check your configuration in script.js file.
        `;
        
        document.body.appendChild(warningDiv);
        
        
        setTimeout(() => {
            if (warningDiv.parentNode) {
                warningDiv.parentNode.removeChild(warningDiv);
            }
        }, 10000);
    } else {
        console.log('API configuration appears valid');
    }
}


function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


function validateApiConfiguration() {
    if (!API_KEY || API_KEY === 'your-api-key-here' || API_KEY.length < 40) {
        console.error('Invalid API key configuration');
        
        
        const warningDiv = document.createElement('div');
        warningDiv.className = 'alert alert-warning fixed-top m-3';
        warningDiv.style.zIndex = '9999';
        warningDiv.innerHTML = `
            <i class="fas fa-exclamation-triangle mr-2"></i>
            <strong>Configuration Warning:</strong> API key appears to be invalid or missing. 
            Please check your configuration in script.js file.
        `;
        
        document.body.appendChild(warningDiv);
        
        
        setTimeout(() => {
            if (warningDiv.parentNode) {
                warningDiv.parentNode.removeChild(warningDiv);
            }
        }, 10000);
    } else {
        console.log('API configuration appears valid');
    }
}


function setupRecordingIndicator() {
    const startRecordingBtn = document.getElementById('startRecording');
    const stopRecordingBtn = document.getElementById('stopRecording');
    const recordingStatus = document.getElementById('recordingStatus');
    
    if (startRecordingBtn && stopRecordingBtn && recordingStatus) {
        startRecordingBtn.addEventListener('click', function() {
            
            recordingStatus.innerHTML = '<span class="recording-indicator"></span> Recording in progress...';
            recordingStatus.classList.remove('text-gray-500');
            recordingStatus.classList.add('text-red-500', 'font-medium');
        });
        
        stopRecordingBtn.addEventListener('click', function() {
            
            recordingStatus.innerHTML = 'Recording stopped';
            recordingStatus.classList.remove('text-red-500', 'font-medium');
            recordingStatus.classList.add('text-gray-500');
            
            
            setTimeout(() => {
                recordingStatus.innerHTML = 'Processing audio...';
            }, 2000);
        });
    }
}


function animateElementsOnLoad() {
    
    document.querySelectorAll('.card').forEach((card, index) => {
        setTimeout(() => {
            card.classList.add('fade-in');
            card.style.opacity = '1';
        }, 100 * index);
    });
}

function animateElement(element, animationClass, duration = 500) {
    if (!element) return;
    
    element.classList.add(animationClass);
    setTimeout(() => {
        element.classList.remove(animationClass);
    }, duration);
}

function showElement(element, animationClass = 'fade-in') {
    if (!element) return;
    
    element.classList.remove('d-none');
    element.classList.add(animationClass);
}

function hideElement(element, callback = null) {
    if (!element) return;
    
    
    element.classList.add('d-none');
    
    
    if (callback && typeof callback === 'function') {
        callback();
    }
}


const MODELS = {
    DIAGNOSIS: 'gpt-5',                     
    FOLLOW_UP: 'gpt-5-mini',                
    SUMMARY: 'gpt-5-mini',                  
    REPORT: 'gpt-4o-mini',                  
    TRANSCRIPTION: 'gpt-4o-transcribe',     
    AUDIO_TRANSCRIPTION: 'whisper-1'        
};

let conversationHistory = [];
let aiQuestions = [];
let initialDiagnosisSummary = null;
const MAX_HISTORY_TURNS = 5; 


let isRecording = false;
let recordingStream = null;
let recordingMediaRecorder = null;
let recordingChunks = [];


async function testMicrophone() {
    console.log('Testing microphone...');
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('Microphone test successful');
        stream.getTracks().forEach(track => track.stop());
        return true;
    } catch (error) {
        console.error('Microphone test failed:', error);
        return false;
    }
}


async function startSimpleRecording() {
    console.log('Starting recording...');
    
    if (isRecording) return;
    
    const startBtn = document.getElementById('startRecording');
    const stopBtn = document.getElementById('stopRecording');
    const status = document.getElementById('recordingStatus');
    
    try {
        
        if (startBtn) startBtn.classList.add('d-none');
        if (stopBtn) stopBtn.classList.remove('d-none');
        if (status) {
            status.innerHTML = 'Getting microphone...';
            status.className = 'text-blue-600 text-sm mt-2';
        }
        
        
        recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        
        recordingMediaRecorder = new MediaRecorder(recordingStream);
        recordingChunks = [];
        
        recordingMediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordingChunks.push(event.data);
            }
        };
        
        recordingMediaRecorder.onstop = async () => {
            console.log('Recording stopped');
            
            try {
                const audioBlob = new Blob(recordingChunks, { type: 'audio/webm' });
                console.log('Audio blob size:', audioBlob.size);
                
                if (audioBlob.size < 1000) {
                    throw new Error('Recording too short');
                }
                
                await transcribeSimple(audioBlob);
                
            } catch (error) {
                console.error('Processing error:', error);
                if (status) {
                    status.innerHTML = `Error: ${error.message}`;
                    status.className = 'text-red-600 text-sm mt-2';
                }
            } finally {
                
                if (startBtn) startBtn.classList.remove('d-none');
                if (stopBtn) stopBtn.classList.add('d-none');
                isRecording = false;
                
                if (recordingStream) {
                    recordingStream.getTracks().forEach(track => track.stop());
                }
            }
        };
        
        
        recordingMediaRecorder.start(1000);
        isRecording = true;
        
        if (status) {
            status.innerHTML = 'Recording... Speak now!';
            status.className = 'text-red-600 text-sm mt-2';
        }
        
    } catch (error) {
        console.error('Recording error:', error);
        
        if (status) {
            let message = 'Failed: ';
            if (error.name === 'NotAllowedError') {
                message = 'Microphone blocked. Allow access and try again.';
            } else {
                message += error.message;
            }
            status.innerHTML = message;
            status.className = 'text-red-600 text-sm mt-2';
        }
        
        if (startBtn) startBtn.classList.remove('d-none');
        if (stopBtn) stopBtn.classList.add('d-none');
    }
}


function stopSimpleRecording() {
    if (isRecording && recordingMediaRecorder) {
        recordingMediaRecorder.stop();
    }
}


async function transcribeSimple(audioBlob) {
    const status = document.getElementById('recordingStatus');
    
    try {
        if (status) {
            status.innerHTML = 'Transcribing...';
            status.className = 'text-blue-600 text-sm mt-2';
        }
        
        const formData = new FormData();
        formData.append('file', audioBlob, 'recording.webm');
        formData.append('model', 'whisper-1');
        formData.append('language', 'en');
        
        const response = await fetch(TRANSCRIPTION_API_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${API_KEY}` },
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (!result.text) {
            throw new Error('No text received');
        }
        
        const textArea = document.getElementById('transcribedText');
        if (textArea) {
            textArea.value = result.text;
        }
        
        if (status) {
            status.innerHTML = 'Complete!';
            status.className = 'text-green-600 text-sm mt-2';
        }
        
        console.log('Transcription successful:', result.text);
        
    } catch (error) {
        console.error('Transcription error:', error);
        if (status) {
            status.innerHTML = `Transcription failed: ${error.message}`;
            status.className = 'text-red-600 text-sm mt-2';
        }
    }
}


async function condenseDiagnosis(initialPrompt, initialResponse) {
    try {
        const condensationPrompt = `Condense this medical diagnosis into key points:

Original patient information:
${initialPrompt}

Detailed diagnosis:
${initialResponse}

Include:
1. Most likely conditions (max 3)
2. Key symptoms identified
3. Recommended next steps
4. Any critical warnings

Format with clear headings and bullet points. Keep under 200 words.`;

        
        return await callGPT4(
            condensationPrompt, 
            'SUMMARY', 
            'Condense medical information with clear headings. Use double line breaks before headings, keep bullet points together.', 
            350
        );
    } catch (error) {
        console.error('Error condensing diagnosis:', error);
        return 'Failed to condense diagnosis. Please see the detailed response.';
    }
}


function updateConversationHistory(userMessage, aiResponse, isInitialDiagnosis = false) {
    
    if (isInitialDiagnosis) {
        
        conversationHistory = [];
        
        
        conversationHistory.push({ role: 'user', content: userMessage });
        conversationHistory.push({ role: 'assistant', content: aiResponse });
        
        return;
    }
    
    
    conversationHistory.push({ role: 'user', content: userMessage });
    conversationHistory.push({ role: 'assistant', content: aiResponse });
    
    
    const maxMessages = MAX_HISTORY_TURNS * 2; 
    if (conversationHistory.length > maxMessages) {
        conversationHistory = conversationHistory.slice(conversationHistory.length - maxMessages);
    }
}


function setupAudioVisualization(stream) {
    
    if (!AudioContextClass) {
        console.warn('AudioContext not supported in this browser');
        return;
    }
    
    try {
        
        if (audioContext && audioContext.state !== 'closed') {
            audioContext.close().catch(console.warn);
        }
        
        
        audioContext = new AudioContextClass();
        analyser = audioContext.createAnalyser();
        
        
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        
        
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        
        console.log('Audio visualization setup complete - AudioContext state:', audioContext.state);
        
        
        if (audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                console.log('AudioContext resumed');
            }).catch(error => {
                console.error('Failed to resume AudioContext:', error);
            });
        }
        
    } catch (error) {
        console.error('Error setting up audio visualization:', error);
        
        audioContext = null;
        analyser = null;
    }
}


async function callGPT4(prompt, modelType = 'DIAGNOSIS', systemPrompt = 'You are a medical AI assistant.', maxTokens = 1000, targetElement = null) {
    try {
        
        if (!API_KEY || API_KEY === 'your-api-key-here') {
            throw new Error('API key is missing. Please set your API key in the script.js file.');
        }
        
        
        const model = MODELS[modelType] || MODELS.DIAGNOSIS;
        
        
        let dynamicTokens = maxTokens;
        
        
        if (modelType === 'DIAGNOSIS') {
            const inputLength = prompt.length;
            const complexityFactor = prompt.includes('preexisting') || prompt.includes('additional') ? 1.2 : 1;
            dynamicTokens = Math.min(3000, Math.max(maxTokens, Math.floor(inputLength / 3 * complexityFactor)));
        }
        
        else if (modelType === 'SUMMARY') {
            dynamicTokens = Math.min(maxTokens, 400);
        }
        
        else if (modelType === 'FOLLOW_UP') {
            dynamicTokens = Math.min(maxTokens, 600);
        }
        
        
        const messages = [
            { role: 'system', content: systemPrompt },
        ];
        
        
        if (modelType === 'FOLLOW_UP' && conversationHistory.length > 0) {
            
            if (initialDiagnosisSummary) {
                messages.push({ 
                    role: 'system', 
                    content: `Previous diagnosis summary: ${initialDiagnosisSummary}` 
                });
            }
            
            
            messages.push(...conversationHistory);
        }
        
        
        messages.push({ role: 'user', content: prompt });
        
        
        if (targetElement && model !== MODELS.TRANSCRIPTION) {
            console.log(`Using streaming for ${modelType} model with ${dynamicTokens} tokens`);
            return streamResponse(model, messages, dynamicTokens, targetElement, modelType);
        }
        
        console.log(`Using regular API call for ${modelType} model with ${dynamicTokens} tokens`);
        
        
        let temperature = 0.7;
        if (modelType === 'SUMMARY') {
            temperature = 0.5; 
        } else if (modelType === 'FOLLOW_UP') {
            temperature = 0.6; 
        }
        
        
        const primaryApiCall = async () => {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                temperature: temperature,
                max_tokens: dynamicTokens
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorData.error?.message || 'Unknown error'}`);
        }
        
        const data = await response.json();
        return data.choices[0].message.content;
        };
        
        
        const createFallbackCall = (fallbackModel, fallbackLevel) => {
            return async () => {
                console.log(`Attempting fallback with ${fallbackModel} model (level ${fallbackLevel})`);
                
                
                let fallbackTokens = dynamicTokens;
                if (fallbackModel === 'gpt-3.5-turbo') {
                    fallbackTokens = Math.min(dynamicTokens, 2000); 
                }
                
                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${API_KEY}`
                    },
                    body: JSON.stringify({
                        model: fallbackModel,
                        messages: messages,
                        temperature: temperature,
                        max_tokens: fallbackTokens
                    })
                });
                
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(`Fallback API request failed: ${response.status} ${response.statusText} - ${errorData.error?.message || 'Unknown error'}`);
                }
                
                const data = await response.json();
                return data.choices[0].message.content;
            };
        };
        
        
        return await makeApiRequestWithMultiFallback(primaryApiCall, createFallbackCall, targetElement);
    } catch (error) {
        console.error('Error calling GPT-4:', error);
        throw error;
    }
}


async function streamResponse(model, messages, maxTokens, targetElement, modelType) {
    try {
        console.log(`Starting streaming for ${modelType} model to element:`, targetElement?.id);
        
        
        let streamedContent = '';
        
        
        let temperature = 0.7;
        if (modelType === 'SUMMARY') {
            temperature = 0.5; 
        } else if (modelType === 'FOLLOW_UP') {
            temperature = 0.6; 
        }
        
        
        if (targetElement) {
            
            targetElement.innerHTML = '';
            
            
            targetElement.classList.remove('d-none');
            targetElement.style.display = 'block';
            targetElement.style.opacity = '1';
            targetElement.style.visibility = 'visible';
            
            
            const originalTransition = targetElement.style.transition;
            targetElement.style.transition = 'none';
            
            
            void targetElement.offsetWidth;
        }
        
        
        const streamingApiCall = async () => {
        
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                temperature: temperature,
                max_tokens: maxTokens,
                stream: true 
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorData.error?.message || 'Unknown error'}`);
        }
        
        console.log(`Stream connection established for ${modelType}`);
        
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        
        
        let chunkCounter = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                console.log(`Stream completed for ${modelType} after ${chunkCounter} chunks`);
                break;
            }
            
            
            const chunk = decoder.decode(value);
            chunkCounter++;
            
            
            const lines = chunk.split('\n').filter(line => line.trim() !== '');
            console.log(`Processing chunk ${chunkCounter} with ${lines.length} lines for ${modelType}`);
            
            for (const line of lines) {
                
                if (line.includes('[DONE]')) continue;
                
                
                const jsonString = line.replace(/^data: /, '').trim();
                
                if (!jsonString) continue;
                
                try {
                    
                    const json = JSON.parse(jsonString);
                    
                    
                    const contentDelta = json.choices[0]?.delta?.content || '';
                    
                    
                    streamedContent += contentDelta;
                    
                    
                    if (targetElement && contentDelta) {
                        
                        targetElement.innerHTML = convertMarkdownToHTML(streamedContent);
                        
                        
                        targetElement.style.display = 'block';
                        targetElement.style.opacity = '1';
                        targetElement.style.visibility = 'visible';
                        
                        
                        targetElement.scrollTop = targetElement.scrollHeight;
                        
                        
                        if (chunkCounter % 10 === 0) {
                            console.log(`Updated ${targetElement.id} with content length: ${streamedContent.length}`);
                        }
                    }
                } catch (e) {
                    
                    console.warn('Invalid JSON in stream:', jsonString, e);
                }
            }
        }
        
            return streamedContent;
        };
        
        
        const createFallbackCall = (fallbackModel, fallbackLevel) => {
            return async () => {
                console.log(`Streaming failed. Falling back to ${fallbackModel} model (level ${fallbackLevel})`);
                
                
                let fallbackTokens = maxTokens;
                if (fallbackModel === 'gpt-3.5-turbo') {
                    fallbackTokens = Math.min(maxTokens, 2000); 
                }
                
                
                if (fallbackLevel === 0) { 
                    try {
                        const response = await fetch(API_URL, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${API_KEY}`
                            },
                            body: JSON.stringify({
                                model: fallbackModel,
                                messages: messages,
                                temperature: temperature,
                                max_tokens: fallbackTokens,
                                stream: true
                            })
                        });
                        
                        if (!response.ok) {
                            throw new Error(`Fallback streaming failed: ${response.status}`);
                        }
                        
                        console.log(`Fallback stream connection established with ${fallbackModel}`);
                        
                        
                        const reader = response.body.getReader();
                        const decoder = new TextDecoder('utf-8');
                        
                        
                        let fallbackContent = '';
                        let chunkCounter = 0;
                        
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) {
                                console.log(`Fallback stream completed after ${chunkCounter} chunks`);
                                break;
                            }
                            
                            
                            const chunk = decoder.decode(value);
                            chunkCounter++;
                            
                            
                            const lines = chunk.split('\n').filter(line => line.trim() !== '');
                            
                            for (const line of lines) {
                                
                                if (line.includes('[DONE]')) continue;
                                
                                
                                const jsonString = line.replace(/^data: /, '').trim();
                                
                                if (!jsonString) continue;
                                
                                try {
                                    
                                    const json = JSON.parse(jsonString);
                                    
                                    
                                    const contentDelta = json.choices[0]?.delta?.content || '';
                                    
                                    
                                    fallbackContent += contentDelta;
                                    
                                    
                                    if (targetElement && contentDelta) {
                                        
                                        targetElement.innerHTML = convertMarkdownToHTML(fallbackContent);
                                        
                                        
                                        targetElement.style.display = 'block';
                                        targetElement.style.opacity = '1';
                                        targetElement.style.visibility = 'visible';
                                        
                                        
                                        targetElement.scrollTop = targetElement.scrollHeight;
                                    }
                                } catch (e) {
                                    
                                    console.warn('Invalid JSON in fallback stream:', jsonString, e);
                                }
                            }
                        }
                        
                        return fallbackContent;
                    } catch (streamError) {
                        console.error(`Fallback streaming with ${fallbackModel} failed:`, streamError);
                        
                    }
                }
                
                
                console.log(`Using non-streaming fallback with ${fallbackModel}`);
                
                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${API_KEY}`
                    },
                    body: JSON.stringify({
                        model: fallbackModel,
                        messages: messages,
                        temperature: temperature,
                        max_tokens: fallbackTokens
                    })
                });
                
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(`Fallback API request failed: ${response.status} ${response.statusText} - ${errorData.error?.message || 'Unknown error'}`);
                }
                
                const data = await response.json();
                const content = data.choices[0].message.content;
                
                
                if (targetElement) {
                    targetElement.innerHTML = convertMarkdownToHTML(content);
                }
                
                return content;
            };
        };
        
        
        const result = await makeApiRequestWithMultiFallback(streamingApiCall, createFallbackCall, targetElement);
        
        console.log(`Streaming complete for ${modelType}, final content length: ${result.length}`);
        
        
        if (targetElement) {
            targetElement.style.display = 'block';
            targetElement.style.opacity = '1';
            targetElement.style.visibility = 'visible';
            
            
            setTimeout(() => {
                targetElement.style.transition = originalTransition || '';
            }, 100);
        }
        
        
        return result;
    } catch (error) {
        console.error('Error streaming response:', error);
        
        
        if (targetElement) {
            targetElement.innerHTML = `<div class="alert alert-danger">Error: ${error.message}</div>`;
            targetElement.style.display = 'block';
            targetElement.style.opacity = '1';
            targetElement.style.visibility = 'visible';
        }
        
        throw error;
    }
}


function createDownloadLink(blob, filename) {
    if (window.navigator && window.navigator.msSaveOrOpenBlob) {
        
        window.navigator.msSaveOrOpenBlob(blob, filename);
    } else {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 0);
    }
}


function parseAIResponse(response) {
    
    const result = {
        diagnosis: '',
        followUpQuestions: [],
        urgencyLevel: '' 
    };
    
    try {
        
        if (!response || response.trim() === '') {
            return result;
        }
        
        
        const urgencyMatch = response.match(/\*\*Urgency Level:\*\*\s*\[?(Low|Moderate|High)\]?/i);
        if (urgencyMatch && urgencyMatch[1]) {
            result.urgencyLevel = urgencyMatch[1].toLowerCase();
        }
        
        
        const followUpQuestionsMatch = response.match(/(?:# Follow-up Questions|# Additional Questions|Follow-up Questions:|Additional Questions:|(?:\*\*Follow-up Questions\*\*)|(?:\*\*Follow-up Questions:\*\*))([\s\S]*?)(?=(?:# |$))/i);
        
        if (followUpQuestionsMatch && followUpQuestionsMatch[1]) {
            
            const questionsText = followUpQuestionsMatch[1].trim();
            const questionMatches = questionsText.match(/(?:^|\n)(?:\d+\.|\*|\-)\s*(.+?)(?=(?:\n(?:\d+\.|\*|\-)|$))/g);
            
            if (questionMatches) {
                result.followUpQuestions = questionMatches.map(q => {
                    
                    return q.replace(/(?:^|\n)(?:\d+\.|\*|\-)\s*/, '').trim();
                });
            } else {
                
                result.followUpQuestions = questionsText.split(/\n+/).filter(q => q.trim().length > 0);
            }
            
            
            response = response.replace(followUpQuestionsMatch[0], '');
        }
        
        
        result.diagnosis = response.trim();
        
        return result;
    } catch (error) {
        console.error('Error parsing AI response:', error);
        return {
            diagnosis: response, 
            followUpQuestions: [],
            urgencyLevel: ''
        };
    }
}


function displayAIQuestions(questions) {
    if (!questions || questions.length === 0) {
        return;
    }
    
    
    const aiQuestionsContainer = document.getElementById('aiQuestions');
    aiQuestionsContainer.innerHTML = '';
    
    questions.forEach((question, index) => {
        const questionBtn = document.createElement('button');
        questionBtn.className = 'btn btn-sm btn-outline-secondary mb-2 me-2 rounded-pill opacity-0';
        questionBtn.textContent = question;
        questionBtn.style.transition = 'all 0.3s ease';
        
        questionBtn.addEventListener('click', function() {
            document.getElementById('followUpQuestion').value = question;
            animateElement(questionBtn, 'pulse-animation');
        });
        
        aiQuestionsContainer.appendChild(questionBtn);
        
        
        setTimeout(() => {
            questionBtn.classList.add('fade-in');
            questionBtn.style.opacity = '1';
        }, 100 * index);
    });
    
    
    const followUpQuestionsDialog = document.getElementById('followUpQuestionsDialog');
    const followUpQuestionsContainer = document.getElementById('followUpQuestionsContainer');
    
    
    followUpQuestionsContainer.innerHTML = '';
    
    
    questions.forEach((question, index) => {
        const questionId = `question-${index}`;
        const questionDiv = document.createElement('div');
        questionDiv.className = 'follow-up-question';
        
        const questionLabel = document.createElement('label');
        questionLabel.htmlFor = questionId;
        questionLabel.textContent = question;
        
        const answerInput = document.createElement('textarea');
        answerInput.className = 'form-control';
        answerInput.id = questionId;
        answerInput.name = questionId;
        answerInput.placeholder = 'Your answer...';
        answerInput.rows = 2;
        
        questionDiv.appendChild(questionLabel);
        questionDiv.appendChild(answerInput);
        followUpQuestionsContainer.appendChild(questionDiv);
    });
    
    
    followUpQuestionsDialog.classList.remove('d-none');
    
    
    const followUpQuestionsForm = document.getElementById('followUpQuestionsForm');
    
    
    const newForm = followUpQuestionsForm.cloneNode(true);
    followUpQuestionsForm.parentNode.replaceChild(newForm, followUpQuestionsForm);
    
    
    newForm.addEventListener('submit', handleFollowUpQuestionsSubmit);
}


async function handleFollowUpQuestionsSubmit(e) {
    e.preventDefault();
    
    
    const form = e.target;
    const submitButton = form.querySelector('button[type="submit"]');
    
    
    submitButton.disabled = true;
    submitButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Processing...';
    
    
    const answers = [];
    const questionElements = form.querySelectorAll('.follow-up-question');
    
    questionElements.forEach((questionElement, index) => {
        const question = questionElement.querySelector('label').textContent;
        const answer = questionElement.querySelector('textarea').value.trim();
        
        if (answer) {
            answers.push({ question, answer });
        }
    });
    
    if (answers.length === 0) {
        alert('Please answer at least one question.');
        submitButton.disabled = false;
        submitButton.innerHTML = '<i class="fas fa-paper-plane mr-2"></i> Submit Answers';
        return;
    }
    
    
    const answersText = answers.map(a => `Q: ${a.question}\nA: ${a.answer}`).join('\n\n');
    
    
    const updatePrompt = `
Based on the initial diagnosis and the patient's answers to follow-up questions, please provide an updated assessment:

Initial Diagnosis Summary:
${initialDiagnosisSummary || "No initial diagnosis summary available."}

Patient's Answers to Follow-up Questions:
${answersText}

Please provide an updated assessment with any new insights or changes to the initial diagnosis. Focus on how these answers affect your diagnostic impression.`;

    try {
        
        const updatedDiagnosis = document.getElementById('updatedDiagnosis');
        const updatedDiagnosisContent = document.getElementById('updatedDiagnosisContent');
        
        
        updatedDiagnosisContent.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
        
        
        updatedDiagnosis.classList.remove('d-none');
        updatedDiagnosisContent.classList.remove('d-none');
        updatedDiagnosisContent.style.display = 'block';
        updatedDiagnosisContent.style.opacity = '1';
        updatedDiagnosisContent.style.visibility = 'visible';
        
        
        updatedDiagnosisContent.style.transition = 'none';
        
        
        void updatedDiagnosisContent.offsetWidth;
        
        
        updatedDiagnosis.scrollIntoView({ behavior: 'smooth' });
        
        
        const systemPrompt = `Medical AI assistant for follow-up assessment. Format with:
1. **Updated Assessment:** (focus on new information)
2. **Recommended Tests:** (if applicable)
3. **Urgency Level:** [Low/Moderate/High]

Use double line breaks between sections. Be concise.`;
        
        const updatedAssessment = await callGPT4(
            updatePrompt,
            'DIAGNOSIS',
            systemPrompt,
            1000,
            updatedDiagnosisContent
        );
        
        
        const { urgencyLevel } = parseAIResponse(updatedAssessment);
        
        
        if (urgencyLevel) {
            
            const existingWarning = document.querySelector('.urgency-warning');
            if (existingWarning) {
                
                existingWarning.classList.remove('low', 'moderate', 'high');
                
                
                existingWarning.classList.add(urgencyLevel);
                
                
                let icon = 'info-circle';
                let text = 'Low urgency';
                
                if (urgencyLevel === 'moderate') {
                    icon = 'exclamation-circle';
                    text = 'Moderate urgency';
                } else if (urgencyLevel === 'high') {
                    icon = 'exclamation-triangle';
                    text = 'HIGH URGENCY - Seek medical attention promptly';
                }
                
                existingWarning.innerHTML = `<i class="fas fa-${icon}"></i> ${text} (Updated)`;
                
                
                existingWarning.classList.add('pulse-animation');
                setTimeout(() => {
                    existingWarning.classList.remove('pulse-animation');
                }, 2000);
            }
        }
        
        
        updateConversationHistory(updatePrompt, updatedAssessment);
        
    } catch (error) {
        console.error('Error getting updated diagnosis:', error);
        alert('Error: ' + error.message);
    } finally {
        
        submitButton.disabled = false;
        submitButton.innerHTML = '<i class="fas fa-paper-plane mr-2"></i> Submit Answers';
    }
}


document.getElementById('diagnosisForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const loadingElement = document.getElementById('loading');
    const resultsElement = document.getElementById('results');
    const errorElement = document.getElementById('error');
    const followUpQuestionsDialog = document.getElementById('followUpQuestionsDialog');
    const updatedDiagnosis = document.getElementById('updatedDiagnosis');
    
    
    hideElement(resultsElement);
    hideElement(errorElement);
    
    
    followUpQuestionsDialog.classList.add('d-none');
    if (updatedDiagnosis) {
        updatedDiagnosis.classList.add('d-none');
    }
    
    
    showElement(loadingElement);
    
    try {
        
        const age = document.getElementById('age').value;
        const gender = document.getElementById('gender').value;
        const weight = document.getElementById('weight').value;
        const height = document.getElementById('height').value;
        const symptoms = document.getElementById('symptoms').value;
        const duration = document.getElementById('duration').value;
        const intensity = document.getElementById('intensity').value;
        const bp = document.getElementById('bp').value;
        const glucose = document.getElementById('glucose').value;
        const temperature = document.getElementById('temperature').value;
        const preexisting = document.getElementById('preexisting').value;
        const additional = document.getElementById('additional').value;
        
        
        if (!age || !gender || !weight || !height || !symptoms || !duration || !intensity) {
            throw new Error('Please fill in all required fields.');
        }
        
        
        const prompt = `Patient info for diagnosis:
Age: ${age}
Gender: ${gender}
Weight: ${weight} kg
Height: ${height} cm
Symptoms: ${symptoms}
Duration: ${duration}
Intensity: ${intensity}
${bp ? `Blood Pressure: ${bp}` : ''}
${glucose ? `Blood Glucose: ${glucose}` : ''}
${temperature ? `Temperature: ${temperature}°C` : ''}
${preexisting ? `Preexisting Conditions: ${preexisting}` : ''}
${additional ? `Additional Information: ${additional}` : ''}

Format response with:
**Likely Conditions:** (top 3)
**Brief Explanation:**
**Recommended Tests:**
**Urgency Level:** [Low/Moderate/High]
**Warning Signs:**
**Follow-up Questions:** (3-5)`;

        
        const diagnosisContent = document.getElementById('diagnosisContent');
        
        
        diagnosisContent.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
        
        
        diagnosisContent.classList.remove('d-none');
        diagnosisContent.style.display = 'block';
        diagnosisContent.style.opacity = '1';
        diagnosisContent.style.visibility = 'visible';
        
        
        diagnosisContent.style.transition = 'none';
        
        
        void diagnosisContent.offsetWidth;
        
        
        loadingElement.classList.add('d-none');
        
        
        resultsElement.classList.remove('d-none');
        resultsElement.style.display = 'block';
        resultsElement.style.opacity = '1';
        resultsElement.style.visibility = 'visible';
        
        
        diagnosisContent.scrollIntoView({ behavior: 'smooth' });
        
        const response = await callGPT4(
            prompt,
            'DIAGNOSIS',
            'Medical AI assistant. Format diagnosis with:\n1. **Likely Conditions:** (top 3)\n2. **Brief Explanation:** (key symptoms)\n3. **Recommended Tests:**\n4. **Urgency Level:** [Low/Moderate/High]\n5. **Warning Signs:**\n6. **Follow-up Questions:** (3-5)\n\nUse double line breaks between sections. Be concise.',
            1000,
            diagnosisContent
        );
        
        
        const { diagnosis, followUpQuestions, urgencyLevel } = parseAIResponse(response);
        
        
        initialDiagnosisSummary = await condenseDiagnosis(prompt, diagnosis);
        
        
        updateConversationHistory(prompt, response, true);
        
        
        aiQuestions = followUpQuestions;
        
        
        const viewSummaryBtn = document.getElementById('viewSummaryBtn');
        if (viewSummaryBtn) {
            
            const newViewSummaryBtn = viewSummaryBtn.cloneNode(true);
            
            
            newViewSummaryBtn.className = ''; 
            newViewSummaryBtn.innerHTML = '<i class="fas fa-eye"></i> View Diagnosis Summary';
            
            
            newViewSummaryBtn.addEventListener('click', function() {
                const summaryContainer = document.getElementById('diagnosisSummaryContainer');
                const summaryContent = document.getElementById('diagnosisSummaryContent');
                
                if (summaryContainer && summaryContent) {
                    
                    if (summaryContainer.classList.contains('d-none')) {
                        
                        summaryContainer.classList.remove('d-none');
                        summaryContent.innerHTML = convertMarkdownToHTML(initialDiagnosisSummary, true);
                        
                        
                        this.innerHTML = '<i class="fas fa-eye-slash"></i> Hide Summary';
                        
                        
                        setTimeout(() => {
                            
                            window.location.hash = 'diagnosisSummaryContainer';
                            
                            
                            summaryContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }, 100); 
                    } else {
                        
                        summaryContainer.classList.add('d-none');
                        
                        
                        this.innerHTML = '<i class="fas fa-eye"></i> View Diagnosis Summary';
                    }
                }
            });
            
            
            const topControlsContainer = document.createElement('div');
            topControlsContainer.className = 'diagnosis-top-controls';
            topControlsContainer.style.marginBottom = '1rem';
            
            
            topControlsContainer.appendChild(newViewSummaryBtn);
            
            
            if (urgencyLevel) {
                const urgencyWarning = document.createElement('div');
                urgencyWarning.className = `urgency-warning ${urgencyLevel}`;
                
                let icon = 'info-circle';
                let text = 'Low urgency';
                
                if (urgencyLevel === 'moderate') {
                    icon = 'exclamation-circle';
                    text = 'Moderate urgency';
                } else if (urgencyLevel === 'high') {
                    icon = 'exclamation-triangle';
                    text = 'HIGH URGENCY - Seek medical attention promptly';
                }
                
                urgencyWarning.innerHTML = `<i class="fas fa-${icon}"></i> ${text}`;
                topControlsContainer.appendChild(urgencyWarning);
            }
            
            
            resultsElement.insertBefore(topControlsContainer, resultsElement.firstChild);
            
            
            if (viewSummaryBtn.parentNode) {
                viewSummaryBtn.parentNode.removeChild(viewSummaryBtn);
            }
        }
        
        
        displayAIQuestions(followUpQuestions);
    } catch (error) {
        console.error('Error getting diagnosis:', error);
        errorElement.textContent = error.message;
        errorElement.classList.remove('d-none');
        hideElement(loadingElement);
    }
});


document.getElementById('askFollowUp').addEventListener('click', async function() {
    const followUpQuestion = document.getElementById('followUpQuestion');
    const followUpResponse = document.getElementById('followUpResponse');
    
    
    if (!followUpQuestion.value.trim()) {
        alert('Please enter a question.');
        return;
    }
    
    
    const originalButtonText = this.innerHTML;
    this.disabled = true;
    this.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Processing...';
    
    try {
        
        const prompt = followUpQuestion.value.trim();
        
        
        const followUpResponse = document.getElementById('followUpResponse');
        followUpResponse.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
        
        
        followUpResponse.classList.remove('d-none');
        followUpResponse.style.display = 'block';
        followUpResponse.style.opacity = '1';
        followUpResponse.style.visibility = 'visible';
        
        
        followUpResponse.style.transition = 'none';
        
        
        void followUpResponse.offsetWidth;
        
        
        followUpResponse.scrollIntoView({ behavior: 'smooth' });
        
        
        const response = await callGPT4(
            prompt,
            'FOLLOW_UP',
            'You are a medical AI assistant answering follow-up questions about a diagnosis. Be concise but thorough. Provide specific, actionable information.',
            1000,
            followUpResponse
        );
        
        
        updateConversationHistory(prompt, response);
        
        
        followUpQuestion.value = '';
        
    } catch (error) {
        console.error('Error getting follow-up response:', error);
        alert('Error: ' + error.message);
    } finally {
        
        this.disabled = false;
        this.innerHTML = originalButtonText;
    }
});


async function startRecording() {
    try {
        console.log('Starting audio recording...');
        
        
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
        
        
        audioChunks = [];
        audioBlob = null;
        
        
        const startButton = document.getElementById('startRecording');
        const stopButton = document.getElementById('stopRecording');
        const visualizationContainer = document.getElementById('audioVisualizationContainer');
        const recordingStatus = document.getElementById('recordingStatus');
        
        if (startButton) startButton.classList.add('d-none');
        if (stopButton) stopButton.classList.remove('d-none');
        if (visualizationContainer) visualizationContainer.classList.remove('d-none');
        
        if (recordingStatus) {
            recordingStatus.innerHTML = '<span class="recording-indicator"></span> Setting up recording...';
            recordingStatus.className = 'text-blue-600 text-sm mt-2 font-medium';
        }
        
        
        if (!mediaRecorder || !mediaRecorder.stream || mediaRecorder.stream.getTracks().every(track => !track.enabled)) {
            const success = await setupMediaRecorder();
            if (!success) {
                throw new Error('Failed to setup media recorder');
            }
        }
        
        
        if (analyser && audioContext) {
            stopVisualizationFn = visualize();
            console.log('Audio visualization started');
        }
        
        
        if (mediaRecorder && mediaRecorder.state === 'inactive') {
            mediaRecorder.start(1000); 
            console.log('MediaRecorder started');
            
            if (recordingStatus) {
                recordingStatus.innerHTML = '<span class="recording-indicator"></span> Recording... Speak now!';
                recordingStatus.className = 'text-red-600 text-sm mt-2 font-medium';
            }
        } else {
            throw new Error('MediaRecorder not ready or already recording');
        }
        
    } catch (error) {
        console.error('Error starting recording:', error);
        
        
        const recordingStatus = document.getElementById('recordingStatus');
        if (recordingStatus) {
            recordingStatus.innerHTML = `<i class="fas fa-exclamation-circle mr-2"></i> Error: ${error.message}`;
            recordingStatus.className = 'text-red-600 text-sm mt-2';
        }
        
        
        const startButton = document.getElementById('startRecording');
        const stopButton = document.getElementById('stopRecording');
        const visualizationContainer = document.getElementById('audioVisualizationContainer');
        
        if (startButton) startButton.classList.remove('d-none');
        if (stopButton) stopButton.classList.add('d-none');
        if (visualizationContainer) visualizationContainer.classList.add('d-none');
        
        
        alert(`Recording failed: ${error.message}`);
    }
}


function stopRecording() {
    try {
        console.log('Stopping audio recording...');
        
        
        const startButton = document.getElementById('startRecording');
        const stopButton = document.getElementById('stopRecording');
        const visualizationContainer = document.getElementById('audioVisualizationContainer');
        const recordingStatus = document.getElementById('recordingStatus');
        
        if (stopButton) stopButton.classList.add('d-none');
        if (visualizationContainer) visualizationContainer.classList.add('d-none');
        
        if (recordingStatus) {
            recordingStatus.innerHTML = '<i class="fas fa-stop-circle mr-2"></i> Stopping recording...';
            recordingStatus.className = 'text-gray-600 text-sm mt-2';
        }
        
        
        if (stopVisualizationFn) {
            stopVisualizationFn();
            stopVisualizationFn = null;
        }
        
        
        if (mediaRecorder) {
            if (mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
                console.log('MediaRecorder stopped');
            } else if (mediaRecorder.state === 'paused') {
                mediaRecorder.resume();
                mediaRecorder.stop();
                console.log('MediaRecorder resumed and stopped');
            } else {
                console.warn('MediaRecorder is not in recording state:', mediaRecorder.state);
                
                if (startButton) startButton.classList.remove('d-none');
                if (recordingStatus) {
                    recordingStatus.innerHTML = 'Ready to record';
                    recordingStatus.className = 'text-gray-500 text-sm mt-2';
                }
            }
            
            
            if (mediaRecorder.stream) {
                mediaRecorder.stream.getTracks().forEach(track => {
                    track.stop();
                    console.log('Audio track stopped');
                });
            }
        } else {
            console.warn('No mediaRecorder to stop');
            
            if (startButton) startButton.classList.remove('d-none');
            if (recordingStatus) {
                recordingStatus.innerHTML = 'Ready to record';
                recordingStatus.className = 'text-gray-500 text-sm mt-2';
            }
        }
        
    } catch (error) {
        console.error('Error stopping recording:', error);
        
        
        const recordingStatus = document.getElementById('recordingStatus');
        if (recordingStatus) {
            recordingStatus.innerHTML = `<i class="fas fa-exclamation-circle mr-2"></i> Stop error: ${error.message}`;
            recordingStatus.className = 'text-red-600 text-sm mt-2';
        }
        
        
        const startButton = document.getElementById('startRecording');
        const stopButton = document.getElementById('stopRecording');
        const visualizationContainer = document.getElementById('audioVisualizationContainer');
        
        if (startButton) startButton.classList.remove('d-none');
        if (stopButton) stopButton.classList.add('d-none');
        if (visualizationContainer) visualizationContainer.classList.add('d-none');
    }
}


document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, setting up simple recording...');
    
    const startBtn = document.getElementById('startRecording');
    const stopBtn = document.getElementById('stopRecording');
    
    if (startBtn) {
        startBtn.addEventListener('click', async () => {
            console.log('Start button clicked');
            await startSimpleRecording();
        });
    }
    
    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            console.log('Stop button clicked');
            stopSimpleRecording();
        });
    }
    
    
    testMicrophone().then(success => {
        const status = document.getElementById('recordingStatus');
        if (status) {
            if (success) {
                status.innerHTML = 'Microphone ready';
                status.className = 'text-green-600 text-sm mt-2';
            } else {
                status.innerHTML = 'Microphone not accessible';
                status.className = 'text-red-600 text-sm mt-2';
            }
        }
    });
});


async function setupMediaRecorder() {
    try {
        
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Your browser does not support audio recording. Please use a modern browser like Chrome, Firefox, or Safari.');
        }
        
        
        const constraints = {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 44100,
                channelCount: 1
            }
        };
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        
        if (stream) {
            setupAudioVisualization(stream);
            console.log('Audio visualization setup completed');
        }
        
        
        let mediaRecorderOptions;
        const supportedFormats = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/mp4',
            'audio/wav',
            'audio/ogg;codecs=opus'
        ];
        
        for (const format of supportedFormats) {
            if (MediaRecorder.isTypeSupported(format)) {
                mediaRecorderOptions = { mimeType: format };
                console.log(`Using audio format: ${format}`);
                break;
            }
        }
        
        
        try {
            mediaRecorder = new MediaRecorder(stream, mediaRecorderOptions || {});
            console.log('MediaRecorder created successfully');
        } catch (e) {
            console.warn('MediaRecorder with specified options not supported, using default');
            mediaRecorder = new MediaRecorder(stream);
        }
        
        
        audioChunks = [];
        
        
        mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                audioChunks.push(e.data);
                console.log(`Audio chunk received: ${e.data.size} bytes`);
            }
        };
        
        
        mediaRecorder.onstop = async () => {
            try {
                console.log(`Total audio chunks: ${audioChunks.length}`);
                
                if (audioChunks.length === 0) {
                    throw new Error('No audio data recorded. Please try again.');
                }
                
                
                const mimeType = mediaRecorder.mimeType || 'audio/webm';
                audioBlob = new Blob(audioChunks, { type: mimeType });
                
                console.log(`Created audio blob: ${audioBlob.size} bytes, type: ${audioBlob.type}`);
                
                if (audioBlob.size < 1000) { 
                    throw new Error('Audio recording too short or empty. Please record for at least 1 second.');
                }
                
                
                const recordingStatus = document.getElementById('recordingStatus');
                if (recordingStatus) {
                    recordingStatus.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Transcribing audio...';
                    recordingStatus.className = 'text-blue-600 text-sm mt-2';
                }
                
                
                const startButton = document.getElementById('startRecording');
                if (startButton) {
                    startButton.classList.remove('d-none');
                    startButton.disabled = true;
                    startButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Processing...';
                }
                
                
                const transcribedText = await transcribeAudio(audioBlob);
                
                if (transcribedText && transcribedText.trim()) {
                    console.log('Transcription successful');
                    
                    
                    if (startButton) {
                        startButton.disabled = false;
                        startButton.innerHTML = '<i class="fas fa-microphone mr-2"></i> Start Recording';
                    }
                } else {
                    throw new Error('Transcription returned empty text');
                }
                
            } catch (error) {
                console.error('Recording stop error:', error);
                const recordingStatus = document.getElementById('recordingStatus');
                if (recordingStatus) {
                    recordingStatus.innerHTML = `<i class="fas fa-exclamation-circle mr-2"></i> Error: ${error.message}`;
                    recordingStatus.className = 'text-red-600 text-sm mt-2';
                }
                
                
                const startButton = document.getElementById('startRecording');
                if (startButton) {
                    startButton.disabled = false;
                    startButton.innerHTML = '<i class="fas fa-microphone mr-2"></i> Start Recording';
                }
            }
        };
        
        
        mediaRecorder.onstart = () => {
            console.log('Recording started');
            audioChunks = []; 
        };
        
        
        mediaRecorder.onerror = (event) => {
            console.error('MediaRecorder error:', event.error);
            const recordingStatus = document.getElementById('recordingStatus');
            if (recordingStatus) {
                recordingStatus.innerHTML = `<i class="fas fa-exclamation-circle mr-2"></i> Recording error: ${event.error.message}`;
                recordingStatus.className = 'text-red-600 text-sm mt-2';
            }
        };
        
        return true;
    } catch (error) {
        console.error('Media recorder setup error:', error);
        const recordingStatus = document.getElementById('recordingStatus');
        if (recordingStatus) {
            recordingStatus.innerHTML = `<i class="fas fa-exclamation-circle mr-2"></i> Setup error: ${error.message}`;
            recordingStatus.className = 'text-red-600 text-sm mt-2';
        }
        return false;
    }
}


function visualize() {
    if (!analyser) return;
    
    const canvas = document.getElementById('visualizer');
    if (!canvas) return;
    
    const canvasCtx = canvas.getContext('2d');
    if (!canvasCtx) return;
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
    
    
    let isAudioDetected = false;
    let noAudioFrames = 0;
    const maxNoAudioFrames = 60; 
    
    
    const audioThreshold = 2; 
    
    
    let isVisualizationActive = true;
    
    function draw() {
        
        if (!isVisualizationActive || !analyser) {
            return;
        }
        
        
        audioVisualizationInterval = requestAnimFrame(draw);
        
        
        const visualizationContainer = document.getElementById('audioVisualizationContainer');
        if (visualizationContainer && visualizationContainer.classList.contains('d-none')) {
            
            cancelAnimationFrame(audioVisualizationInterval);
            audioVisualizationInterval = null;
            return;
        }
        
        
        analyser.getByteFrequencyData(dataArray);
        
        
        const audioLevel = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
        
        
        if (audioLevel > audioThreshold) {
            isAudioDetected = true;
            noAudioFrames = 0;
        } else {
            noAudioFrames++;
            
            
            
            if (noAudioFrames >= maxNoAudioFrames && isAudioDetected) {
                
                canvas.style.borderColor = '#ef4444';
            }
        }
        
        
        canvasCtx.fillStyle = 'rgb(249, 250, 251)';
        canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
        
        
        const barWidth = (canvas.width / bufferLength) * 2.5;
        let barHeight;
        let x = 0;
        
        
        for (let i = 0; i < bufferLength; i++) {
            barHeight = dataArray[i] / 2;
            
            
            const gradient = canvasCtx.createLinearGradient(0, 0, 0, canvas.height);
            
            
            if (audioLevel > audioThreshold / 2) { 
                gradient.addColorStop(0, 'rgb(79, 70, 229)');  
                gradient.addColorStop(1, 'rgb(124, 58, 237)'); 
            } else {
                gradient.addColorStop(0, 'rgb(156, 163, 175)'); 
                gradient.addColorStop(1, 'rgb(209, 213, 219)'); 
            }
            
            canvasCtx.fillStyle = gradient;
            canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
            
            x += barWidth + 1;
        }
    }
    
    
    draw();
    
    
    return function stopVisualization() {
        isVisualizationActive = false;
        if (audioVisualizationInterval) {
            cancelAnimationFrame(audioVisualizationInterval);
            audioVisualizationInterval = null;
        }
    };
}


async function transcribeAudio(audioData = null) {
    const blobToTranscribe = audioData || audioBlob;
    
    if (!blobToTranscribe || blobToTranscribe.size <= 44) {
        console.warn('No audio data to transcribe or audio too small');
        throw new Error('No valid audio data to transcribe. Please record audio first.');
    }
    
    
    const recordingStatus = document.getElementById('recordingStatus');
    if (recordingStatus) {
        recordingStatus.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Transcribing audio...';
        recordingStatus.classList.remove('text-gray-500', 'text-green-600', 'text-red-600');
        recordingStatus.classList.add('text-blue-600', 'font-medium');
    }
    
    try {
        
        const formData = new FormData();
        
        
        let fileName = 'recording.wav';
        let mimeType = blobToTranscribe.type;
        
        if (mimeType.includes('webm')) {
            fileName = 'recording.webm';
        } else if (mimeType.includes('mp4')) {
            fileName = 'recording.mp4';
        } else if (mimeType.includes('ogg')) {
            fileName = 'recording.ogg';
        }
        
        
        formData.append('file', blobToTranscribe, fileName);
        formData.append('model', MODELS.AUDIO_TRANSCRIPTION); 
        formData.append('language', 'en');
        formData.append('response_format', 'json');
        
        console.log(`Transcribing audio file: ${fileName}, size: ${blobToTranscribe.size} bytes`);
        
        
        const makeTranscriptionCall = async () => {
            const response = await fetch(TRANSCRIPTION_API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${API_KEY}`
                },
                body: formData
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                
                try {
                    const errorData = JSON.parse(errorText);
                    if (errorData.error && errorData.error.message) {
                        errorMessage = errorData.error.message;
                    }
                } catch (e) {
                    
                }
                
                throw new Error(`Transcription API error: ${errorMessage}`);
            }
            
            const data = await response.json();
            
            if (!data.text) {
                throw new Error('No transcription text returned from API');
            }
            
            return data.text.trim();
        };
        
        
        const createFallback = (fallbackLevel) => {
            return async () => {
                if (fallbackLevel === 0) {
                    
                    console.log('Trying fallback: converting to WAV format');
                    
                    try {
                        const wavBlob = await convertAudioToWav(blobToTranscribe);
                        const fallbackFormData = new FormData();
                        fallbackFormData.append('file', wavBlob, 'recording.wav');
                        fallbackFormData.append('model', MODELS.AUDIO_TRANSCRIPTION);
                        fallbackFormData.append('language', 'en');
                        fallbackFormData.append('response_format', 'json');
                        
                        const response = await fetch(TRANSCRIPTION_API_URL, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${API_KEY}`
                            },
                            body: fallbackFormData
                        });
                        
                        if (!response.ok) {
                            throw new Error(`Fallback transcription failed: ${response.status}`);
                        }
                        
                        const data = await response.json();
                        return data.text ? data.text.trim() : '';
                    } catch (error) {
                        console.warn('WAV conversion fallback failed:', error);
                        throw error;
                    }
                } else {
                    
                    throw new Error('Audio transcription failed after all attempts. Please try recording again with clearer audio.');
                }
            };
        };
        
        
        const transcribedText = await makeApiRequestWithMultiFallback(
            makeTranscriptionCall,
            createFallback,
            null
        );
        
        if (!transcribedText || transcribedText.trim() === '') {
            throw new Error('Transcription returned empty text. Please speak more clearly or try again.');
        }
        
        
        const transcribedTextElement = document.getElementById('transcribedText');
        if (transcribedTextElement) {
            transcribedTextElement.value = transcribedText;
            
            transcribedTextElement.dispatchEvent(new Event('input', { bubbles: true }));
        }
        
        
        if (recordingStatus) {
            recordingStatus.innerHTML = '<i class="fas fa-check-circle mr-2"></i> Transcription completed successfully!';
            recordingStatus.classList.remove('text-blue-600', 'text-red-600');
            recordingStatus.classList.add('text-green-600');
            
            
            setTimeout(() => {
                if (recordingStatus) {
                    recordingStatus.textContent = '';
                    recordingStatus.className = 'text-gray-500 text-sm mt-2';
                }
            }, 5000);
        }
        
        console.log('Transcription successful:', transcribedText.substring(0, 100) + '...');
        return transcribedText;
        
    } catch (error) {
        console.error('Error transcribing audio:', error);
        
        
        if (recordingStatus) {
            recordingStatus.innerHTML = `<i class="fas fa-exclamation-circle mr-2"></i> Error: ${error.message}`;
            recordingStatus.classList.remove('text-blue-600', 'text-green-600');
            recordingStatus.classList.add('text-red-600');
        }
        
        
        throw error;
    }
}


async function convertToMP3(audioBlob) {
    if (!audioBlob) {
        console.error('No audio blob provided for conversion');
        return null;
    }
    
    try {
        
        
        console.log(`Processing audio: ${audioBlob.size} bytes, type: ${audioBlob.type}`);
        return audioBlob;
    } catch (error) {
        console.error('Error converting audio format:', error);
        return null;
    }
}


async function convertAudioToWav(audioBlob) {
    if (!audioBlob) {
        throw new Error('No audio blob provided for WAV conversion');
    }
    
    try {
        
        if (audioBlob.type.includes('wav')) {
            return audioBlob;
        }
        
        
        if (window.AudioContext || window.webkitAudioContext) {
            const arrayBuffer = await audioBlob.arrayBuffer();
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            try {
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                
                
                const wavBlob = audioBufferToWav(audioBuffer);
                await audioContext.close();
                
                return wavBlob;
            } catch (error) {
                console.warn('Web Audio API conversion failed, returning original blob:', error);
                await audioContext.close();
                return audioBlob;
            }
        } else {
            
            console.warn('Web Audio API not supported, returning original blob');
            return audioBlob;
        }
    } catch (error) {
        console.error('Error converting audio to WAV:', error);
        return audioBlob; 
    }
}


function audioBufferToWav(audioBuffer) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const format = 1; 
    const bitDepth = 16;
    
    const length = audioBuffer.length * numChannels * 2;
    const buffer = new ArrayBuffer(44 + length);
    const view = new DataView(buffer);
    
    
    const writeString = (offset, string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
    view.setUint16(32, numChannels * (bitDepth / 8), true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, length, true);
    
    
    let offset = 44;
    for (let i = 0; i < audioBuffer.length; i++) {
        for (let channel = 0; channel < numChannels; channel++) {
            const sample = audioBuffer.getChannelData(channel)[i];
            const intSample = Math.max(-1, Math.min(1, sample)) * 0x7FFF;
            view.setInt16(offset, intSample, true);
            offset += 2;
        }
    }
    
    return new Blob([buffer], { type: 'audio/wav' });
}


function convertMarkdownToHTML(markdown, isSummary = false) {
    if (!markdown) return '';
    
    
    let html = markdown
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>');
    
    
    html = html
        .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/gim, '<em>$1</em>')
        .replace(/__(.*?)__/gim, '<strong>$1</strong>')
        .replace(/_(.*?)_/gim, '<em>$1</em>');
    
    
    html = html
        .replace(/^\s*\*\s(.*$)/gim, '<li>$1</li>')
        .replace(/^\s*-\s(.*$)/gim, '<li>$1</li>')
        .replace(/^\s*\d+\.\s(.*$)/gim, '<li>$1</li>');
    
    
    html = html
        .replace(/<li>.*?<\/li>/gs, match => {
            if (match.includes('</li><li>')) {
                return '<ul>' + match + '</ul>';
            }
            return match;
        });
    
    
    if (isSummary || html.includes('Updated Assessment') || html.includes('Urgency Level')) {
        
        html = html.replace(/(<strong>)/g, '\n\n$1');
        
        
        html = html.replace(/(<\/li>)\s*\n+\s*(<li>)/g, '$1$2');
    }
    
    
    const paragraphs = html.split(/\n\s*\n/);
    html = paragraphs.map(p => {
        
        if (p.includes('<li>') || p.includes('<h') || p.includes('<strong>') || p.match(/^<[a-z]/i)) {
            return p;
        }
        return `<p>${p}</p>`;
    }).join('');
    
    
    html = html.replace(/\n(?![^<]*<\/li>)/g, '<br>');
    
    
    html = html.replace(/<p><\/p>/g, '');
    
    return html;
}


function stripHtml(html) {
    if (!html) return '';
    
    
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    
    
    let text = '';
    const nodes = tempDiv.childNodes;
    
    function processNode(node, level = 0) {
        
        if (node.nodeType === Node.TEXT_NODE) {
            text += node.textContent;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            
            const tagName = node.tagName.toLowerCase();
            
            if (tagName === 'h1') {
                text += '\n\n# ' + node.textContent + '\n\n';
            } else if (tagName === 'h2') {
                text += '\n\n## ' + node.textContent + '\n\n';
            } else if (tagName === 'h3') {
                text += '\n\n### ' + node.textContent + '\n\n';
            } else if (tagName === 'p') {
                text += '\n\n' + node.textContent + '\n\n';
            } else if (tagName === 'li') {
                text += '\n• ' + node.textContent;
            } else if (tagName === 'strong' || tagName === 'b') {
                text += node.textContent;
            } else if (tagName === 'em' || tagName === 'i') {
                text += node.textContent;
            } else if (tagName === 'br') {
                text += '\n';
            } else if (tagName === 'ul' || tagName === 'ol') {
                
                text += '\n';
                for (let i = 0; i < node.childNodes.length; i++) {
                    processNode(node.childNodes[i], level + 1);
                }
                text += '\n';
            } else {
                
                for (let i = 0; i < node.childNodes.length; i++) {
                    processNode(node.childNodes[i], level);
                }
            }
        }
    }
    
    
    for (let i = 0; i < nodes.length; i++) {
        processNode(nodes[i]);
    }
    
    
    return text
        .replace(/\n{3,}/g, '\n\n')
        .replace(/^\s+|\s+$/g, '');
}


document.getElementById('reportType').addEventListener('change', function() {
    const customReportNameContainer = document.getElementById('customReportNameContainer');
    if (this.value === 'other') {
        customReportNameContainer.classList.remove('d-none');
        document.getElementById('customReportName').setAttribute('required', 'required');
    } else {
        customReportNameContainer.classList.add('d-none');
        document.getElementById('customReportName').removeAttribute('required');
    }
});


document.getElementById('reportForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    
    if (!API_KEY || API_KEY.trim() === '') {
        const reportErrorElement = document.getElementById('reportError');
        reportErrorElement.textContent = 'Error: API key is missing. Please check your configuration.';
        reportErrorElement.classList.remove('d-none');
        return;
    }
    
    
    let reportType = document.getElementById('reportType').value;
    const patientName = document.getElementById('patientName').value;
    const patientId = document.getElementById('patientId').value;
    const transcribedText = document.getElementById('transcribedText').value || 'No transcribed text available.';
    const additionalNotes = document.getElementById('additionalNotes').value || '';
    
    
    if (reportType === 'other') {
        const customName = document.getElementById('customReportName').value.trim();
        if (customName) {
            reportType = customName;
        } else {
            alert('Please enter a custom report name.');
            return;
        }
    }
    
    
    const patientAge = document.getElementById('reportPatientAge').value;
    const patientGender = document.getElementById('reportPatientGender').value;
    
    
    if (!reportType || !patientName || !patientId || !patientAge || !patientGender) {
        alert('Please fill in all required fields.');
        return;
    }
    
    
    const currentDate = new Date().toLocaleDateString('en-US', {
        year: 'numeric', 
        month: 'long', 
        day: 'numeric'
    });

    
    const reportLoadingElement = document.getElementById('reportLoading');
    const reportContentElement = document.getElementById('reportContent');
    const reportErrorElement = document.getElementById('reportError');
    
    hideElement(reportContentElement);
    hideElement(reportErrorElement);
    
    showElement(reportLoadingElement);
    
    try {
        console.log('Generating report...');
        
        
        const totalInputLength = transcribedText.length + additionalNotes.length;
        if (totalInputLength > 30000) { 
            throw new Error('The combined text is too long. Please reduce the content length.');
        }
        
        
        const dynamicTokens = Math.min(4000, 1000 + Math.floor(totalInputLength / 3));
        
        
        const systemPrompt = `Format the given information into a professional ${reportType} report with standard medical sections. Use proper markdown formatting (# for main headings, ## for subheadings, etc.) for section titles. Do not use HTML tags. Include a proper header with patient details and date. Be concise but complete.`;
        
        const userPrompt = `Format as ${reportType} report:

REPORT HEADER:
- Patient Name: ${patientName}
- Patient ID: ${patientId}
- Age: ${patientAge}
- Gender: ${patientGender}
- Date of Report: ${currentDate}

Findings: ${transcribedText}
Notes: ${additionalNotes}

Include these sections:
1. Patient Information
2. Examination Details
3. Findings
4. Impression/Conclusion
5. Recommendations

Format it professionally with clear section headers using markdown formatting (# for headings, * for lists, etc.). Do not use HTML tags. Ensure the report is complete and no content is cut off.`;

        
        const formattedReportElement = document.getElementById('formattedReport');
        formattedReportElement.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
        
        
        formattedReportElement.classList.remove('d-none');
        formattedReportElement.style.display = 'block';
        formattedReportElement.style.opacity = '1';
        formattedReportElement.style.visibility = 'visible';
        
        
        formattedReportElement.style.transition = 'none';
        
        
        void formattedReportElement.offsetWidth;
        
        
        reportContentElement.classList.remove('d-none');
        reportContentElement.style.display = 'block';
        reportContentElement.style.opacity = '1';
        reportContentElement.style.visibility = 'visible';
        
        
        reportLoadingElement.classList.add('d-none');
        
        
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];
        
        
        const formattedReport = await streamResponse(
            MODELS.REPORT,
            messages,
            dynamicTokens,
            formattedReportElement,
            'REPORT'
        );
        
    } catch (error) {
        handleReportError(error);
    }
});


document.getElementById('downloadPdf').addEventListener('click', () => {
    try {
        
        const reportHtml = document.getElementById('formattedReport').innerHTML;
        const reportContent = stripHtml(reportHtml);
        
        const patientName = document.getElementById('patientName').value;
        const patientId = document.getElementById('patientId').value;
        let reportType = document.getElementById('reportType').value;
        
        
        if (reportType === 'other') {
            const customName = document.getElementById('customReportName').value.trim();
            if (customName) {
                reportType = customName;
            }
        }
        
        const patientAge = document.getElementById('reportPatientAge').value;
        const patientGender = document.getElementById('reportPatientGender').value;

        
        if (typeof window.jspdf === 'undefined') {
            alert('PDF generation library not loaded. Please check your internet connection and try again.');
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4',
            compress: true
        });
        
        
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 20; 
        const contentWidth = pageWidth - (margin * 2);
        
        
        doc.setProperties({
            title: `${reportType} Report - ${patientName}`,
            subject: 'Medical Report',
            author: 'AI Medical Assistant',
            creator: 'AI Medical Assistant'
        });
        
        
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.setTextColor(0, 51, 102); 
        doc.text(`${reportType.toUpperCase()} REPORT`, pageWidth / 2, margin, { align: 'center' });
        
        
        doc.setDrawColor(0, 51, 102);
        doc.setLineWidth(0.5);
        doc.line(margin, margin + 5, pageWidth - margin, margin + 5);
        
        
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(0, 0, 0);
        doc.text('PATIENT INFORMATION', margin, margin + 15);
        
        
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        
        const infoStartY = margin + 22;
        const infoColWidth = (contentWidth) / 2;
        
        
        doc.setFont('helvetica', 'bold');
        doc.text('Patient Name:', margin, infoStartY);
        doc.setFont('helvetica', 'normal');
        doc.text(patientName, margin + 30, infoStartY);
        
        doc.setFont('helvetica', 'bold');
        doc.text('Patient ID:', margin + infoColWidth, infoStartY);
        doc.setFont('helvetica', 'normal');
        doc.text(patientId, margin + infoColWidth + 30, infoStartY);
        
        
        doc.setFont('helvetica', 'bold');
        doc.text('Age:', margin, infoStartY + 7);
        doc.setFont('helvetica', 'normal');
        doc.text(patientAge, margin + 30, infoStartY + 7);
        
        doc.setFont('helvetica', 'bold');
        doc.text('Gender:', margin + infoColWidth, infoStartY + 7);
        doc.setFont('helvetica', 'normal');
        doc.text(patientGender, margin + infoColWidth + 30, infoStartY + 7);
        
        
        doc.setFont('helvetica', 'bold');
        doc.text('Date:', margin, infoStartY + 14);
        doc.setFont('helvetica', 'normal');
        doc.text(new Date().toLocaleDateString(), margin + 30, infoStartY + 14);
        
        
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(0, 51, 102);
        doc.text('REPORT DETAILS', margin, infoStartY + 25);
        
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.2);
        doc.line(margin, infoStartY + 27, pageWidth - margin, infoStartY + 27);
        
        
        const paragraphs = reportContent.split('\n\n').filter(p => p.trim() !== '');
        
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        
        let cursorY = infoStartY + 35;
        const lineHeight = 5;
        
        
        for (let i = 0; i < paragraphs.length; i++) {
            const paragraph = paragraphs[i].trim();
            
            
            if (paragraph.startsWith('# ')) {
                
                if (cursorY + 10 > pageHeight - margin) {
                    doc.addPage();
                    cursorY = margin + 10;
                }
                
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(12);
                doc.setTextColor(0, 51, 102);
                doc.text(paragraph.replace(/^# /, ''), margin, cursorY);
                cursorY += 7;
                
                
                doc.setDrawColor(200, 200, 200);
                doc.setLineWidth(0.2);
                doc.line(margin, cursorY - 2, pageWidth - margin, cursorY - 2);
                
            } else if (paragraph.startsWith('## ')) {
                
                if (cursorY + 8 > pageHeight - margin) {
                    doc.addPage();
                    cursorY = margin + 10;
                }
                
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(11);
                doc.text(paragraph.replace(/^## /, ''), margin, cursorY);
                cursorY += 6;
                
            } else if (paragraph.startsWith('• ') || paragraph.startsWith('* ')) {
                
                const bulletText = paragraph.replace(/^[•*] /, '');
                const bulletLines = doc.splitTextToSize(bulletText, contentWidth - 5);
                
                if (cursorY + (bulletLines.length * lineHeight) > pageHeight - margin) {
                    doc.addPage();
                    cursorY = margin + 10;
                }
                
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(10);
                doc.text('•', margin, cursorY);
                doc.text(bulletLines, margin + 5, cursorY);
                cursorY += bulletLines.length * lineHeight;
                
            } else {
                
                const lines = doc.splitTextToSize(paragraph, contentWidth);
                
                if (cursorY + (lines.length * lineHeight) > pageHeight - margin) {
                    doc.addPage();
                    cursorY = margin + 10;
                }
                
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(10);
                doc.text(lines, margin, cursorY);
                cursorY += lines.length * lineHeight + 2; 
            }
        }
        
        
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(8);
            doc.setTextColor(100, 100, 100);
            doc.text(`Page ${i} of ${totalPages}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
        }
        
        doc.save(`${reportType}_${patientName}_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (error) {
        console.error('PDF generation error:', error);
        alert('Failed to generate PDF. See console for details.');
    }
}); 


function handleReportError(error) {
    console.error('Report generation error:', error);
    
    const reportLoadingElement = document.getElementById('reportLoading');
    const reportErrorElement = document.getElementById('reportError');
    
    hideElement(reportLoadingElement);
    reportErrorElement.textContent = error.message || 'An error occurred while generating the report. Please try again.';
    reportErrorElement.classList.remove('d-none');
    
    
    if (error.message && error.message.includes('400')) {
        reportErrorElement.innerHTML = 'Error 400: Bad Request. This could be due:<br>' +
            '- Invalid API key<br>' +
            '- Model not available in your region<br>' +
            '- Rate limiting<br>' +
            '- Malformed request<br><br>' +
            'Please check your API key and try again with a smaller input.';
    }
} 
