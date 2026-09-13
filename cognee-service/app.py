from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Annotated, Literal
from uuid import uuid4

SERVICE_ROOT = Path(__file__).resolve().parent
COGNEE_ROOT = SERVICE_ROOT / ".cognee"

os.environ.setdefault("DATA_ROOT_DIRECTORY", str(COGNEE_ROOT / "data"))
os.environ.setdefault("SYSTEM_ROOT_DIRECTORY", str(COGNEE_ROOT / "system"))
os.environ.setdefault("CACHE_ROOT_DIRECTORY", str(COGNEE_ROOT / "cache"))
os.environ.setdefault("COGNEE_LOGS_DIR", str(COGNEE_ROOT / "logs"))
os.environ.setdefault("ENABLE_BACKEND_ACCESS_CONTROL", "false")
os.environ.setdefault("COGNEE_TRACING_ENABLED", "false")

import cognee
from cognee import SearchType
from cognee.tasks.ingestion.data_item import DataItem
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from cognee.api.v1.visualize.visualize import visualize_graph, visualize_graph_json

logger = logging.getLogger(__name__)
app = FastAPI(title="Yap2Graph local Cognee service", version="0.1.0")


@dataclass
class PipelineRun:
    status: Literal["running", "completed", "failed"]
    datasets: list[str]
    error: str | None = None


class CognifyRequest(BaseModel):
    datasets: list[str] = Field(min_length=1)


class SearchRequest(BaseModel):
    query: str = Field(min_length=1)
    search_type: Literal["SUMMARIES", "CHUNKS"]
    datasets: list[str] = Field(min_length=1)


pipeline_runs: dict[str, PipelineRun] = {}
pipeline_tasks: set[asyncio.Task[None]] = set()
cognify_lock = asyncio.Lock()


def document_text(document: dict[str, object]) -> str:
    return "\n".join(
        (
            f"Document ID: {document['id']}",
            f"Source type: {document.get('sourceType', 'unknown')}",
            f"Title: {document.get('title', '')}",
            f"Timestamp: {document.get('timestamp', '')}",
            f"Participants: {', '.join(str(value) for value in document.get('participants', []))}",
            "Content:",
            str(document.get("content", "")),
        )
    )


def parse_documents(
    uploads: list[UploadFile], external_metadata: str | None
) -> list[DataItem]:
    metadata_entries: list[dict[str, object] | None]
    if external_metadata is None:
        metadata_entries = [None] * len(uploads)
    else:
        try:
            decoded_metadata = json.loads(external_metadata)
        except json.JSONDecodeError as error:
            raise HTTPException(status_code=422, detail="external_metadata must be valid JSON") from error
        if not isinstance(decoded_metadata, list) or len(decoded_metadata) != len(uploads):
            raise HTTPException(
                status_code=422,
                detail="external_metadata must contain one object per uploaded document",
            )
        if not all(entry is None or isinstance(entry, dict) for entry in decoded_metadata):
            raise HTTPException(
                status_code=422,
                detail="external_metadata entries must be objects or null",
            )
        metadata_entries = decoded_metadata

    documents: list[DataItem] = []
    for upload, metadata in zip(uploads, metadata_entries):
        try:
            document = json.loads(upload.file.read())
        except json.JSONDecodeError as error:
            raise HTTPException(
                status_code=422,
                detail=f"{upload.filename or 'upload'} must contain a JSON object",
            ) from error
        if not isinstance(document, dict) or not isinstance(document.get("id"), str):
            raise HTTPException(
                status_code=422,
                detail=f"{upload.filename or 'upload'} must contain a string id",
            )

        source_metadata = {
            **(metadata or {}),
            "document_id": document["id"],
            "source_type": document.get("sourceType"),
        }
        documents.append(
            DataItem(data=document_text(document), external_metadata=source_metadata)
        )

    return documents


async def run_cognify(run_id: str, datasets: list[str]) -> None:
    try:
        async with cognify_lock:
            await cognee.cognify(datasets=datasets)
        pipeline_runs[run_id].status = "completed"
    except Exception as error:
        logger.exception("Cognee cognify failed")
        pipeline_runs[run_id].status = "failed"
        pipeline_runs[run_id].error = str(error)


@app.get("/api/v1/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "storage": "local"}


@app.post("/api/v1/add")
async def add(
    data: Annotated[list[UploadFile], File()],
    dataset_name: Annotated[str, Form(alias="datasetName")],
    external_metadata: Annotated[str | None, Form()] = None,
) -> dict[str, int | str]:
    documents = parse_documents(data, external_metadata)
    try:
        await cognee.add(documents, dataset_name=dataset_name)
    except Exception as error:
        logger.exception("Cognee add failed")
        raise HTTPException(status_code=500, detail=f"Cognee add failed: {error}") from error
    return {"dataset_name": dataset_name, "added": len(documents)}


@app.post("/api/v1/cognify")
async def cognify(request: CognifyRequest) -> dict[str, str]:
    run_id = str(uuid4())
    pipeline_runs[run_id] = PipelineRun(status="running", datasets=request.datasets)
    task = asyncio.create_task(run_cognify(run_id, request.datasets))
    pipeline_tasks.add(task)
    task.add_done_callback(pipeline_tasks.discard)
    return {"pipeline_run_id": run_id, "status": "running"}


@app.get("/api/v1/cognify/status/{run_id}")
async def cognify_status(run_id: str) -> dict[str, object]:
    run = pipeline_runs.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Unknown Cognee pipeline run")
    return asdict(run)


@app.post("/api/v1/search")
async def search(request: SearchRequest) -> list[dict[str, object]]:
    try:
        results = await cognee.search(
            query_text=request.query,
            query_type=SearchType(request.search_type),
            datasets=request.datasets,
        )
    except Exception as error:
        logger.exception("Cognee search failed")
        raise HTTPException(status_code=500, detail=f"Cognee search failed: {error}") from error

    return [{"search_result": jsonable_encoder(result)} for result in results]


@app.get("/api/v1/graph")
async def graph(
    dataset: str = "main_dataset",
    full: bool = True,
    max_nodes: int = Query(default=5000, ge=1, le=20000),
) -> dict[str, object]:
    try:
        return jsonable_encoder(
            await visualize_graph_json(
                dataset=dataset,
                full=full,
                max_nodes=max_nodes,
                include_session_events=False,
            )
        )
    except Exception as error:
        logger.exception("Cognee graph export failed")
        raise HTTPException(
            status_code=500,
            detail=f"Cognee graph export failed: {error}",
        ) from error


@app.get("/api/v1/visualize", response_class=HTMLResponse)
async def visualize(
    dataset: str = "main_dataset",
    full: bool = True,
    max_nodes: int = Query(default=5000, ge=1, le=20000),
) -> HTMLResponse:
    try:
        html = await visualize_graph(
            dataset=dataset,
            full=full,
            max_nodes=max_nodes,
            include_session_events=False,
        )
    except Exception as error:
        logger.exception("Cognee visualization failed")
        raise HTTPException(
            status_code=500,
            detail=f"Cognee visualization failed: {error}",
        ) from error

    return HTMLResponse(content=html)
