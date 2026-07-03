"""
Main API module for the Polylang-NLP system.
Provides RESTful endpoints for sentiment analysis and question answering.
"""

import os
import time
import logging
from collections import deque
from datetime import datetime, timezone
from typing import Dict, List, Optional
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware

from app.sentiment_analysis.analyzer import SentimentAnalyzer
from app.question_answering.qa_system import QASystem
from app.api.models import (
    SentimentRequest, SentimentResponse, BatchSentimentRequest,
    AspectSentimentRequest, AspectSentimentResponse,
    DocumentRequest, BatchDocumentRequest, DocumentResponse, BatchDocumentResponse,
    QuestionRequest, QuestionResponse, BatchQuestionRequest,
    HealthResponse, StatsResponse
)
from app import __version__

# Maximum text length accepted for analysis (basic input validation)
MAX_TEXT_LENGTH = 5000

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="Polylang-NLP API",
    description="API for multilingual sentiment analysis and question answering with retrieval augmentation",
    version=__version__
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log every request with method, path, status code, and duration."""
    start_time = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start_time) * 1000
    logger.info(
        f"{request.method} {request.url.path} -> {response.status_code} "
        f"({duration_ms:.1f}ms)"
    )
    return response

# Global instances of our NLP components
sentiment_analyzer = None
qa_system = None

# Model paths
MODELS_DIR = os.environ.get("MODELS_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "models"))
QA_MODEL_PATH = os.path.join(MODELS_DIR, "qa_system")


# ---- In-memory usage statistics ----
# Simple counters for the /stats endpoint. Reset on service restart — documented
# as a known limitation (see INTERVIEW_PREP.md). A production deployment would
# persist these in Redis/Postgres.
class UsageStats:
    """Tracks lightweight usage statistics for the /stats endpoint."""

    def __init__(self, history_size: int = 20):
        self.start_time = datetime.now(timezone.utc)
        self.sentiment_requests = 0
        self.sentiment_by_language: Dict[str, int] = {}
        self.sentiment_confidence_sum = 0.0
        self.qa_requests = 0
        self.qa_answers_found = 0
        self.qa_confidence_sum = 0.0
        self.query_history: deque = deque(maxlen=history_size)

    def record_sentiment(self, language: str, confidence: float) -> None:
        self.sentiment_requests += 1
        self.sentiment_by_language[language] = self.sentiment_by_language.get(language, 0) + 1
        self.sentiment_confidence_sum += confidence

    def record_question(self, question: str, result: Dict) -> None:
        self.qa_requests += 1
        if result.get("has_answer"):
            self.qa_answers_found += 1
        self.qa_confidence_sum += result.get("confidence", 0.0)
        self.query_history.appendleft({
            "question": question,
            "answer": result.get("answer", ""),
            "confidence": round(result.get("confidence", 0.0), 4),
            "has_answer": result.get("has_answer", False),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

    def snapshot(self, document_count: int) -> Dict:
        avg_sentiment_conf = (
            self.sentiment_confidence_sum / self.sentiment_requests
            if self.sentiment_requests else 0.0
        )
        avg_qa_conf = (
            self.qa_confidence_sum / self.qa_requests
            if self.qa_requests else 0.0
        )
        qa_answer_rate = (
            self.qa_answers_found / self.qa_requests
            if self.qa_requests else 0.0
        )
        uptime_seconds = (datetime.now(timezone.utc) - self.start_time).total_seconds()

        return {
            "uptime_seconds": round(uptime_seconds, 1),
            "sentiment_requests": self.sentiment_requests,
            "sentiment_by_language": self.sentiment_by_language,
            "sentiment_avg_confidence": round(avg_sentiment_conf, 4),
            "qa_requests": self.qa_requests,
            "qa_answer_rate": round(qa_answer_rate, 4),
            "qa_avg_confidence": round(avg_qa_conf, 4),
            "knowledge_base_documents": document_count,
            "recent_queries": list(self.query_history),
        }


usage_stats = UsageStats()


def validate_text_input(text: str, field_name: str = "text") -> None:
    """Validate text input for sentiment/QA endpoints.

    Raises HTTPException(422) if the text is empty/whitespace-only or exceeds
    MAX_TEXT_LENGTH.
    """
    if text is None or not text.strip():
        raise HTTPException(status_code=422, detail=f"'{field_name}' must not be empty")
    if len(text) > MAX_TEXT_LENGTH:
        raise HTTPException(
            status_code=422,
            detail=f"'{field_name}' exceeds maximum length of {MAX_TEXT_LENGTH} characters"
        )


def get_sentiment_analyzer():
    """Get or initialize the sentiment analyzer."""
    global sentiment_analyzer
    if sentiment_analyzer is None:
        logger.info("Initializing sentiment analyzer")
        sentiment_analyzer = SentimentAnalyzer()
    return sentiment_analyzer


def get_qa_system():
    """Get or initialize the QA system."""
    global qa_system
    if qa_system is None:
        logger.info("Initializing QA system")
        if os.path.exists(QA_MODEL_PATH):
            qa_system = QASystem.load(QA_MODEL_PATH)
        else:
            qa_system = QASystem()
            os.makedirs(os.path.dirname(QA_MODEL_PATH), exist_ok=True)
    return qa_system


@app.get("/", response_model=HealthResponse)
async def health_check():
    """Health check endpoint — returns immediately without loading models."""
    return {
        "status": "healthy",
        "version": __version__,
        "models": {
            "sentiment_analyzer": sentiment_analyzer.default_language if sentiment_analyzer else "not_loaded",
            "qa_system": "loaded" if qa_system is not None else "not_loaded"
        }
    }


@app.post("/sentiment", response_model=SentimentResponse)
async def analyze_sentiment(
    request: SentimentRequest,
    analyzer: SentimentAnalyzer = Depends(get_sentiment_analyzer)
):
    """
    Analyze sentiment of a text.

    Returns sentiment label, score, and confidence.
    """
    validate_text_input(request.text)
    try:
        result = analyzer.analyze(request.text, request.language)
        usage_stats.record_sentiment(result.get("language", "unknown"), result.get("confidence", 0.0))
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error analyzing sentiment: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/sentiment/batch", response_model=List[SentimentResponse])
async def batch_analyze_sentiment(
    request: BatchSentimentRequest,
    analyzer: SentimentAnalyzer = Depends(get_sentiment_analyzer)
):
    """
    Analyze sentiment of multiple texts.

    Returns list of sentiment results.
    """
    if not request.texts:
        raise HTTPException(status_code=422, detail="'texts' must not be empty")
    for text in request.texts:
        validate_text_input(text, field_name="texts")
    try:
        results = analyzer.batch_analyze(request.texts, request.language)
        for result in results:
            usage_stats.record_sentiment(result.get("language", "unknown"), result.get("confidence", 0.0))
        return results
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in batch sentiment analysis: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/sentiment/aspects", response_model=AspectSentimentResponse)
async def analyze_aspect_sentiment(
    request: AspectSentimentRequest,
    analyzer: SentimentAnalyzer = Depends(get_sentiment_analyzer)
):
    """
    Analyze sentiment with respect to specific aspects.

    Returns overall sentiment and sentiment per aspect.
    """
    validate_text_input(request.text)
    if not request.aspects:
        raise HTTPException(status_code=422, detail="'aspects' must not be empty")
    try:
        result = analyzer.analyze_with_aspects(
            request.text,
            request.aspects,
            request.language
        )
        overall = result.get("overall", {})
        usage_stats.record_sentiment(overall.get("language", "unknown"), overall.get("confidence", 0.0))
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in aspect sentiment analysis: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/documents", response_model=DocumentResponse)
async def add_document(
    request: DocumentRequest,
    qa_system: QASystem = Depends(get_qa_system)
):
    """
    Add a document to the knowledge base.

    Returns document ID.
    """
    validate_text_input(request.text)
    try:
        doc_id = qa_system.add_document(request.text, request.metadata)
        # Save after adding document
        qa_system.save(QA_MODEL_PATH)
        return {"document_id": doc_id, "success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding document: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/documents/batch", response_model=BatchDocumentResponse)
async def batch_add_documents(
    request: BatchDocumentRequest,
    qa_system: QASystem = Depends(get_qa_system)
):
    """
    Add multiple documents to the knowledge base.

    Returns list of document IDs.
    """
    if not request.documents:
        raise HTTPException(status_code=422, detail="'documents' must not be empty")
    for doc_request in request.documents:
        validate_text_input(doc_request.text, field_name="documents")
    try:
        documents = []
        for doc_request in request.documents:
            documents.append({
                "text": doc_request.text,
                "metadata": doc_request.metadata or {}
            })
        
        doc_ids = qa_system.add_documents(documents)
        
        # Save after adding documents
        qa_system.save(QA_MODEL_PATH)
        
        return {"document_ids": doc_ids, "success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in batch document addition: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/question", response_model=QuestionResponse)
async def answer_question(
    request: QuestionRequest,
    qa_system: QASystem = Depends(get_qa_system)
):
    """
    Answer a question based on the knowledge base.

    Returns answer, confidence score, and sources.
    """
    validate_text_input(request.question, field_name="question")
    if request.context is not None:
        validate_text_input(request.context, field_name="context")
    try:
        result = qa_system.answer_question(
            question=request.question,
            context=request.context,
            top_k=request.top_k,
            threshold=request.threshold
        )
        usage_stats.record_question(request.question, result)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error answering question: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/question/batch", response_model=List[QuestionResponse])
async def batch_answer_questions(
    request: BatchQuestionRequest,
    qa_system: QASystem = Depends(get_qa_system)
):
    """
    Answer multiple questions.

    Returns list of answers.
    """
    if not request.questions:
        raise HTTPException(status_code=422, detail="'questions' must not be empty")
    for question in request.questions:
        validate_text_input(question, field_name="questions")
    try:
        results = qa_system.batch_answer_questions(request.questions)
        for question, result in zip(request.questions, results):
            usage_stats.record_question(question, result)
        return results
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in batch question answering: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/stats", response_model=StatsResponse)
async def get_stats(
    qa_system: QASystem = Depends(get_qa_system)
):
    """
    Return usage statistics for this service instance.

    Includes sentiment request counts per language, average confidence scores,
    QA answer rate, knowledge base document count, and recent query history.
    Counters are in-memory and reset on service restart.
    """
    document_count = len(qa_system.vector_db.documents) if qa_system and qa_system.vector_db else 0
    return usage_stats.snapshot(document_count)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.api.main:app", host="0.0.0.0", port=8000, reload=True)
