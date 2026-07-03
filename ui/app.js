/**
 * Polylang-NLP: Language Intelligence Platform
 * UI Controller, Rayen Lassoued
 */

const API_BASE_URL = 'http://localhost:8043';

// ---- Navigation ----
document.addEventListener('DOMContentLoaded', function () {
    initNavigation();
    initSentimentAnalysis();
    initQuestionAnswering();
    initDocumentManagement();
    initAnalysisModeToggle();
    initBatchToggles();
    initBatchQuestionAnswering();
    checkApiStatus();
    setInterval(checkApiStatus, 30000);
});

function initNavigation() {
    const navLinks = document.querySelectorAll('.nav-link[data-page]');
    const pages = document.querySelectorAll('.page');

    navLinks.forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            navLinks.forEach(l => l.classList.remove('active'));
            this.classList.add('active');
            const targetPage = this.getAttribute('data-page');
            pages.forEach(page => { page.style.display = 'none'; });
            document.getElementById(`${targetPage}-page`).style.display = 'block';
            if (targetPage === 'stats') {
                loadStats();
            }
        });
    });
}

// ---- Usage Stats ----
async function loadStats() {
    try {
        const response = await fetch(`${API_BASE_URL}/stats`, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const stats = await response.json();
        renderStats(stats);
    } catch (error) {
        const byLanguage = document.getElementById('stats-by-language');
        const recentQueries = document.getElementById('stats-recent-queries');
        if (byLanguage) showError(byLanguage, `Could not load stats: ${error.message}`);
        if (recentQueries) showError(recentQueries, `Could not load stats: ${error.message}`);
    }
}

function renderStats(stats) {
    const uptimeMin = (stats.uptime_seconds / 60).toFixed(1);
    document.getElementById('stat-uptime').textContent = `${uptimeMin} min`;

    document.getElementById('stat-sentiment-requests').textContent = stats.sentiment_requests;
    document.getElementById('stat-sentiment-conf').textContent =
        `avg conf ${(stats.sentiment_avg_confidence * 100).toFixed(1)}%`;

    document.getElementById('stat-qa-requests').textContent = stats.qa_requests;
    document.getElementById('stat-qa-rate').textContent =
        `${(stats.qa_answer_rate * 100).toFixed(1)}% answered`;

    document.getElementById('stat-kb-docs').textContent = stats.knowledge_base_documents;

    // Sentiment requests by language
    const byLanguageContainer = document.getElementById('stats-by-language');
    const languages = Object.entries(stats.sentiment_by_language || {});
    if (languages.length === 0) {
        byLanguageContainer.innerHTML = `
            <div class="placeholder-content">
                <i class="bi bi-bar-chart-line placeholder-icon"></i>
                <p>No sentiment requests yet</p>
            </div>
        `;
    } else {
        const maxCount = Math.max(...languages.map(([, count]) => count));
        byLanguageContainer.innerHTML = languages.map(([lang, count]) => `
            <div class="mb-2">
                <div class="d-flex justify-content-between mb-1">
                    <span>${escapeHtml(lang.toUpperCase())}</span>
                    <span>${count}</span>
                </div>
                <div class="progress" style="height: 8px; background: var(--input-bg);">
                    <div class="progress-bar" role="progressbar"
                         style="width: ${(count / maxCount) * 100}%; background: var(--teal-500);"></div>
                </div>
            </div>
        `).join('');
    }

    // Recent QA queries
    const recentContainer = document.getElementById('stats-recent-queries');
    const queries = stats.recent_queries || [];
    if (queries.length === 0) {
        recentContainer.innerHTML = `
            <div class="placeholder-content">
                <i class="bi bi-chat-square-dots placeholder-icon"></i>
                <p>No questions asked yet</p>
            </div>
        `;
    } else {
        recentContainer.innerHTML = queries.map(q => `
            <div class="mb-3 pb-2" style="border-bottom: 1px solid var(--border-color);">
                <div class="fw-semibold">${escapeHtml(q.question)}</div>
                <div class="text-secondary small">
                    ${q.has_answer ? escapeHtml(q.answer) : 'No confident answer'}
                    <span class="ms-2">(${(q.confidence * 100).toFixed(1)}% conf.)</span>
                </div>
            </div>
        `).join('');
    }
}

// ---- Batch Mode Toggles ----
function initBatchToggles() {
    const sentimentBatch = document.getElementById('sentiment-batch-mode');
    const sentimentLabel = document.getElementById('sentiment-text-label');
    const sentimentHint = document.getElementById('sentiment-batch-hint');
    const sentimentModeSelect = document.getElementById('analysis-mode');
    const sentimentSubmitBtn = document.getElementById('sentiment-submit-btn');

    if (sentimentBatch) {
        sentimentBatch.addEventListener('change', function () {
            const isBatch = this.checked;
            sentimentLabel.textContent = isBatch ? 'Texts (one per line)' : 'Text Input';
            sentimentHint.style.display = isBatch ? 'block' : 'none';
            sentimentModeSelect.disabled = isBatch;
            if (isBatch) {
                sentimentModeSelect.value = 'basic';
                document.getElementById('aspects-group').style.display = 'none';
            }
            sentimentSubmitBtn.innerHTML = isBatch
                ? '<i class="bi bi-cpu me-2"></i>Analyze Batch'
                : '<i class="bi bi-cpu me-2"></i>Analyze Sentiment';
        });
    }

    const documentBatch = document.getElementById('document-batch-mode');
    const documentLabel = document.getElementById('document-text-label');
    const documentHint = document.getElementById('document-batch-hint');
    const documentSubmitBtn = document.getElementById('document-submit-btn');

    if (documentBatch) {
        documentBatch.addEventListener('change', function () {
            const isBatch = this.checked;
            documentLabel.textContent = isBatch ? 'Documents (separate with ---)' : 'Document Content';
            documentHint.style.display = isBatch ? 'block' : 'none';
            documentSubmitBtn.innerHTML = isBatch
                ? '<i class="bi bi-plus-circle me-2"></i>Add All to Knowledge Base'
                : '<i class="bi bi-plus-circle me-2"></i>Add to Knowledge Base';
        });
    }
}

function initAnalysisModeToggle() {
    const modeSelect = document.getElementById('analysis-mode');
    const aspectsGroup = document.getElementById('aspects-group');
    if (modeSelect) {
        modeSelect.addEventListener('change', function () {
            aspectsGroup.style.display = this.value === 'aspect' ? 'block' : 'none';
        });
    }
}

// ---- API Status Check ----
async function checkApiStatus() {
    const indicator = document.getElementById('api-status');
    if (!indicator) return;
    const dot = indicator.querySelector('.status-dot');
    const text = indicator.querySelector('.status-text');
    try {
        const resp = await fetch(`${API_BASE_URL}/`, { signal: AbortSignal.timeout(5000) });
        if (resp.ok) {
            dot.className = 'status-dot online';
            text.textContent = 'API Online';
        } else {
            dot.className = 'status-dot offline';
            text.textContent = 'API Error';
        }
    } catch {
        dot.className = 'status-dot offline';
        text.textContent = 'API Offline';
    }
}

// ---- Example Loader ----
window.loadExample = function (type) {
    const textEl = document.getElementById('sentiment-text');
    const langEl = document.getElementById('sentiment-language');
    const modeEl = document.getElementById('analysis-mode');
    const aspectsEl = document.getElementById('sentiment-aspects');
    const aspectsGroup = document.getElementById('aspects-group');

    const examples = {
        positive: {
            text: "The new NLP platform exceeded all our expectations. The sentiment analysis is incredibly accurate and the response time is lightning fast. Our team is very satisfied with the results.",
            lang: 'en', mode: 'basic', aspects: ''
        },
        negative: {
            text: "The service was disappointing and the documentation was poorly written. We experienced multiple crashes during our evaluation. The support team took three days to respond.",
            lang: 'en', mode: 'basic', aspects: ''
        },
        mixed: {
            text: "The hotel had beautiful views and the staff was friendly, but the rooms were small and the food was terrible. Overall an average experience.",
            lang: 'en', mode: 'aspect', aspects: 'views, staff, rooms, food'
        },
        german: {
            text: "Das Produkt ist ausgezeichnet und die Lieferung war sehr schnell. Der Kundenservice hat uns professionell geholfen.",
            lang: 'de', mode: 'basic', aspects: ''
        },
        french: {
            text: "Le service client était exceptionnel et le produit de très haute qualité. Je recommande vivement cette entreprise.",
            lang: 'fr', mode: 'basic', aspects: ''
        },
        aspect: {
            text: "The phone has a great camera and excellent battery life, but the price is too high and the software has bugs. The design looks premium though.",
            lang: 'en', mode: 'aspect', aspects: 'camera, battery, price, software, design'
        }
    };

    const ex = examples[type];
    if (!ex) return;
    textEl.value = ex.text;
    langEl.value = ex.lang;
    modeEl.value = ex.mode;
    aspectsEl.value = ex.aspects;
    aspectsGroup.style.display = ex.mode === 'aspect' ? 'block' : 'none';
};

// ---- Sentiment Analysis ----
function initSentimentAnalysis() {
    const form = document.getElementById('sentiment-form');
    if (!form) return;

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        const text = document.getElementById('sentiment-text').value.trim();
        const language = document.getElementById('sentiment-language').value;
        const mode = document.getElementById('analysis-mode').value;
        const aspectsInput = document.getElementById('sentiment-aspects').value.trim();
        const isBatch = document.getElementById('sentiment-batch-mode').checked;

        if (!text) { showAlert('Please enter text to analyze.'); return; }

        const resultsContainer = document.getElementById('sentiment-results');
        showLoading(resultsContainer);

        try {
            if (isBatch) {
                const texts = text.split('\n').map(t => t.trim()).filter(Boolean);
                if (texts.length === 0) { showAlert('Please enter at least one text.'); return; }
                const results = await apiPost('/sentiment/batch', {
                    texts,
                    language: language === 'multilingual' ? null : language
                });
                renderBatchSentimentResults(resultsContainer, texts, results);
            } else if (mode === 'aspect' && aspectsInput) {
                const aspects = aspectsInput.split(',').map(a => a.trim()).filter(Boolean);
                const result = await apiPost('/sentiment/aspects', {
                    text,
                    aspects,
                    language: language === 'multilingual' ? null : language
                });
                renderAspectResults(resultsContainer, result);
            } else {
                const result = await apiPost('/sentiment', {
                    text,
                    language: language === 'multilingual' ? null : language
                });
                renderSentimentResults(resultsContainer, result);
            }
        } catch (err) {
            showError(resultsContainer, err.message);
        }
    });
}

function renderBatchSentimentResults(container, texts, results) {
    const rows = texts.map((text, i) => {
        const r = results[i] || {};
        const s = r.sentiment || 'neutral';
        const confPercent = Math.round((r.confidence || 0) * 100);
        return `
            <div class="aspect-card mb-2">
                <div class="aspect-header">
                    <span class="aspect-name" style="max-width:70%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(text)}">${escapeHtml(text)}</span>
                    <span class="sentiment-badge ${s}" style="font-size:0.7rem; padding: 2px 8px;">${capitalize(s)}</span>
                </div>
                <div style="font-size:0.72rem; color: var(--text-muted); margin-top:6px;">
                    Confidence: ${confPercent}% ${r.language ? `| Language: ${r.language.toUpperCase()}` : ''}
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <div style="font-size:0.78rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin-bottom: 10px;">
            Batch Results (${texts.length} texts)
        </div>
        ${rows}
    `;
}

function renderSentimentResults(container, result) {
    const s = result.sentiment || 'neutral';
    const scorePercent = Math.round((result.score || 0) * 100);
    const confPercent = Math.round((result.confidence || 0) * 100);

    container.innerHTML = `
        <div class="sentiment-result-card ${s}">
            <div class="sentiment-label-row">
                <span class="sentiment-label-title">Overall Sentiment</span>
                <span class="sentiment-badge ${s}">${capitalize(s)}</span>
            </div>

            <div class="score-bar-wrapper">
                <div class="score-bar-label">
                    <span>Sentiment Score</span>
                    <span>${scorePercent}%</span>
                </div>
                <div class="score-bar-track">
                    <div class="score-bar-fill ${s}" style="width: ${scorePercent}%"></div>
                </div>
            </div>

            <div class="score-bar-wrapper">
                <div class="score-bar-label">
                    <span>Model Confidence</span>
                    <span>${confPercent}%</span>
                </div>
                <div class="score-bar-track">
                    <div class="score-bar-fill teal" style="width: ${confPercent}%"></div>
                </div>
            </div>

            <div class="meta-row">
                <div class="meta-item">Language: <span>${(result.language || 'en').toUpperCase()}</span></div>
                <div class="meta-item">Score: <span>${(result.score || 0).toFixed(4)}</span></div>
                <div class="meta-item">Confidence: <span>${(result.confidence || 0).toFixed(4)}</span></div>
            </div>
        </div>
    `;
}

function renderAspectResults(container, result) {
    const overall = result.overall || {};
    const aspects = result.aspects || {};
    const s = overall.sentiment || 'neutral';
    const scorePercent = Math.round((overall.score || 0) * 100);
    const confPercent = Math.round((overall.confidence || 0) * 100);

    let aspectCards = '';
    for (const [aspect, data] of Object.entries(aspects)) {
        const as = data.sentiment || 'neutral';
        const asScore = Math.round((data.score || 0) * 100);
        aspectCards += `
            <div class="aspect-card">
                <div class="aspect-header">
                    <span class="aspect-name">${aspect}</span>
                    <span class="sentiment-badge ${as}" style="font-size:0.7rem; padding: 2px 8px;">${capitalize(as)}</span>
                </div>
                <div class="score-bar-track">
                    <div class="score-bar-fill ${as}" style="width: ${asScore}%"></div>
                </div>
                <div style="font-size:0.72rem; color: var(--text-muted); margin-top:6px;">
                    Score: ${(data.score || 0).toFixed(2)} | Mentions: ${data.mentions || 0}
                </div>
            </div>
        `;
    }

    container.innerHTML = `
        <div class="sentiment-result-card ${s}">
            <div class="sentiment-label-row">
                <span class="sentiment-label-title">Overall Sentiment</span>
                <span class="sentiment-badge ${s}">${capitalize(s)}</span>
            </div>
            <div class="score-bar-wrapper">
                <div class="score-bar-label"><span>Overall Score</span><span>${scorePercent}%</span></div>
                <div class="score-bar-track">
                    <div class="score-bar-fill ${s}" style="width: ${scorePercent}%"></div>
                </div>
            </div>
            <div class="score-bar-wrapper">
                <div class="score-bar-label"><span>Confidence</span><span>${confPercent}%</span></div>
                <div class="score-bar-track">
                    <div class="score-bar-fill teal" style="width: ${confPercent}%"></div>
                </div>
            </div>
        </div>

        <div style="font-size:0.78rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin: 16px 0 10px;">
            Aspect Analysis
        </div>
        <div class="aspect-grid">${aspectCards}</div>
    `;
}

// ---- Question Answering ----
function initQuestionAnswering() {
    const checkbox = document.getElementById('use-context');
    const contextBox = document.getElementById('context-container');
    if (checkbox) {
        checkbox.addEventListener('change', function () {
            contextBox.style.display = this.checked ? 'block' : 'none';
        });
    }

    const form = document.getElementById('qa-form');
    if (!form) return;

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        const question = document.getElementById('question-input').value.trim();
        const useContext = document.getElementById('use-context').checked;
        const context = useContext ? document.getElementById('context-input').value.trim() : null;

        if (!question) { showAlert('Please enter a question.'); return; }

        const resultsContainer = document.getElementById('qa-results');
        showLoading(resultsContainer);

        try {
            const result = await apiPost('/question', { question, context, top_k: 5, threshold: 0.01 });
            renderQAResults(resultsContainer, result);
        } catch (err) {
            showError(resultsContainer, err.message);
        }
    });
}

function renderQAResults(container, result) {
    if (result.has_answer) {
        const confPercent = Math.round((result.confidence || 0) * 100);

        let sourcesHtml = '';
        if (result.sources && result.sources.length > 0) {
            const validSources = result.sources.filter(s => s && (s.title || s.category));
            if (validSources.length > 0) {
                sourcesHtml = `
                    <div class="sources-section">
                        <div class="sources-title">Retrieved Sources</div>
                        <div>
                            ${validSources.map(s => `
                                <span class="source-chip">
                                    <i class="bi bi-file-text"></i>
                                    ${s.title || s.category || 'Document'}
                                    ${s.category ? `<em style="opacity:0.7;">(${s.category})</em>` : ''}
                                </span>
                            `).join('')}
                        </div>
                    </div>
                `;
            }
        }

        container.innerHTML = `
            <div class="answer-card">
                <div class="answer-label"><i class="bi bi-chat-right-text me-1"></i>Answer</div>
                <div class="answer-text">${escapeHtml(result.answer)}</div>
                <div class="score-bar-wrapper">
                    <div class="score-bar-label"><span>Confidence</span><span>${confPercent}%</span></div>
                    <div class="score-bar-track">
                        <div class="score-bar-fill teal" style="width: ${confPercent}%"></div>
                    </div>
                </div>
                ${sourcesHtml}
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="no-answer-card">
                <i class="bi bi-exclamation-triangle" style="font-size:1.5rem; display:block; margin-bottom:8px;"></i>
                <strong>No answer found</strong>
                <p style="font-size:0.875rem; margin-top:6px; opacity:0.8;">
                    ${result.message || 'No relevant information found in the knowledge base.'}
                </p>
                <p style="font-size:0.8rem; opacity:0.6; margin-top:4px;">
                    Try adding relevant documents to the knowledge base first.
                </p>
            </div>
        `;
    }
}

// ---- Document Management ----
function initDocumentManagement() {
    const form = document.getElementById('document-form');
    if (!form) return;

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        const text = document.getElementById('document-text').value.trim();
        const title = document.getElementById('document-title').value.trim();
        const category = document.getElementById('document-category').value.trim();
        const isBatch = document.getElementById('document-batch-mode').checked;

        if (!text) { showAlert('Please enter document text.'); return; }

        const notification = document.getElementById('kb-notification');

        try {
            if (isBatch) {
                const chunks = text.split(/^\s*---\s*$/m).map(t => t.trim()).filter(Boolean);
                if (chunks.length === 0) { showAlert('Please enter at least one document.'); return; }
                const documents = chunks.map((chunkText, i) => ({
                    text: chunkText,
                    metadata: {
                        title: title ? `${title} (${i + 1})` : `Untitled (${i + 1})`,
                        category: category || 'General',
                        source: 'user-submitted-batch'
                    }
                }));
                const result = await apiPost('/documents/batch', { documents });

                notification.className = 'kb-notification success';
                notification.innerHTML = `<i class="bi bi-check-circle me-2"></i>${result.document_ids.length} documents added, IDs: ${result.document_ids.join(', ')}`;
                notification.style.display = 'block';
            } else {
                const result = await apiPost('/documents', {
                    text,
                    metadata: { title: title || 'Untitled', category: category || 'General', source: 'user-submitted' }
                });

                notification.className = 'kb-notification success';
                notification.innerHTML = `<i class="bi bi-check-circle me-2"></i>Document added successfully, ID: ${result.document_id}`;
                notification.style.display = 'block';
            }

            form.reset();
            setTimeout(() => { notification.style.display = 'none'; }, 4000);
        } catch (err) {
            notification.className = 'kb-notification error';
            notification.innerHTML = `<i class="bi bi-x-circle me-2"></i>Error: ${err.message}`;
            notification.style.display = 'block';
        }
    });
}

// ---- Batch Question Answering ----
function initBatchQuestionAnswering() {
    const form = document.getElementById('batch-question-form');
    if (!form) return;

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        const raw = document.getElementById('batch-question-text').value.trim();
        const questions = raw.split('\n').map(q => q.trim()).filter(Boolean);

        if (questions.length === 0) { showAlert('Please enter at least one question.'); return; }

        const resultsContainer = document.getElementById('batch-question-results');
        showLoading(resultsContainer);

        try {
            const results = await apiPost('/question/batch', { questions });
            renderBatchQuestionResults(resultsContainer, questions, results);
        } catch (err) {
            showError(resultsContainer, err.message);
        }
    });
}

function renderBatchQuestionResults(container, questions, results) {
    const rows = questions.map((q, i) => {
        const r = results[i] || {};
        const confPercent = Math.round((r.confidence || 0) * 100);
        return `
            <div class="aspect-card mb-2">
                <div class="aspect-header">
                    <span class="aspect-name" style="max-width:70%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(q)}">${escapeHtml(q)}</span>
                    <span class="sentiment-badge ${r.has_answer ? 'positive' : 'negative'}" style="font-size:0.7rem; padding: 2px 8px;">${r.has_answer ? 'Answered' : 'No Answer'}</span>
                </div>
                <div style="font-size:0.8rem; margin-top:6px;">${r.has_answer ? escapeHtml(r.answer) : (r.message || 'No confident answer found')}</div>
                <div style="font-size:0.72rem; color: var(--text-muted); margin-top:4px;">Confidence: ${confPercent}%</div>
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <div style="font-size:0.78rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin-bottom: 10px;">
            Batch Results (${questions.length} questions)
        </div>
        ${rows}
    `;
}

// ---- Utility Functions ----
async function apiPost(endpoint, body) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || `API error ${response.status}`);
    }
    return response.json();
}

function showLoading(container) {
    container.innerHTML = `
        <div class="spinner-container">
            <div class="loading-spinner"></div>
        </div>
    `;
}

function showError(container, message) {
    container.innerHTML = `
        <div style="padding:20px; text-align:center; color:var(--red-400);">
            <i class="bi bi-exclamation-circle" style="font-size:1.5rem; display:block; margin-bottom:8px;"></i>
            <strong>Error</strong>
            <p style="font-size:0.875rem; margin-top:6px; opacity:0.8;">${escapeHtml(message)}</p>
        </div>
    `;
}

function showAlert(msg) {
    alert(msg);
}

function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
